// ═══════════════════════════
//  CONFIG & STATE
// ═══════════════════════════
let SUPABASE_URL      = localStorage.getItem('supabase_project_url') || '';
let SUPABASE_ANON_KEY = localStorage.getItem('supabase_anon_key')    || '';
let EMAILJS_SERVICE_ID  = localStorage.getItem('emailjs_service_id')  || '';
let EMAILJS_TEMPLATE_ID = localStorage.getItem('emailjs_template_id') || '';
let EMAILJS_PUBLIC_KEY  = localStorage.getItem('emailjs_public_key')  || '';
// V3.1: EmailJS is the only dispatch provider. Remove stale legacy Power Automate settings.
localStorage.removeItem('pa_webhook_url');
localStorage.setItem('dispatch_method','emailjs');
let DISPATCH_METHOD = 'emailjs';
const DEMO_MODE = new URLSearchParams(window.location.search).get('demo') === '1';

let supabaseClient = null;
let entries        = [];
let editingId      = null;
let dailySendTime  = '09:00';
let managerEmail   = '';
let managerEmails  = []; // multiple managers
let ccEmails       = [];
let isSending      = false;
let activeFilter   = 'all';
let sortState      = { table:null, col:null, dir:'asc' };
let sfState        = { po:true, adv:true };
let dispatchGrouping = localStorage.getItem('dispatch_grouping') || 'separate'; // 'separate' | 'combined'
let dispatchContent  = localStorage.getItem('dispatch_content') || 'html';     // 'html' | 'pdf'

// Final temporary browser-only size test + hard guard for scheduled EmailJS dispatch.
const EMAILJS_HARD_LIMIT_BYTES = 50 * 1024;
const SIZE_TEST_PREFIX = 'limit-test-';
let sizeTestRows = [];
let emailSizeAutoBlocked = false;

// ═══════════════════════════
//  DOM REFS
// ═══════════════════════════
const form            = document.getElementById('approval-form');
const poTbody         = document.getElementById('po-tbody');
const advTbody        = document.getElementById('advance-tbody');
const amtEl           = document.getElementById('amount');
const curEl           = document.getElementById('currency');
const sarEl           = document.getElementById('amount-sar');
const advFields       = document.getElementById('advance-fields');
const typeEl          = document.getElementById('approval-type');
const hasAdvEl        = document.getElementById('has-advance');
const advPctEl        = document.getElementById('advance-percent');
const custPctEl       = document.getElementById('custom-percent');
const custPctGrp      = document.getElementById('custom-percent-group');
const advAmtEl        = document.getElementById('advance-amount');
const mgrEmailEl      = document.getElementById('input-manager-email');
const sendTimeEl      = document.getElementById('input-send-time');
const dbKeyEl         = document.getElementById('input-db-key');
const settingsModal   = document.getElementById('settings-modal');
const setupModal      = document.getElementById('setup-modal');
const cancelBtn       = document.getElementById('btn-cancel-edit');
const editBanner      = document.getElementById('edit-banner');
const holdBanner      = document.getElementById('hold-banner');

// ═══════════════════════════
//  UTILS
// ═══════════════════════════
const gv  = id => document.getElementById(id)?.value.trim() ?? '';
const gn  = id => parseFloat(gv(id)) || 0;

// ═══════════════════════════
//  APPROVAL ROUTING — V3
// ═══════════════════════════
// Rules use the SAR equivalent, regardless of source currency.
// Exception: any PO number starting with 2 is CAPEX and always requires GM approval.
// < 10,000 SAR = SCM | 10,000–50,000 SAR = FM | > 50,000 SAR = GM
function isCapexPO(entryOrPo) {
  const po = typeof entryOrPo === 'string'
    ? entryOrPo
    : (entryOrPo?.po ?? entryOrPo?.po_number ?? '');
  return String(po || '').trim().startsWith('2');
}

function getApprovalRoute(entryOrSar) {
  const sar = typeof entryOrSar === 'number'
    ? Number(entryOrSar || 0)
    : Number(entryOrSar?.amountSar ?? entryOrSar?.amount_sar ?? 0);
  if (typeof entryOrSar !== 'number' && isCapexPO(entryOrSar)) return 'GM';
  if (sar > 50000) return 'GM';
  if (sar >= 10000) return 'FM';
  return 'SCM';
}

function getEmailApprovers(e) {
  const route = getApprovalRoute(e);
  if (route === 'GM') return 'FM + GM';
  if (route === 'FM') return 'FM Only';
  return 'SCM Only';
}

function isAdvanceEntry(e) { return Number(e?.advanceAmount || 0) > 0; }
function requiresFMApproval(e) {
  const route = getApprovalRoute(e);
  return !isAdvanceEntry(e) && (route === 'FM' || route === 'GM');
}
function isDispatchEligible(e) { return isAdvanceEntry(e) || requiresFMApproval(e); }
function getDispatchGroups(list) {
  const normal = list.filter(e => !isAdvanceEntry(e));
  return {
    // Approval chain is cumulative: every GM PO also requires FM approval,
    // so GM POs intentionally appear in BOTH FM and GM sections.
    fm: normal.filter(e => { const r=getApprovalRoute(e); return r === 'FM' || r === 'GM'; }),
    gm: normal.filter(e => getApprovalRoute(e) === 'GM'),
    scm: normal.filter(e => getApprovalRoute(e) === 'SCM'),
    advances: list.filter(isAdvanceEntry),
  };
}

function updateApprovalRoutePreview() {
  const box=document.getElementById('approval-route-preview');
  if(!box) return;
  const sar=Number(sarEl?.value||0);
  const po=gv('po-number');
  const capex=isCapexPO(po);
  const route=getApprovalRoute({amountSar:sar, po});
  const advance=hasAdvEl?.checked || typeEl?.value==='Advance Approval';
  box.className=`approval-route-preview route-${route.toLowerCase()}${capex?' capex-route':''}`;
  const chain = route==='SCM' ? 'SCM' : route==='FM' ? 'SCM → FM' : 'SCM → FM → GM';
  const reason = capex ? 'CAPEX exception · PO starts with 2' : (route==='SCM'?'Below 10,000 SAR':route==='FM'?'10,000–50,000 SAR':'Above 50,000 SAR');
  box.innerHTML=`<span class="route-dot"></span><span><b>${route} approval${capex?' · CAPEX':''}</b><small>${chain} · ${reason}</small></span>${advance?'<em>+ Advance list</em>':''}`;
}


const RECENT_SENT_TTL = 30 * 60 * 1000;
function getRecentSentIds() {
  try {
    const raw = JSON.parse(localStorage.getItem('recently_sent_entries') || '{}');
    if (!raw.ts || !Array.isArray(raw.ids) || (Date.now() - raw.ts) > RECENT_SENT_TTL) {
      localStorage.removeItem('recently_sent_entries');
      return new Set();
    }
    return new Set(raw.ids);
  } catch { return new Set(); }
}
function rememberRecentlySent(ids) {
  if (!ids?.length) return;
  localStorage.setItem('recently_sent_entries', JSON.stringify({ids:[...new Set(ids)], ts:Date.now()}));
}
function clearRecentlySent(ids=[]) {
  const current = getRecentSentIds();
  ids.forEach(id=>current.delete(id));
  if (!current.size) localStorage.removeItem('recently_sent_entries');
  else localStorage.setItem('recently_sent_entries', JSON.stringify({ids:[...current], ts:Date.now()}));
}

function extractSupplier(s) {
  const v = (s||'').trim();
  if (!v || v==='-') return {suppNo:'',vendorName:'-'};
  let m = v.match(/^(\d{3,15})(?:\s*[-_@:|]+\s*|\s+)(.*)/);
  if (m) return {suppNo:m[1],vendorName:m[2].trim()};
  m = v.match(/^(.*?)(?:\s*[-_@:|]+\s*|\s+)(\d{3,15})$/);
  if (m) return {suppNo:m[2],vendorName:m[1].trim()};
  return {suppNo:'',vendorName:v};
}

function toast(msg, type='info') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(()=>{ t.style.animation='tOut .22s ease forwards'; setTimeout(()=>t.remove(),220); }, 3500);
}

function animStat(id, val) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(val)) return;
  el.textContent = val;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

function bumpPill(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}

// ═══════════════════════════
//  INIT
// ═══════════════════════════
async function init() {
  lucide.createIcons();
  const d = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const d1=document.getElementById('po-date'); if(d1) d1.textContent=d;
  const d2=document.getElementById('po-date-form'); if(d2) d2.textContent=d;
  initTheme();
  restoreDraft();
  calculate();
  syncDispatchOptionsUI();

  if (DEMO_MODE) {
    managerEmail='gm@company.com';
    managerEmails=['gm@company.com'];
    ccEmails=['procurement@company.com'];
    dailySendTime='14:00';
    entries=[
      {id:'demo-1',date:new Date().toISOString().slice(0,10),prSo:'3600004011',po:'3200007012',woSo:'',description:'4140-L80 material purchase',category:'Material purchase',supplier:'100245 - Gulf Metals',amount:48500,currency:'SAR',amountSar:48500,advancePercent:0,advanceAmount:0,notes:'Required for workshop',is_sent:false,status:'pending',on_hold:false},
      {id:'demo-2',date:new Date().toISOString().slice(0,10),prSo:'3600004004',po:'3200007008',woSo:'WO-8821',description:'Machine shop service',category:'Service',supplier:'100118 - Eastern Industrial',amount:12800,currency:'SAR',amountSar:12800,advancePercent:0,advanceAmount:0,notes:'Urgent repair',is_sent:false,status:'pending',on_hold:false},
      {id:'demo-3',date:new Date().toISOString().slice(0,10),prSo:'3600003970',po:'3200006991',woSo:'',description:'Advance for imported consumables',category:'Stock',supplier:'100377 - Prime Supply',amount:22000,currency:'USD',amountSar:82500,advancePercent:30,advanceAmount:24750,notes:'30% advance as per quotation',is_sent:false,status:'hold',on_hold:true},
      {id:'demo-4',date:new Date(Date.now()-86400000).toISOString().slice(0,10),prSo:'3600003968',po:'3200006984',woSo:'',description:'Thread protectors',category:'Stock',supplier:'100052 - Saudi Protectors',amount:9100,currency:'SAR',amountSar:9100,advancePercent:0,advanceAmount:0,notes:'',is_sent:true,status:'sent',on_hold:false}
    ];
    const sb=document.getElementById('daily-schedule-text');
    if(sb) sb.innerHTML=`<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${dailySendTime}`;
    renderManagerEmails(); renderCcTags(); renderDashboard(); updateSupplierList(); buildReuseMenu(); calculate();
    lucide.createIcons();
    toast('Demo mode — sample data only','info');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { setupModal.classList.add('open'); return; }
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (typeof emailjs!=='undefined' && EMAILJS_PUBLIC_KEY) emailjs.init(EMAILJS_PUBLIC_KEY);
    await loadSettings();
    await autoPurge();
    await loadEntries();
    subscribeRealtime();
    calculate();
    // Check schedule every 60s — only once per minute window
    // Check every 10s so we never miss a minute window
    setInterval(checkSchedule, 10000);
  } catch(err) { toast('DB connection failed. Check Settings.','error'); }
}

async function activateDashboard() {
  const url = document.getElementById('setup-db-url')?.value.trim();
  const key = document.getElementById('setup-db-key')?.value.trim();
  if (!url||!key) return toast('Enter both URL and Key','error');
  localStorage.setItem('supabase_project_url', url.replace(/\/$/,''));
  localStorage.setItem('supabase_anon_key', key);
  setupModal.classList.remove('open');
  window.location.reload();
}

// ═══════════════════════════
//  DATABASE
// ═══════════════════════════
async function loadSettings() {
  const {data} = await supabaseClient.from('settings').select('*');
  if (!data) return;
  const get = k => data.find(i=>i.key===k);

  if (dbKeyEl) dbKeyEl.value = SUPABASE_ANON_KEY;
  const urlEl=document.getElementById('input-db-url'); if(urlEl) urlEl.value=SUPABASE_URL;
  const svcEl=document.getElementById('input-emailjs-svc'); if(svcEl) svcEl.value=EMAILJS_SERVICE_ID;
  const tplEl=document.getElementById('input-emailjs-tpl'); if(tplEl) tplEl.value=EMAILJS_TEMPLATE_ID;
  const pubEl=document.getElementById('input-emailjs-pub'); if(pubEl) pubEl.value=EMAILJS_PUBLIC_KEY;

  const sTime=get('send_time');
  if (sTime) {
    dailySendTime=sTime.value;
    if(sendTimeEl) sendTimeEl.value=dailySendTime;
    const sb=document.getElementById('daily-schedule-text');
    if(sb) sb.innerHTML=`<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${dailySendTime}`;
    lucide.createIcons();
  }
  const sEmail=get('manager_email');
  if (sEmail) {
    // Support both legacy single email and new comma-separated list
    managerEmail=sEmail.value;
    if(mgrEmailEl) mgrEmailEl.value=managerEmail;
  }
  const sEmails=get('manager_emails');
  if (sEmails && sEmails.value) {
    managerEmails=sEmails.value.split(',').map(e=>e.trim()).filter(Boolean);
  }
  // Always ensure legacy single email is included if not already present
  if (managerEmail && !managerEmails.includes(managerEmail)) {
    managerEmails.unshift(managerEmail);
    // Save merged list back to Supabase so it's persisted
    if (supabaseClient) {
      supabaseClient.from('settings').upsert([
        {key:'manager_emails', value:managerEmails.join(',')}
      ], {onConflict:'key'}).catch(()=>{});
    }
  }
  renderManagerEmails();
  const sCC=get('cc_emails');
  if (sCC) { ccEmails=sCC.value?sCC.value.split(',').map(e=>e.trim()).filter(Boolean):[]; renderCcTags(); }

  const sLastDispatch=get('last_dispatch_date');
  if (sLastDispatch?.value) lastScheduledDate=sLastDispatch.value;

  const sGrouping=get('dispatch_grouping');
  const sContent=get('dispatch_content');
  dispatchGrouping = ['separate','combined'].includes(sGrouping?.value) ? sGrouping.value : (['separate','combined'].includes(dispatchGrouping)?dispatchGrouping:'separate');
  dispatchContent = ['html','pdf'].includes(sContent?.value) ? sContent.value : (['html','pdf'].includes(dispatchContent)?dispatchContent:'html');
  syncDispatchOptionsUI();

  // Load column config from Supabase (shared across all team members)
  loadColsFromSettings(data);
}

async function saveSettings() {
  const newKey = dbKeyEl?.value.trim()||'';
  const newUrl = document.getElementById('input-db-url')?.value.trim()||SUPABASE_URL;
  const newSvc = document.getElementById('input-emailjs-svc')?.value.trim()||'';
  const newTpl = document.getElementById('input-emailjs-tpl')?.value.trim()||'';
  const newPub = document.getElementById('input-emailjs-pub')?.value.trim()||'';
  const newTime  = sendTimeEl?.value||'';
  const newEmail = mgrEmailEl?.value.trim()||'';
  const newCC    = ccEmails.join(',');
  const newGrouping = document.querySelector('input[name="dispatch-grouping"]:checked')?.value || dispatchGrouping || 'separate';
  const newContent  = document.querySelector('input[name="dispatch-content"]:checked')?.value || dispatchContent || 'html';

  const sb=document.getElementById('daily-schedule-text');
  if(sb){sb.innerHTML=`<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${newTime}`;lucide.createIcons();}


  if (newKey!==SUPABASE_ANON_KEY||newUrl!==SUPABASE_URL||newSvc!==EMAILJS_SERVICE_ID||newTpl!==EMAILJS_TEMPLATE_ID||newPub!==EMAILJS_PUBLIC_KEY) {
    localStorage.setItem('supabase_anon_key',newKey);
    localStorage.setItem('supabase_project_url',newUrl);
    localStorage.setItem('emailjs_service_id',newSvc);
    localStorage.setItem('emailjs_template_id',newTpl);
    localStorage.setItem('emailjs_public_key',newPub);
    localStorage.setItem('dispatch_method','emailjs');
    localStorage.setItem('dispatch_grouping',newGrouping);
    localStorage.setItem('dispatch_content',newContent);
    toast('Credentials saved. Refreshing…','success');
    setTimeout(()=>window.location.reload(),1000);
    return;
  }
  // EmailJS is the only dispatch method in V3.1.
  DISPATCH_METHOD = 'emailjs';
  localStorage.setItem('dispatch_method','emailjs');
  try {
    await Promise.all([
      supabaseClient.from('settings').upsert([{key:'send_time',value:newTime}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'manager_email',value:newEmail}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'manager_emails',value:managerEmails.join(',')}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'cc_emails',value:newCC}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'dispatch_grouping',value:newGrouping}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'dispatch_content',value:newContent}],{onConflict:'key'}),
    ]);
    dailySendTime=newTime; managerEmail=managerEmails[0]||newEmail;
    dispatchGrouping=newGrouping; dispatchContent=newContent; localStorage.setItem('dispatch_grouping',newGrouping); localStorage.setItem('dispatch_content',newContent); syncDispatchOptionsUI();
    toast('Settings saved','success');
    settingsModal.classList.remove('open');
  } catch { toast('Sync failed','error'); }
}

async function loadEntries() {
  const {data,error} = await supabaseClient.from('entries').select('*').order('created_at',{ascending:false});
  if (error) return toast('Load failed: '+error.message,'error');
  const loadedEntries = data.map(i=>({
    id:i.id, date:i.po_date, prSo:i.pr_so_number, po:i.po_number,
    woSo:i.wo_so_number, description:i.description, category:i.category,
    supplier:i.supplier, amount:i.amount, currency:i.currency,
    amountSar:i.amount_sar, advancePercent:i.advance_percent,
    advanceAmount:i.advance_amount, notes:i.notes,
    is_sent:i.is_sent,
    status: i.is_sent ? 'sent' : (i.on_hold ? 'hold' : 'pending'),
    on_hold: i.on_hold || false
  }));
  // Temporary size-test rows live only in browser memory and are never written to Supabase.
  entries = [...loadedEntries, ...sizeTestRows];
  renderDashboard();
  updateSupplierList();
  buildReuseMenu();
}

async function autoPurge() {
  const d=new Date(); d.setDate(d.getDate()-30);
  try { await supabaseClient.from('entries').delete().lt('po_date',d.toISOString().split('T')[0]).eq('is_sent',true); } catch{}
}

function subscribeRealtime() {
  supabaseClient.channel('entries-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'entries'}, ()=>loadEntries())
    .subscribe();
}

// ═══════════════════════════
//  REQUIRED REFERENCE FIELDS / N/A
// ═══════════════════════════
const NA_FIELD_PAIRS = [
  ['pr-so-number','pr-so-na'],
  ['wo-so-number','wo-so-na']
];

function setNAField(fieldId, checkboxId, checked, restorePrevious=true) {
  const input = document.getElementById(fieldId);
  const checkbox = document.getElementById(checkboxId);
  if (!input || !checkbox) return;
  checkbox.checked = !!checked;
  if (checked) {
    if (input.value && input.value.trim().toUpperCase() !== 'N/A') input.dataset.previousValue = input.value;
    input.value = 'N/A';
    input.disabled = true;
    input.required = false;
    input.classList.add('na-field');
  } else {
    input.disabled = false;
    input.required = true;
    if (input.value.trim().toUpperCase() === 'N/A') input.value = restorePrevious ? (input.dataset.previousValue || '') : '';
    delete input.dataset.previousValue;
    input.classList.remove('na-field');
  }
}

function syncNAFieldsFromValues() {
  NA_FIELD_PAIRS.forEach(([fieldId, checkboxId]) => {
    const input = document.getElementById(fieldId);
    setNAField(fieldId, checkboxId, (input?.value || '').trim().toUpperCase() === 'N/A', false);
  });
}

function resetNAFields() {
  NA_FIELD_PAIRS.forEach(([fieldId, checkboxId]) => setNAField(fieldId, checkboxId, false, false));
}

// ═══════════════════════════
//  CREATE / EDIT
// ═══════════════════════════
async function handleSubmit(e, onHold=false) {
  e.preventDefault();
  const existing = editingId ? entries.find(i=>i.id===editingId) : null;
  const effectiveHold = onHold || !!existing?.on_hold;
  const poValue = gv('po-number');
  const amountValue = parseFloat(amtEl.value);
  if (!poValue) return toast('PO Number is required','error');
  if (!gv('pr-so-number')) return toast('PR # is required — or check N/A','error');
  if (!gv('wo-so-number')) return toast('WO / SO # is required — or check N/A','error');
  if (!gv('description')) return toast('Description is required','error');
  if (!gv('supplier')) return toast('Supplier is required','error');
  if (!Number.isFinite(amountValue) || amountValue <= 0) return toast('Enter a valid amount greater than 0','error');
  const isAdvance = typeEl.value==='Advance Approval' || hasAdvEl.checked;
  const pctValue = parseFloat(advPctEl.value==='custom'?custPctEl.value:advPctEl.value)||0;
  if (isAdvance && pctValue <= 0) return toast('Select the advance percentage','error');
  const duplicate = entries.find(i=>i.po===poValue && i.id!==editingId);
  if (duplicate && !confirm(`PO ${poValue} already exists (${duplicate.status}). Continue anyway?`)) return;
  const data = {
    po_date:      new Date().toISOString().split('T')[0],
    description:  gv('description'),
    category:     gv('category'),
    pr_so_number: gv('pr-so-number'),
    wo_so_number: gv('wo-so-number'),
    po_number:    gv('po-number'),
    supplier:     gv('supplier'),
    amount:       parseFloat(amtEl.value),
    currency:     curEl.value,
    amount_sar:   parseFloat(sarEl.value),
    advance_percent: parseFloat(advPctEl.value==='custom'?custPctEl.value:advPctEl.value)||0,
    advance_amount:  parseFloat(advAmtEl.value)||0,
    notes:        gv('notes'),
    is_sent:      false,
    on_hold:      effectiveHold
  };

  if (DEMO_MODE) {
    if (editingId) {
      const idx=entries.findIndex(i=>i.id===editingId);
      if(idx>=0) entries[idx]={...entries[idx],date:data.po_date,prSo:data.pr_so_number,po:data.po_number,woSo:data.wo_so_number,description:data.description,category:data.category,supplier:data.supplier,amount:data.amount,currency:data.currency,amountSar:data.amount_sar,advancePercent:data.advance_percent,advanceAmount:data.advance_amount,notes:data.notes,is_sent:false,status:data.on_hold?'hold':'pending',on_hold:data.on_hold};
      cancelEdit();
      toast(data.on_hold?'Changes saved — still On Hold':'Request updated','success');
    } else {
      const base={id:'demo-'+Date.now(),date:data.po_date,prSo:data.pr_so_number,po:data.po_number,woSo:data.wo_so_number,description:data.description,category:data.category,supplier:data.supplier,amount:data.amount,currency:data.currency,amountSar:data.amount_sar,advancePercent:data.advance_percent,advanceAmount:data.advance_amount,notes:data.notes,is_sent:false,status:data.on_hold?'hold':'pending',on_hold:data.on_hold};
      if (typeEl.value==='PO Approval' && hasAdvEl.checked) {
        entries.unshift({...base,id:base.id+'-adv'});
        entries.unshift({...base,id:base.id+'-po',advancePercent:0,advanceAmount:0});
      } else entries.unshift(base);
      toast(data.on_hold?'Saved on hold':'Request submitted','success');
    }
    form.reset(); resetNAFields(); hasAdvEl.checked=false; advFields.style.display='none'; advAmtEl.value=0; editingId=null; cancelBtn.style.display='none'; editBanner.classList.remove('show'); holdBanner.classList.remove('show'); document.getElementById('form-title').textContent='New Approval Request'; calculate(); renderDashboard(); updateSupplierList(); buildReuseMenu(); return;
  }

  try {
    if (editingId) {
      const {error} = await supabaseClient.from('entries').update(data).eq('id',editingId);
      if (error) throw error;
      cancelEdit();
      toast(effectiveHold?'Changes saved — still On Hold':'Request updated','success');
    } else {
      if (typeEl.value==='PO Approval' && hasAdvEl.checked) {
        const {error} = await supabaseClient.from('entries').insert([
          {...data, advance_amount:0, advance_percent:0, on_hold:effectiveHold},
          {...data, on_hold:effectiveHold}
        ]);
        if (error) throw error;
      } else {
        const {error} = await supabaseClient.from('entries').insert([data]);
        if (error) throw error;
      }
      toast(effectiveHold?'Saved on hold — won\'t dispatch until released':'Request submitted','success');
    }
    form.reset();
    resetNAFields();
    hasAdvEl.checked=false;
    advFields.style.display='none';
    advAmtEl.value=0;
    document.getElementById('form-title').textContent='New Approval Request';
    sessionStorage.removeItem('approval_form_draft');
    calculate();
  } catch(err) { toast('Save failed: '+err.message,'error'); }
}

function startEdit(id) {
  const e=entries.find(i=>i.id===id); if(!e) return;
  editingId=id;
  document.getElementById('form-title').textContent='Editing Record';
  cancelBtn.style.display='inline-flex';
  editBanner.classList.add('show');
  holdBanner.classList.toggle('show', e.on_hold);

  typeEl.value = e.advanceAmount>0 ? 'Advance Approval' : 'PO Approval';
  hasAdvEl.checked=false;
  if (e.advanceAmount>0) {
    const standard=['10','20','30','50','100'];
    const pct=String(e.advancePercent||0);
    if (standard.includes(pct)) { advPctEl.value=pct; custPctGrp.style.display='none'; }
    else { advPctEl.value='custom'; custPctEl.value=e.advancePercent||''; custPctGrp.style.display='block'; }
  } else {
    advPctEl.value='0'; custPctEl.value=''; custPctGrp.style.display='none';
  }
  ['pr-so-number','po-number','wo-so-number','description','category','supplier','notes'].forEach(fid=>{
    const map={'pr-so-number':'prSo','po-number':'po','wo-so-number':'woSo','description':'description','category':'category','supplier':'supplier','notes':'notes'};
    const el=document.getElementById(fid); if(el) el.value=e[map[fid]]||'';
  });
  syncNAFieldsFromValues();
  document.getElementById('amount').value=e.amount;
  curEl.value=e.currency;
  calculate();
  document.querySelector('.form-inner')?.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>document.getElementById('po-number')?.focus(),200);
}

function cancelEdit() {
  editingId=null;
  document.getElementById('form-title').textContent='New Approval Request';
  cancelBtn.style.display='none';
  editBanner.classList.remove('show');
  holdBanner.classList.remove('show');
  form.reset();
  resetNAFields();
  hasAdvEl.checked=false;
  advFields.style.display='none';
  advAmtEl.value=0;
  sessionStorage.removeItem('approval_form_draft');
  calculate();
}

async function deleteEntry(id) {
  if (!confirm('Delete this request?')) return;
  if (DEMO_MODE) { entries=entries.filter(e=>e.id!==id); renderDashboard(); return; }
  const {error}=await supabaseClient.from('entries').delete().eq('id',id);
  if(error) return toast('Delete failed: '+error.message,'error');
  await loadEntries();
}

// Toggle hold status on existing entry
async function toggleHold(id) {
  const e=entries.find(i=>i.id===id); if(!e) return;
  const newHold=!e.on_hold;
  if (DEMO_MODE) { e.on_hold=newHold; e.is_sent=false; e.status=newHold?'hold':'pending'; toast(newHold?'Moved to On Hold':'Released to Pending','info'); renderDashboard(); return; }
  const {error}=await supabaseClient.from('entries').update({on_hold:newHold,is_sent:false}).eq('id',id);
  if (error) return toast('Failed: '+error.message,'error');
  toast(newHold?'Moved to On Hold — won\'t dispatch':'Released — will include in next dispatch','info');
  await loadEntries();
}

function reuseEntry(id) {
  const e=entries.find(i=>i.id===id); if(!e) return;
  typeEl.value = e.advanceAmount>0 ? 'Advance Approval' : 'PO Approval';
  hasAdvEl.checked = e.advanceAmount>0;
  ['description','category','supplier','notes'].forEach(fid=>{
    const map={description:'description',category:'category',supplier:'supplier',notes:'notes'};
    const el=document.getElementById(fid); if(el) el.value=e[map[fid]]||'';
  });
  ['po-number','pr-so-number','wo-so-number'].forEach(fid=>{const el=document.getElementById(fid);if(el)el.value='';});
  resetNAFields();
  document.getElementById('amount').value=e.amount;
  curEl.value=e.currency;
  calculate();
  document.querySelector('.form-inner')?.scrollTo({top:0,behavior:'smooth'});
  document.getElementById('po-number')?.focus();
  toast('Prefilled from history — update PO # before submitting','info');
}

// ═══════════════════════════
//  REUSE DROPDOWN
// ═══════════════════════════
function buildReuseMenu() {
  const menu=document.getElementById('reuse-menu'); if(!menu) return;
  const recent=entries.filter(e=>!isSizeTestEntry(e)).slice(0,20);
  if (!recent.length) { menu.innerHTML='<div class="reuse-empty">No history yet</div>'; return; }
  menu.innerHTML=recent.map(e=>{
    const {suppNo,vendorName}=extractSupplier(e.supplier);
    return `<div class="reuse-item" onclick="reuseEntry('${e.id}');document.getElementById('reuse-menu').classList.remove('open')">
      <div style="min-width:0">
        <div class="ri-main">${vendorName}${suppNo?` <span style="color:var(--t2);font-weight:400">· ${suppNo}</span>`:''}</div>
        <div class="ri-sub">${e.po||'No PO'} · ${e.category||''} · ${(e.amount||0).toLocaleString()} ${e.currency}</div>
      </div>
    </div>`;
  }).join('');
}

window.filterReuse = function(q) {
  const menu=document.getElementById('reuse-menu'); if(!menu) return;
  if (!q||q.length<1){menu.classList.remove('open');return;}
  const lo=q.toLowerCase();
  const hits=entries.filter(e=>!isSizeTestEntry(e)&&[e.supplier,e.po,e.description,e.category].some(v=>v&&v.toLowerCase().includes(lo))).slice(0,8);
  if (!hits.length){menu.classList.remove('open');return;}
  menu.innerHTML=hits.map(e=>{
    const {suppNo,vendorName}=extractSupplier(e.supplier);
    return `<div class="reuse-item" onclick="reuseEntry('${e.id}');document.getElementById('supplier').value='${e.supplier.replace(/'/g,"\\'")}';document.getElementById('reuse-menu').classList.remove('open')">
      <div style="min-width:0">
        <div class="ri-main">${vendorName}${suppNo?` <span style="color:var(--t2);font-weight:400">· ${suppNo}</span>`:''}</div>
        <div class="ri-sub">${e.po||'No PO'} · ${e.category||''} · ${(e.amount||0).toLocaleString()} ${e.currency}</div>
      </div>
    </div>`;
  }).join('');
  menu.classList.add('open');
};
document.addEventListener('click',e=>{
  const m=document.getElementById('reuse-menu');
  if(m&&!m.closest('.reuse-wrap')?.contains(e.target)) m.classList.remove('open');
});

// ═══════════════════════════
//  CELL VALUE HELPERS (screen + email share same logic)
// ═══════════════════════════
function getCellValue(e, key) {
  const {suppNo, vendorName} = extractSupplier(e.supplier);
  const advCur = ((e.amount||0) * (e.advancePercent||0)) / 100;
  const map = {
    suppNo:        suppNo || '-',
    supplier:      vendorName,
    po:            e.po || '-',
    amount:        (e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),
    currency:      e.currency || '',
    amountSar:     (e.amountSar||0).toLocaleString(),
    advCur:        advCur.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}),
    advanceAmount: (e.advanceAmount||0).toLocaleString(),
    notes:         e.notes || '-',
    date:          e.date || '',
    description:   e.description || '-',
    category:      e.category || '-',
    status:        e.status === 'sent' ? 'Sent' : e.status === 'hold' ? 'On Hold' : 'Pending',
    prSo:          e.prSo || '-',
    woSo:          e.woSo || '-',
    approval:      getApprovalRoute(e),
  };
  // Custom columns stored as extra_* in entry
  if (key.startsWith('extra_')) return e[key] || '-';
  return map[key] !== undefined ? map[key] : '-';
}

// For table cells (with HTML badges)
function getCellHtml(e, key, tableType) {
  if (key === 'status') {
    if (e.status==='hold') return `<span class="sp hold">⏸ On Hold</span>`;
    if (e.status==='sent') {
      const recent=getRecentSentIds();
      return recent.has(e.id) ? `<span class="sp just-sent">Just Sent</span>` : `<span class="sp sent">Sent</span>`;
    }
    return `<span class="sp pending">Pending</span>`;
  }
  if (key === 'category') return e.category ? `<span class="cp">${e.category}</span>` : '-';
  if (key === 'approval') { const r=getApprovalRoute(e); return `<span class="approval-pill approval-${r.toLowerCase()}">${r}</span>`; }
  if (key === 'amountSar' || key === 'advanceAmount') return `<b>${getCellValue(e,key)}</b>`;
  const val = getCellValue(e, key);
  const truncKeys = ['supplier','notes','description'];
  if (truncKeys.includes(key)) {
    return `<span style="display:block;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${val}">${val}</span>`;
  }
  return val;
}

// ═══════════════════════════
//  FILTER / SORT
// ═══════════════════════════
window.setFilter = function(f) {
  activeFilter=f;
  document.querySelectorAll('.fchip').forEach(c=>c.classList.remove('on'));
  document.getElementById('fc-'+f)?.classList.add('on');
  renderDashboard();
};

window.toggleSF = function(w) {
  sfState[w]=!sfState[w];
  document.getElementById('sf-'+w)?.classList.toggle('on',sfState[w]);
  renderDashboard();
};

window.sortT = function(t,col) {
  if (sortState.table===t&&sortState.col===col) sortState.dir=sortState.dir==='asc'?'desc':'asc';
  else sortState={table:t,col,dir:'asc'};
  const tId=t==='po'?'po-table':'adv-table';
  document.querySelectorAll(`#${tId} thead th`).forEach(th=>{
    th.classList.remove('sa','sd');
    if(th.getAttribute('onclick')===`sortT('${t}','${col}')`) th.classList.add(sortState.dir==='asc'?'sa':'sd');
  });
  renderDashboard();
};

function applySort(arr,t) {
  if (sortState.table!==t||!sortState.col) return arr;
  const {col,dir}=sortState, sign=dir==='asc'?1:-1;
  return [...arr].sort((a,b)=>{
    const va=a[col]??'', vb=b[col]??'';
    return (typeof va==='number'?(va-vb):String(va).localeCompare(String(vb)))*sign;
  });
}

function applyFilter(arr) {
  const today=new Date().toISOString().split('T')[0];
  const ws=new Date(); ws.setDate(ws.getDate()-ws.getDay()); ws.setHours(0,0,0,0);
  switch(activeFilter) {
    case 'pending': return arr.filter(e=>e.status==='pending');
    case 'hold':    return arr.filter(e=>e.status==='hold');
    case 'sent':    return arr.filter(e=>e.status==='sent');
    case 'justsent': { const r=getRecentSentIds(); return arr.filter(e=>e.status==='sent' && r.has(e.id)); }
    case 'scm':     return arr.filter(e=>!isAdvanceEntry(e) && getApprovalRoute(e)==='SCM');
    case 'fm':      return arr.filter(e=>requiresFMApproval(e));
    case 'gm':      return arr.filter(e=>!isAdvanceEntry(e) && getApprovalRoute(e)==='GM');
    case 'today':   return arr.filter(e=>e.date===today);
    case 'week':    return arr.filter(e=>e.date&&new Date(e.date)>=ws);
    default: return arr;
  }
}

// ═══════════════════════════
//  RENDER
// ═══════════════════════════
function renderDashboard() {
  const hideSent = document.getElementById('toggle-hide-sent')?.checked ?? true;
  const recentSent = getRecentSentIds();
  const q = document.getElementById('pipeline-search')?.value.trim().toLowerCase() ?? '';

  let pos  = entries.filter(e=>!e.advanceAmount||e.advanceAmount===0);
  let advs = entries.filter(e=>e.advanceAmount>0);

  pos=applyFilter(pos); advs=applyFilter(advs);

  if (hideSent && activeFilter==='all') {
    pos=pos.filter(e=>e.status!=='sent');
    advs=advs.filter(e=>e.status!=='sent');
  }

  if (q) {
    const m=e=>[e.supplier,e.po,e.description,e.category,e.prSo,e.woSo,e.notes].some(v=>v&&v.toLowerCase().includes(q));
    if (sfState.po)  pos=pos.filter(m); else pos=[];
    if (sfState.adv) advs=advs.filter(m); else advs=[];
  }

  pos=applySort(pos,'po'); advs=applySort(advs,'adv');

  // Count pills
  ['po-count','adv-count'].forEach((id,i)=>{
    const el=document.getElementById(id); if(!el) return;
    const n=i===0?pos.length:advs.length;
    if(el.textContent!==String(n)){el.textContent=n;bumpPill(id);}
  });

  // Sidebar stats
  const allPos=entries.filter(e=>!e.advanceAmount||e.advanceAmount===0);
  const allAdvs=entries.filter(e=>e.advanceAmount>0);
  const pendSar=entries.filter(e=>e.status==='pending')
    .reduce((s,e)=>s+(e.advanceAmount>0?(e.advanceAmount||0):(e.amountSar||0)),0);
  const holdCnt=entries.filter(e=>e.status==='hold').length;
  const ws=new Date(); ws.setDate(ws.getDate()-ws.getDay()); ws.setHours(0,0,0,0);
  const sentWk=entries.filter(e=>e.status==='sent'&&new Date(e.date)>=ws).length;

  animStat('stat-po-count',    allPos.length);
  animStat('stat-adv-count',   allAdvs.length);
  animStat('stat-pending-sar', pendSar.toLocaleString('en-US',{maximumFractionDigits:0}));
  animStat('stat-hold-count',  holdCnt);
  animStat('stat-sent-week',   sentWk);
  const qPending=document.getElementById('qov-pending'); if(qPending) qPending.textContent=entries.filter(e=>e.status==='pending').length;
  const qHold=document.getElementById('qov-hold'); if(qHold) qHold.textContent=holdCnt;
  const qSent=document.getElementById('qov-sent'); if(qSent) qSent.textContent=sentWk;
  const qNext=document.getElementById('qov-next-send'); if(qNext) qNext.textContent=dailySendTime||'Off';
  const pendingNormal=entries.filter(e=>e.status==='pending'&&!isAdvanceEntry(e));
  const setRouteCount=(id,route)=>{const el=document.getElementById(id);if(el)el.textContent=pendingNormal.filter(e=>getApprovalRoute(e)===route).length;};
  setRouteCount('route-scm-count','SCM');
  const fmCount=document.getElementById('route-fm-count'); if(fmCount) fmCount.textContent=pendingNormal.filter(requiresFMApproval).length;
  setRouteCount('route-gm-count','GM');
  const routeAdv=document.getElementById('route-adv-count'); if(routeAdv) routeAdv.textContent=entries.filter(e=>e.status==='pending'&&isAdvanceEntry(e)).length;

  const badge = e => {
    if (e.status==='hold')    return `<span class="sp hold">⏸ On Hold</span>`;
    if (e.status==='sent')    return `<span class="sp sent">Sent</span>`;
    return `<span class="sp pending">Pending</span>`;
  };
  const catBadge = c => c ? `<span class="cp">${c}</span>` : '-';

  // Column-driven rendering — respects visible cols from customizer
  const visPo  = poCols.filter(c=>c.visible);
  const visAdv = advCols.filter(c=>c.visible);
  const colspan_po  = 2 + visPo.length;  // checkbox + cols + actions
  const colspan_adv = 2 + visAdv.length;

  // Update table headers dynamically
  const poTable  = document.getElementById('po-table');
  const advTable = document.getElementById('adv-table');
  if (poTable) {
    const sortableKeys = ['suppNo','supplier','po','amount','amountSar','approval','date','status'];
    poTable.querySelector('thead tr').innerHTML =
      `<th style="width:28px"><input type="checkbox" id="selAllPo" onchange="toggleSelAll('po')"></th>` +
      visPo.map(c=>`<th ${sortableKeys.includes(c.key)?`onclick="sortT('po','${c.key}')"`:''}>${c.label}</th>`).join('') +
      `<th style="width:84px"></th>`;
  }
  if (advTable) {
    const sortableKeys = ['suppNo','supplier','po','amount','advanceAmount','date','status'];
    advTable.querySelector('thead tr').innerHTML =
      `<th style="width:28px"><input type="checkbox" id="selAllAdv" onchange="toggleSelAll('advance')"></th>` +
      visAdv.map(c=>`<th ${sortableKeys.includes(c.key)?`onclick="sortT('adv','${c.key}')"`:''}>${c.label}</th>`).join('') +
      `<th style="width:84px"></th>`;
  }

  const emptyPo  = `<tr class="erow"><td colspan="${colspan_po}"><div class="empty"><i data-lucide="file-text" class="e-ico"></i><p>${q?'No results':'No PO entries yet'}</p><span>${q?'Try a different search':'Fill the form and click Submit Request'}</span></div></td></tr>`;
  const emptyAdv = `<tr class="erow"><td colspan="${colspan_adv}"><div class="empty"><i data-lucide="landmark" class="e-ico"></i><p>${q?'No results':'No advance entries yet'}</p><span>${q?'Try a different search':'Choose Advance Payment or Includes Advance'}</span></div></td></tr>`;

  if (poTbody) {
    poTbody.innerHTML = pos.length===0 ? emptyPo : pos.map(e=>{
      const {suppNo,vendorName}=extractSupplier(e.supplier);
      const isTest=isSizeTestEntry(e);
      const classes=[]; if(e.status==='hold') classes.push('held-row'); if(e.status==='sent') classes.push('sent-row'); if(recentSent.has(e.id)) classes.push('just-sent-row'); if(isTest) classes.push('size-test-row');
      const rowCls=classes.length?` class="${classes.join(' ')}"`:'';
      const cells = visPo.map(c=>`<td>${getCellHtml(e,c.key,'po')}</td>`).join('');
      const selectCell=isTest?`<span class="size-test-badge">TEST</span>`:`<input type="checkbox" class="row-cb" value="${e.id}" onchange="updateSelBtns()">`;
      const actions=isTest?`<span class="size-test-badge">LOCAL ONLY</span>`:`<div class="row-acts">
          ${e.status!=='sent'?`<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>`:''}
          <button class="ra reuse" onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra ${e.on_hold?'unhold':'hold'}" onclick="toggleHold('${e.id}')" title="${e.on_hold?'Release':'Hold'}"><i data-lucide="${e.on_hold?'play-circle':'pause-circle'}"></i></button>
          <button class="ra del" onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>`;
      return `<tr${rowCls}>
        <td>${selectCell}</td>
        ${cells}
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  if (advTbody) {
    advTbody.innerHTML = advs.length===0 ? emptyAdv : advs.map(e=>{
      const {suppNo,vendorName}=extractSupplier(e.supplier);
      const isTest=isSizeTestEntry(e);
      const classes=[]; if(e.status==='hold') classes.push('held-row'); if(e.status==='sent') classes.push('sent-row'); if(recentSent.has(e.id)) classes.push('just-sent-row'); if(isTest) classes.push('size-test-row');
      const rowCls=classes.length?` class="${classes.join(' ')}"`:'';
      const cells = visAdv.map(c=>`<td>${getCellHtml(e,c.key,'adv')}</td>`).join('');
      const selectCell=isTest?`<span class="size-test-badge">TEST</span>`:`<input type="checkbox" class="row-cb" value="${e.id}" onchange="updateSelBtns()">`;
      const actions=isTest?`<span class="size-test-badge">LOCAL ONLY</span>`:`<div class="row-acts">
          ${e.status!=='sent'?`<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>`:''}
          <button class="ra reuse" onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra ${e.on_hold?'unhold':'hold'}" onclick="toggleHold('${e.id}')" title="${e.on_hold?'Release':'Hold'}"><i data-lucide="${e.on_hold?'play-circle':'pause-circle'}"></i></button>
          <button class="ra del" onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div>`;
      return `<tr${rowCls}>
        <td>${selectCell}</td>
        ${cells}
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }
  updateMainEmailSizeGuard();
  lucide.createIcons();
}

// ═══════════════════════════
//  SELECTION
// ═══════════════════════════
window.toggleSelAll = function(type) {
  const id=type==='po'?'selAllPo':'selAllAdv';
  const checked=document.getElementById(id).checked;
  const scope=type==='po'?'#po-tbody':'#advance-tbody';
  document.querySelectorAll(`${scope} .row-cb`).forEach(cb=>cb.checked=checked);
  updateSelBtns();
};

window.updateSelBtns = function() {
  const all=[...document.querySelectorAll('.row-cb:checked')];
  const allAdv=[...document.querySelectorAll('#advance-tbody .row-cb:checked')];
  const sentSelected=all.filter(cb=>entries.find(e=>e.id===cb.value)?.status==='sent');
  document.querySelectorAll('.dtable tbody tr').forEach(tr=>tr.classList.toggle('row-selected', !!tr.querySelector('.row-cb:checked')));
  const show=(id,n,cid)=>{
    const el=document.getElementById(id); const ce=document.getElementById(cid); if(!el) return;
    if(n>0){el.classList.add('show');if(ce)ce.textContent=n;}else el.classList.remove('show');
  };
  show('btn-delete-selected',  all.length,          'selected-count');
  show('btn-requeue-selected', sentSelected.length, 'requeue-count');
  show('btn-copy-advances',    allAdv.length,       'copy-count');
};

window.requeueSelected = async function() {
  const ids=Array.from(document.querySelectorAll('.row-cb:checked')).map(cb=>cb.value).filter(id=>entries.find(e=>e.id===id)?.status==='sent');
  if(!ids.length) return toast('Select one or more sent records to re-queue','info');
  clearRecentlySent(ids);
  if (DEMO_MODE) { entries.forEach(e=>{if(ids.includes(e.id)){e.is_sent=false;e.on_hold=false;e.status='pending';}}); toast(`Re-queued ${ids.length} records`,'success'); renderDashboard(); return; }
  try {
    const {error}=await supabaseClient.from('entries').update({is_sent:false,on_hold:false}).in('id',ids);
    if(error) throw error;
    toast(`Re-queued ${ids.length} records`,'success');
    await loadEntries();
  } catch(err){ toast('Requeue failed: '+err.message,'error'); }
};

window.deleteSelected = async function() {
  const ids=Array.from(document.querySelectorAll('.row-cb:checked')).map(cb=>cb.value);
  if(!ids.length) return;
  if(!confirm(`Delete ${ids.length} selected records?`)) return;
  if (DEMO_MODE) { entries=entries.filter(e=>!ids.includes(e.id)); toast(`Deleted ${ids.length} records`,'success'); renderDashboard(); return; }
  try {
    const {error}=await supabaseClient.from('entries').delete().in('id',ids);
    if(error) throw error;
    toast(`Deleted ${ids.length} records`,'success');
    await loadEntries();
  } catch(err){ toast('Delete failed: '+err.message,'error'); }
};

// ═══════════════════════════
//  CALCULATE
// ═══════════════════════════
function calculate() {
  const amt=gn('amount');
  const rates={SAR:1,USD:3.75,EUR:4.10,GBP:4.80,AED:1.02,BHD:9.95,KWD:12.20,OMR:9.75,QAR:1.03,CNY:0.52};
  const cur=curEl.value, rate=rates[cur]||1, sar=amt*rate;
  sarEl.value=sar.toFixed(2);
  const hint=document.getElementById('rate-hint');
  if(hint) hint.textContent=cur==='SAR'?'':`Rate: 1 ${cur} = ${rate} SAR`;

  const showAdv=typeEl.value==='Advance Approval'||(typeEl.value==='PO Approval'&&hasAdvEl.checked);
  if(showAdv){
    advFields.style.display='grid';
    const p=advPctEl.value==='custom'?gn('custom-percent'):gn('advance-percent');
    advAmtEl.value=(sar*p/100).toFixed(2);
    const ac=document.getElementById('advance-amount-cur');
    if(ac) ac.value=(amt*p/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})+' '+cur;
  } else {
    advFields.style.display='none';
    advAmtEl.value=0;
    const ac=document.getElementById('advance-amount-cur'); if(ac) ac.value='';
  }
  updateApprovalRoutePreview();
}

// ═══════════════════════════
//  DISPATCH DELIVERY OPTIONS + PDF
// ═══════════════════════════
function syncDispatchOptionsUI() {
  document.querySelectorAll('input[name="dispatch-grouping"]').forEach(r=>r.checked=(r.value===dispatchGrouping));
  document.querySelectorAll('input[name="dispatch-content"]').forEach(r=>r.checked=(r.value===dispatchContent));
  const note=document.getElementById('pdf-setup-note');
  if(note) note.style.display=(dispatchContent==='pdf'||dispatchGrouping==='combined')?'flex':'none';
  lucide.createIcons();
}

function getDispatchModeText() {
  const grouping = dispatchGrouping==='separate' ? 'Separate FM / GM / Advance emails' : 'Combined — one email';
  const content = dispatchContent==='pdf' ? 'Clean PDF attachment' : 'Tables inside email';
  return `${grouping} · ${content}`;
}

function requiredDispatchRoutes(e) {
  if (isAdvanceEntry(e)) return ['ADV'];
  const r=getApprovalRoute(e);
  return r==='GM' ? ['FM','GM'] : r==='FM' ? ['FM'] : [];
}

function buildDispatchJobs(list) {
  if(dispatchGrouping==='combined') return [{section:'COMBINED',label:'Approval Summary',entries:[...list]}];
  const g=getDispatchGroups(list);
  return [
    {section:'FM',label:'FM Approval',entries:g.fm},
    {section:'GM',label:'GM Approval',entries:g.gm},
    {section:'ADV',label:'Advance Payments',entries:g.advances},
  ].filter(j=>j.entries.length);
}

function pdfSafeText(v) {
  return String(v ?? '').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
}

function createDispatchPdf(entriesList, section='COMBINED', partNo=1, totalParts=1) {
  if (!window.jspdf?.jsPDF) throw new Error('PDF library did not load. Check your internet connection and retry.');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
  const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
  const fileDate=new Date().toISOString().slice(0,10);
  const titleMap={FM:'FM Approval',GM:'GM Approval',ADV:'Advance Payments',COMBINED:'Procurement Approval Summary'};
  const title=titleMap[section]||'Procurement Approval Summary';
  const partLabel=totalParts>1?` - Part ${partNo} of ${totalParts}`:'';

  doc.setFont('helvetica','bold'); doc.setFontSize(17); doc.text(`${title}${partLabel}`,40,42);
  doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(100);
  doc.text(`${today}  |  Generated from Procurement Flow`,40,58);
  doc.setDrawColor(220); doc.line(40,68,802,68); doc.setTextColor(20);
  let y=84;

  const addTable=(sectionTitle,items,isAdvance=false)=>{
    if(!items.length) return;
    if(y>525){doc.addPage();y=50;}
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(`${sectionTitle} (${items.length})`,40,y); y+=8;
    let head, body;
    if(isAdvance){
      head=[['PR #','PO #','Supplier','Description','PO Amount','Cur','Advance %','Advance SAR','Notes']];
      body=items.map(e=>[
        pdfSafeText(e.prSo||'-'),pdfSafeText(e.po||'-'),pdfSafeText(extractSupplier(e.supplier).vendorName),pdfSafeText(e.description||'-'),
        Number(e.amount||0).toLocaleString(),pdfSafeText(e.currency||''),`${Number(e.advancePercent||0)}%`,Number(e.advanceAmount||0).toLocaleString(),pdfSafeText(e.notes||'-')
      ]);
    } else {
      head=[['PR #','PO #','WO / SO #','Supplier','Description','Amount','Cur','SAR','Approvers']];
      body=items.map(e=>[
        pdfSafeText(e.prSo||'-'),pdfSafeText(e.po||'-'),pdfSafeText(e.woSo||'-'),pdfSafeText(extractSupplier(e.supplier).vendorName),pdfSafeText(e.description||'-'),
        Number(e.amount||0).toLocaleString(),pdfSafeText(e.currency||''),Number(e.amountSar||0).toLocaleString(),getEmailApprovers(e)
      ]);
    }
    doc.autoTable({startY:y,head,body,theme:'grid',margin:{left:40,right:40},styles:{font:'helvetica',fontSize:7.2,cellPadding:4,overflow:'linebreak',valign:'middle'},headStyles:{fillColor:[241,245,249],textColor:[15,23,42],fontStyle:'bold'},alternateRowStyles:{fillColor:[250,251,253]},columnStyles:isAdvance?{2:{cellWidth:105},3:{cellWidth:135},8:{cellWidth:120}}:{3:{cellWidth:100},4:{cellWidth:145},8:{cellWidth:62}}});
    y=doc.lastAutoTable.finalY+22;
  };

  if(section==='FM') addTable('FM Approval',entriesList,false);
  else if(section==='GM') addTable('GM Approval',entriesList,false);
  else if(section==='ADV') addTable('Advance Payments',entriesList,true);
  else {
    const g=getDispatchGroups(entriesList);
    addTable('FM Approval',g.fm,false);
    addTable('GM Approval',g.gm,false);
    addTable('Advance Payments',g.advances,true);
  }

  const pages=doc.internal.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120);
    doc.text(`GM Procurement Approval System  |  Page ${i} of ${pages}`,40,575);
  }
  const sectionSlug=section==='COMBINED'?'approval-summary':section.toLowerCase();
  const filename=`procurement-${sectionSlug}-${fileDate}${totalParts>1?`-part-${partNo}-of-${totalParts}`:''}.pdf`;
  const dataUri=doc.output('datauristring');
  return {doc,dataUri,filename,bytes:new TextEncoder().encode(dataUri).length};
}

async function downloadDispatchPdfPreview() {
  const pending=entries.filter(e=>e.status==='pending' && isDispatchEligible(e));
  if(!pending.length) return toast('No FM, GM or Advance items to export','info');
  try{
    const pdf=createDispatchPdf(pending,'COMBINED',1,1);
    pdf.doc.save(pdf.filename);
  }catch(err){toast('PDF failed: '+(err?.message||err),'error');}
}

// Build the COMPLETE formatted approval email independently from EmailJS.
// This intentionally has no 50 KB split because it is used for manual copy/paste.
function buildFullManualEmail(sourceEntries) {
  const list=(sourceEntries||[]).filter(e=>e.status==='pending' && isDispatchEligible(e));
  const groups=getDispatchGroups(list);
  const visPo=poCols.filter(c=>c.visible&&c.key!=='status');
  const visAdv=advCols.filter(c=>c.visible&&c.key!=='status');
  const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
  const primaryMgr=managerEmails[0]||managerEmail||'';
  const allCC=[...managerEmails.slice(1),...ccEmails].filter(Boolean).join(', ');
  const emailCellValue=(e,key,isPo=false)=>String((isPo&&key==='approval'?getEmailApprovers(e):getCellValue(e,key))??'');
  const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  // The table fragments intentionally use inline styles because the copied HTML is
  // pasted into Outlook/Gmail, where external CSS classes are not reliable.
  const buildSection=(title,items,cols,accent,isPo=false)=>{
    if(!items.length) return '';
    const emailCols=isPo?cols.map(c=>c.key==='approval'?{...c,label:'Approvers'}:c):cols;
    const th='background:#f8fafc;color:#0f172a;padding:7px 8px;border:1px solid #e2e8f0;text-align:left;font-weight:700;white-space:nowrap;';
    const td='padding:7px 8px;border:1px solid #e2e8f0;vertical-align:top;color:#334155;';
    const hdrs=[...emailCols.map(c=>c.label),'Status'].map(h=>`<th style="${th}">${esc(h)}</th>`).join('');
    const rows=items.map(e=>`<tr>${[...emailCols.map(c=>`<td style="${td}">${esc(emailCellValue(e,c.key,isPo))}</td>`),`<td style="${td}">Pending</td>`].join('')}</tr>`).join('');
    const total=items.reduce((sum,e)=>sum+(isAdvanceEntry(e)?Number(e.advanceAmount||0):Number(e.amountSar||0)),0);
    return `<div style="margin:0 0 18px;">\n      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 8px;">\n        <h3 style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;margin:0;color:${accent};font-size:15px;font-weight:700;">${esc(title)}</h3>\n        <span style="font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;color:#64748b;font-size:12px;font-weight:600;">${items.length} item${items.length===1?'':'s'} · ${total.toLocaleString()} SAR</span>\n      </div>\n      <table style="border-collapse:collapse;width:100%;font-size:12px;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background:#ffffff;"><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table>\n    </div>`;
  };

  const fmH=buildSection('FM Approval',groups.fm,visPo,'#2563eb',true);
  const gmH=buildSection('GM Approval',groups.gm,visPo,'#7c3aed',true);
  const advH=buildSection('Advance Payments',groups.advances,visAdv,'#d97706',false);
  const poTable=fmH+gmH;
  const uniquePoEntries=list.filter(e=>!isAdvanceEntry(e));
  const poCount=uniquePoEntries.length;
  const totalPo=uniquePoEntries.reduce((s,e)=>s+Number(e.amountSar||0),0);
  const totalAdv=groups.advances.reduce((s,e)=>s+Number(e.advanceAmount||0),0);
  const grandTotal=totalPo+totalAdv;
  const subject=`GM Procurement Approval Request - ${today}`;

  // Mirrors the user's EmailJS template so Copy Full Email looks the same when
  // pasted into a new Outlook/Gmail message.
  const html=`<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; padding: 30px; color: #1e293b;">\n  <div style="text-align: center; border-bottom: 3px solid #2563eb; padding-bottom: 20px; margin-bottom: 25px; background: white; padding-top: 20px; border-radius: 8px 8px 0 0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">\n    <h2 style="margin: 0; color: #0f172a; letter-spacing: 1px; font-weight: 700;">GM PROCUREMENT APPROVAL REQUEST</h2>\n    <p style="margin: 5px 0 0; color: #64748b; font-size: 14px; font-weight: 500;">Procurement Department | Internal System Dispatch</p>\n  </div>\n\n  <div style="background: white; padding: 20px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); margin-bottom: 25px;">\n    <p style="color: #334155; font-size: 15px; line-height: 1.6; margin: 0;">\n      Dear GM,<br><br>\n      Please review the following approval requests gathered from the Procurement Database today.\n    </p>\n  </div>\n\n  <div style="background-color: #ffffff; border-left: 5px solid #3b82f6; border-radius: 6px; padding: 20px; margin: 25px 0 15px; display: table; width: 100%; box-sizing: border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">\n    <div style="display: table-cell; width: 50%; vertical-align: middle;">\n      <p style="margin: 0; font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">PO PENDING ITEMS</p>\n      <h3 style="margin: 8px 0 0; color: #0f172a; font-size: 20px;">${poCount.toLocaleString()} Tracking</h3>\n    </div>\n    <div style="display: table-cell; width: 50%; text-align: right; vertical-align: middle;">\n      <p style="margin: 0; font-size: 11px; color: #2563eb; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">TOTAL PO AMOUNT (SAR)</p>\n      <h3 style="margin: 8px 0 0; color: #2563eb; font-size: 22px;">${totalPo.toLocaleString()}</h3>\n    </div>\n  </div>\n\n  <div style="margin-bottom: 30px; overflow-x: auto; background: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">\n    ${poTable || '<p style="margin:0;color:#94a3b8;font-size:13px;">No PO approval items.</p>'}\n  </div>\n\n  <div style="background-color: #ffffff; border-left: 5px solid #f59e0b; border-radius: 6px; padding: 20px; margin: 25px 0 15px; display: table; width: 100%; box-sizing: border-box; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">\n    <div style="display: table-cell; width: 50%; vertical-align: middle;">\n      <p style="margin: 0; font-size: 11px; color: #64748b; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">ADVANCE REQUESTS</p>\n      <h3 style="margin: 8px 0 0; color: #0f172a; font-size: 20px;">${groups.advances.length.toLocaleString()} Tracking</h3>\n    </div>\n    <div style="display: table-cell; width: 50%; text-align: right; vertical-align: middle;">\n      <p style="margin: 0; font-size: 11px; color: #d97706; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">TOTAL ADVANCES AMOUNT (SAR)</p>\n      <h3 style="margin: 8px 0 0; color: #d97706; font-size: 22px;">${totalAdv.toLocaleString()}</h3>\n    </div>\n  </div>\n\n  <div style="margin-bottom: 30px; overflow-x: auto; background: white; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">\n    ${advH || '<p style="margin:0;color:#94a3b8;font-size:13px;">No advance requests.</p>'}\n  </div>\n\n  <div style="text-align: right; background-color: #ffffff; padding: 20px; border-radius: 6px; border: 1px solid #e2e8f0; margin-top: 25px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">\n    <p style="margin: 0; font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; font-weight: bold;">Grand Total Required (SAR)</p>\n    <h2 style="margin: 10px 0 0; color: #059669; font-size: 28px; font-weight: 800;">${grandTotal.toLocaleString()}</h2>\n  </div>\n\n  <div style="margin-top: 35px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px;">\n    <p style="margin: 0;">This is an automated dispatch from the Olayan GM Procurement Approval System.</p>\n  </div>\n</div>`;

  // Estimate the same dynamic-variable footprint a single full EmailJS HTML message would use.
  const estimatedParams={
    subject_line:subject,to_email:primaryMgr,cc_email:allCC,
    po_table:poTable,fm_table:fmH,gm_table:gmH,adv_table:advH,html_body:html,
    summary_count:list.length,po_count:poCount,fm_count:groups.fm.length,gm_count:groups.gm.length,adv_count:groups.advances.length,
    total_po_sar:totalPo.toLocaleString(),total_adv_sar:totalAdv.toLocaleString(),total_sar:grandTotal.toLocaleString()
  };
  const bytes=new TextEncoder().encode(JSON.stringify(estimatedParams)).length;
  const temp=document.createElement('div'); temp.innerHTML=html;
  const plain=`${subject}\n\n${temp.innerText || temp.textContent || ''}`;
  return {subject,html,plain,bytes,count:list.length,poCount,totalPo,totalAdv,grandTotal};
}

function updateMainEmailSizeGuard() {
  const pending=getDispatchPendingEntries();
  const alert=document.getElementById('main-email-limit-alert');
  const textEl=document.getElementById('main-email-limit-text');
  const status=document.getElementById('size-test-status');
  const clearBtn=document.getElementById('btn-main-clear-limit');
  const next=document.getElementById('qov-next-send');

  const report=buildFullManualEmail(pending);
  const kb=report.bytes/1024;
  const over=report.bytes>=EMAILJS_HARD_LIMIT_BYTES;
  emailSizeAutoBlocked=over;

  if(alert) alert.classList.toggle('show',over);
  if(textEl && over){
    textEl.textContent=`Full combined email ≈ ${kb.toFixed(1)} KB across ${pending.length} pending approval request${pending.length===1?'':'s'}. Automatic dispatch is paused. Copy the complete email and paste it into Outlook/Gmail.`;
  }
  if(next) next.textContent=over?'Paused · email >50 KB':(dailySendTime||'Off');

  if(clearBtn) clearBtn.style.display=sizeTestRows.length?'inline-flex':'none';
  if(status){
    status.classList.remove('running','limit');
    if(sizeTestRows.length){
      status.textContent=`${sizeTestRows.length} TEST POs · ${kb.toFixed(1)} KB`;
      status.classList.add(over?'limit':'running');
    }else{
      status.textContent=over?`${kb.toFixed(1)} KB · limit reached`:`${kb.toFixed(1)} KB current`;
      if(over) status.classList.add('limit');
    }
  }
}

function updateEmailSizeWarning(sourceEntries) {
  const warn=document.getElementById('email-size-warning');
  const txt=document.getElementById('email-size-warning-text');
  const btn=document.getElementById('btn-copy-full-email');
  if(!warn||!txt||!btn) return;
  const report=buildFullManualEmail(sourceEntries);
  const kb=report.bytes/1024;
  const warningAt=42*1024, hardAt=50*1024;
  warn.classList.remove('show','danger');
  btn.classList.remove('limit-active','limit-danger');
  btn.title=`Copy the complete formatted email (${kb.toFixed(1)} KB estimated EmailJS variables)`;
  if(report.bytes>=hardAt){
    warn.classList.add('show','danger');
    btn.classList.add('limit-active','limit-danger');
    txt.textContent=`The complete inline email is about ${kb.toFixed(1)} KB, above EmailJS' 50 KB variables limit. Use Copy Full Email to paste the entire formatted list into Outlook/Gmail, or use the PDF option.`;
    toast('EmailJS size limit reached — Copy Full Email is ready as a manual fallback.','error');
  }else if(report.bytes>=warningAt){
    warn.classList.add('show');
    btn.classList.add('limit-active');
    txt.textContent=`The complete inline email is about ${kb.toFixed(1)} KB and is approaching EmailJS' 50 KB limit. Copy Full Email is available if you prefer to paste the full list manually.`;
    toast('Approval email is close to the EmailJS size limit.','info');
  }
}

function fallbackRichCopy(html) {
  const host=document.createElement('div');
  host.contentEditable='true';
  host.setAttribute('aria-hidden','true');
  host.style.cssText='position:fixed;left:-10000px;top:0;width:1000px;background:#fff;color:#000;';
  host.innerHTML=html;
  document.body.appendChild(host);
  const range=document.createRange(); range.selectNodeContents(host);
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  const ok=document.execCommand('copy');
  sel.removeAllRanges(); host.remove();
  return ok;
}

async function copyFullEmail() {
  const pending=entries.filter(e=>e.status==='pending' && isDispatchEligible(e));
  if(!pending.length) return toast('No FM, GM or Advance items to copy','info');
  const report=buildFullManualEmail(pending);
  try{
    if(navigator.clipboard?.write && window.ClipboardItem){
      const item=new ClipboardItem({
        'text/html':new Blob([report.html],{type:'text/html'}),
        'text/plain':new Blob([report.plain],{type:'text/plain'})
      });
      await navigator.clipboard.write([item]);
    }else if(!fallbackRichCopy(report.html)){
      throw new Error('Browser clipboard API is unavailable');
    }
    toast(`Full formatted email copied · ${report.count} requests. Paste it into a new email.`, 'success');
  }catch(err){
    try{await navigator.clipboard.writeText(report.plain);toast('Copied as plain text. Your browser blocked rich-format clipboard access.','info');}
    catch{toast('Copy failed — allow clipboard access for this site and retry.','error');}
  }
}

// ═══════════════════════════
//  SETTINGS-ONLY LOAD TEST — EMAILJS SIZE LIMIT
// ═══════════════════════════
function isSizeTestEntry(e) {
  return String(e?.id || '').startsWith(SIZE_TEST_PREFIX);
}

function makeSizeTestEntry(i) {
  const n=String(i+1).padStart(3,'0');
  const today=new Date().toISOString().slice(0,10);
  const kind=i%3; // FM / GM-value / GM-CAPEX — all are PO rows, no advances.
  const isFm=kind===0;
  const isCapex=kind===2;
  const amount=isFm ? 32000 + i*11 : (isCapex ? 18000 + i*13 : 78000 + i*17);
  return {
    id:`${SIZE_TEST_PREFIX}${i+1}`, date:today,
    prSo:`TEST-PR-${n}`, woSo:'N/A',
    po:isCapex?`25${String(100000+i).slice(-6)}`:`35${String(100000+i).slice(-6)}`,
    description:`TEST PO ${n} — temporary procurement approval row used only to reach the EmailJS message-size limit and test the Copy Full Email fallback`,
    category:isCapex?'Capex':'Material purchase',
    supplier:`TEST-${n} - Temporary Supplier ${n}`,
    amount, currency:'SAR', amountSar:amount, advancePercent:0, advanceAmount:0,
    notes:`TEST ONLY — browser-memory row ${n}. Never saved to Supabase and never sent through EmailJS.`,
    is_sent:false, status:'pending', on_hold:false, __sizeTest:true
  };
}

function getDispatchPendingEntries() {
  return entries.filter(e=>e.status==='pending' && isDispatchEligible(e));
}

async function fillMainToEmailLimit() {
  // Start fresh each time and keep all real rows exactly as they are.
  sizeTestRows=[];
  entries=entries.filter(e=>!isSizeTestEntry(e));
  const target=51.2*1024;
  let report=buildFullManualEmail(getDispatchPendingEntries());
  let added=0;

  while(report.bytes<target && added<500){
    const row=makeSizeTestEntry(added);
    sizeTestRows.push(row);
    entries.push(row);
    added++;
    if(added<10 || added%3===0) report=buildFullManualEmail(getDispatchPendingEntries());
  }
  report=buildFullManualEmail(getDispatchPendingEntries());
  renderDashboard();
  updateSupplierList();
  buildReuseMenu();
  toast(`Added ${added} local TEST POs · full email ≈ ${(report.bytes/1024).toFixed(1)} KB. Auto-dispatch is paused while the limit is exceeded.`,'success');
}

function clearMainSizeTestRows() {
  const removed=sizeTestRows.length;
  sizeTestRows=[];
  entries=entries.filter(e=>!isSizeTestEntry(e));
  renderDashboard();
  updateSupplierList();
  buildReuseMenu();
  toast(removed?`Removed ${removed} temporary TEST POs.`:'No test POs to clear.','info');
}

// ═══════════════════════════
//  EMAIL — SAFE SPLITTING + PDF OPTION
// ═══════════════════════════
// Uses a per-minute lock stored in supabase settings to prevent
// multiple tabs or rapid interval ticks from sending twice.
async function openDispatchPreview() {
  const pending=entries.filter(e=>e.status==='pending' && isDispatchEligible(e));
  if (!pending.length) return toast('No FM, GM or Advance items to dispatch','info');
  const groups=getDispatchGroups(pending);
  const visPo=poCols.filter(c=>c.visible && c.key!=='status');
  const visAdv=advCols.filter(c=>c.visible && c.key!=='status');
  const ts='border-collapse:collapse;width:100%;font-size:12px;font-family:Inter,sans-serif;margin-bottom:16px';
  const ths='background:#f4f7fb;color:#334155;padding:7px 8px;border:1px solid #e2e8f0;text-align:left';
  const tds='padding:7px 8px;border:1px solid #e2e8f0;vertical-align:top';
  const section=(title,items,cols,icon,isPo=false)=>{
    if(!items.length) return '';
    const emailCols = isPo ? cols.map(c => c.key === 'approval' ? {...c, label:'Approvers'} : c) : cols;
    const hdrs=[...emailCols.map(c=>`<th style="${ths}">${c.label}</th>`),`<th style="${ths}">Status</th>`].join('');
    const rows=items.map(e=>'<tr>'+[...emailCols.map(c=>`<td style="${tds}">${isPo && c.key==='approval' ? getEmailApprovers(e) : getCellValue(e,c.key)}</td>`),`<td style="${tds}">Pending</td>`].join('')+'</tr>').join('');
    return `<div class="preview-count">${icon} ${title} (${items.length})</div><table style="${ts}"><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table>`;
  };
  const html=section('FM Approval',groups.fm,visPo,'🟦',true)+section('GM Approval',groups.gm,visPo,'🟪',true)+section('Advance Payments',groups.advances,visAdv,'🟧');
  const summary=document.getElementById('dispatch-mode-summary');
  if(summary) summary.innerHTML=`<i data-lucide="mail-check" style="width:14px;height:14px"></i><span><b>${getDispatchModeText()}</b>${dispatchGrouping==='combined'?' · Exactly one email. Oversized inline tables automatically move to one PDF attachment.':(dispatchContent==='pdf'?' · PDF will be generated separately for each email/part.':'')}</span>`;
  document.getElementById('preview-content').innerHTML=html;
  updateEmailSizeWarning(pending);
  const confirmBtn=document.getElementById('btn-confirm-dispatch');
  if(confirmBtn){
    const hasTests=sizeTestRows.length>0;
    confirmBtn.disabled=hasTests;
    confirmBtn.title=hasTests?'Temporary TEST POs are active. Clear them before sending.':'';
    if(hasTests && summary) summary.innerHTML += `<span class="preview-test-lock">TEST rows active · sending disabled · Copy Full Email remains available</span>`;
  }
  lucide.createIcons();
  document.getElementById('preview-modal').classList.add('open');
  settingsModal.classList.remove('open');
}

async function confirmDispatch() {
  if(sizeTestRows.length) return toast('TEST POs are active. Use Copy Full Email for the test, then Clear Test POs before sending.','error');
  document.getElementById('preview-modal').classList.remove('open');
  if (DEMO_MODE) { const demoIds=entries.filter(e=>e.status==='pending'&&isDispatchEligible(e)).map(e=>e.id); entries.forEach(e=>{if(demoIds.includes(e.id)){e.status='sent';e.is_sent=true;}}); rememberRecentlySent(demoIds); renderDashboard(); toast('Demo dispatch completed — SCM items remain in the app','success'); document.getElementById('success-modal').classList.add('open'); return; }
  await sendEmail(false);
}

async function sendEmail(isScheduled=false) {
  if (isSending) return false;
  if(sizeTestRows.length){
    if(!isScheduled) toast('Temporary TEST POs are active. Clear them before sending.','error');
    return false;
  }
  let pending=entries.filter(e=>e.status==='pending' && isDispatchEligible(e));
  if (!pending.length) { if(!isScheduled) toast('No FM, GM or Advance items to send','info'); return false; }

  // Automatic sending must never hit EmailJS' hard inline-variable limit.
  // Manual dispatch remains available because Combined mode can intentionally fall back to PDF.
  if(isScheduled){
    const scheduledReport=buildFullManualEmail(pending);
    if(scheduledReport.bytes>=EMAILJS_HARD_LIMIT_BYTES){
      emailSizeAutoBlocked=true;
      updateMainEmailSizeGuard();
      return false;
    }
  }

  const nowMinute = new Date().toISOString().slice(0,16);
  if (isScheduled && sendEmail._lastMinute === nowMinute) return false;
  if (isScheduled) sendEmail._lastMinute = nowMinute;

  isSending=true;
  let ids=[];
  const completedRoutes=new Map();
  const EMAILJS_SAFE_BYTES=36*1024;
  const PDF_SAFE_BYTES=420*1024; // conservative for attachment-capable EmailJS plans
  const RATE_DELAY_MS=1150;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const paramsBytes=params=>{
    const copy={...params}; delete copy.approval_pdf;
    return new TextEncoder().encode(JSON.stringify(copy)).length;
  };
  const markDone=(batch,section)=>{
    batch.forEach(e=>{
      const set=completedRoutes.get(e.id)||new Set();
      if(section==='COMBINED') requiredDispatchRoutes(e).forEach(r=>set.add(r)); else set.add(section);
      completedRoutes.set(e.id,set);
    });
  };
  const isFullyDone=e=>requiredDispatchRoutes(e).every(r=>completedRoutes.get(e.id)?.has(r));

  try{
    const primaryMgr=managerEmails[0]||managerEmail;
    if(!primaryMgr) throw new Error('Manager email not set — add one in Settings → Email tab');
    if(!EMAILJS_SERVICE_ID||!EMAILJS_TEMPLATE_ID||!EMAILJS_PUBLIC_KEY) throw new Error('EmailJS keys missing in Settings');
    if(typeof emailjs==='undefined') throw new Error('EmailJS library not loaded. Check your internet connection.');
    if(dispatchContent==='pdf' && !window.jspdf?.jsPDF) throw new Error('PDF library did not load. Check your internet connection.');

    ids=pending.map(e=>e.id);
    const {data:claimed,error:ue}=await supabaseClient.from('entries').update({is_sent:true}).in('id',ids).eq('is_sent',false).eq('on_hold',false).select('id');
    if(ue) throw ue;
    const claimedIds=(claimed||[]).map(r=>r.id);
    pending=pending.filter(e=>claimedIds.includes(e.id)); ids=claimedIds;
    if(!pending.length){await loadEntries();return true;}

    const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    const extraMgrs=managerEmails.slice(1);
    const allCC=[...extraMgrs,...ccEmails].filter(Boolean).join(', ');
    const visPo=poCols.filter(c=>c.visible&&c.key!=='status');
    const visAdv=advCols.filter(c=>c.visible&&c.key!=='status');
    const emailCellValue=(e,key,isPo=false)=>String((isPo&&key==='approval'?getEmailApprovers(e):getCellValue(e,key))??'');

    const buildHtmlSection=(title,items,cols,accent,isPo=false)=>{
      if(!items.length) return '';
      const emailCols=isPo?cols.map(c=>c.key==='approval'?{...c,label:'Approvers'}:c):cols;
      const th='background:#f8fafc;color:#0f172a;padding:6px 8px;border:1px solid #e2e8f0;text-align:left;';
      const td='padding:6px 8px;border:1px solid #e2e8f0;vertical-align:top;';
      const hdrs=[...emailCols.map(c=>c.label),'Status'].map(h=>`<th style="${th}">${h}</th>`).join('');
      const rows=items.map(e=>`<tr>${[...emailCols.map(c=>`<td style="${td}">${emailCellValue(e,c.key,isPo)}</td>`),`<td style="${td}">Pending</td>`].join('')}</tr>`).join('');
      const total=items.reduce((sum,e)=>sum+(isAdvanceEntry(e)?Number(e.advanceAmount||0):Number(e.amountSar||0)),0);
      return `<h3 style="margin:18px 0 7px;color:${accent}">${title} (${items.length}) · ${total.toLocaleString()} SAR</h3><table style="border-collapse:collapse;width:100%;font-size:12px;font-family:Arial,sans-serif"><thead><tr>${hdrs}</tr></thead><tbody>${rows}</tbody></table>`;
    };

    const makeParams=(batch,section,partNo,totalParts,pdfData=null,contentMode=dispatchContent)=>{
      let fm=[],gm=[],advs=[];
      if(section==='FM') fm=batch;
      else if(section==='GM') gm=batch;
      else if(section==='ADV') advs=batch;
      else {const g=getDispatchGroups(batch);fm=g.fm;gm=g.gm;advs=g.advances;}
      const fmH=contentMode==='html'?buildHtmlSection('FM Approval',fm,visPo,'#2563eb',true):'';
      const gmH=contentMode==='html'?buildHtmlSection('GM Approval',gm,visPo,'#7c3aed',true):'';
      const advH=contentMode==='html'?buildHtmlSection('Advance Payments',advs,visAdv,'#d97706',false):'';
      const label=section==='FM'?'FM Approval':section==='GM'?'GM Approval':section==='ADV'?'Advance Payments':'Procurement Approval';
      const partText=totalParts>1?` (Part ${partNo} of ${totalParts})`:'';
      const subject=`${label} Request - ${today}${partText}`;
      const totalFm=fm.reduce((s,e)=>s+Number(e.amountSar||0),0), totalGm=gm.reduce((s,e)=>s+Number(e.amountSar||0),0), totalAdv=advs.reduce((s,e)=>s+Number(e.advanceAmount||0),0);
      const uniquePoEntries=batch.filter(e=>!isAdvanceEntry(e));
      const uniquePo=uniquePoEntries.reduce((s,e)=>s+Number(e.amountSar||0),0);
      const poCount=uniquePoEntries.length;
      const contentBody=contentMode==='pdf'
        ? `<div style="font-family:Arial,sans-serif;padding:18px"><h2 style="margin:0 0 6px">${label}${partText}</h2><p style="color:#64748b">${today} · ${batch.length} request${batch.length===1?'':'s'}</p><p>The detailed approval report is attached as a PDF.</p></div>`
        : `<div style="font-family:Arial,sans-serif;font-size:13px;color:#0f172a;max-width:1100px;margin:0 auto;padding:20px"><h2 style="margin:0 0 4px">${label}${partText}</h2><p style="color:#64748b;font-size:12px;margin:0 0 16px">${today}</p>${fmH}${gmH}${advH}</div>`;
      const params={subject_line:subject,to_email:primaryMgr,cc_email:allCC,po_table:fmH+gmH,fm_table:fmH,gm_table:gmH,adv_table:advH,html_body:contentBody,summary_count:batch.length,po_count:poCount,fm_count:fm.length,gm_count:gm.length,adv_count:advs.length,total_po_sar:uniquePo.toLocaleString(),total_fm_sar:totalFm.toLocaleString(),total_gm_sar:totalGm.toLocaleString(),total_adv_sar:totalAdv.toLocaleString(),total_sar:(uniquePo+totalAdv).toLocaleString(),part_number:partNo,part_total:totalParts};
      if(pdfData){params.approval_pdf=pdfData.dataUri;params.approval_pdf_name=pdfData.filename;}
      return params;
    };

    const jobs=buildDispatchJobs(pending);
    const emailParts=[];

    if(dispatchGrouping==='combined'){
      // Combined means exactly ONE email. Never split the request into multiple messages.
      const job=jobs[0];
      if(dispatchContent==='pdf'){
        emailParts.push({job,batch:job.entries,forcePdf:true,autoPdf:false});
      }else{
        const probe=makeParams(job.entries,job.section,1,1,null,'html');
        if(paramsBytes(probe)<=EMAILJS_SAFE_BYTES){
          emailParts.push({job,batch:job.entries,forcePdf:false,autoPdf:false});
        }else{
          // Inline HTML would exceed EmailJS' variable limit. Keep ONE email and move
          // the full report into a PDF attachment instead of creating Part 1/2/3.
          if(!window.jspdf?.jsPDF) throw new Error('Combined report is too large for inline email tables and the PDF library did not load. Check your internet connection and retry.');
          emailParts.push({job,batch:job.entries,forcePdf:true,autoPdf:true});
        }
      }
    }else{
      // Separate mode can create multiple emails/parts when a single approval list is large.
      for(const job of jobs){
        if(dispatchContent==='html'){
          let current=[];
          for(const e of job.entries){
            const candidate=[...current,e];
            const probe=makeParams(candidate,job.section,1,99,null,'html');
            if(current.length && paramsBytes(probe)>EMAILJS_SAFE_BYTES){emailParts.push({job,batch:current,forcePdf:false,autoPdf:false});current=[e];} else current=candidate;
          }
          if(current.length) emailParts.push({job,batch:current,forcePdf:false,autoPdf:false});
        }else{
          // Start with modest PDF batches, then split again if the actual PDF is too large.
          for(let i=0;i<job.entries.length;i+=25) emailParts.push({job,batch:job.entries.slice(i,i+25),forcePdf:true,autoPdf:false});
        }
      }

      // Refine PDF batches using their actual encoded size in Separate mode only.
      if(dispatchContent==='pdf'){
        for(let i=0;i<emailParts.length;i++){
          const part=emailParts[i];
          const pdf=createDispatchPdf(part.batch,part.job.section,1,1);
          if(pdf.bytes>PDF_SAFE_BYTES && part.batch.length>1){
            const mid=Math.ceil(part.batch.length/2);
            emailParts.splice(i,1,{job:part.job,batch:part.batch.slice(0,mid),forcePdf:true,autoPdf:false},{job:part.job,batch:part.batch.slice(mid),forcePdf:true,autoPdf:false}); i--;
          }else if(pdf.bytes>PDF_SAFE_BYTES){
            throw new Error('A single PDF request is too large for the conservative attachment limit. Reduce very long Notes/Description text or use Tables in email.');
          }
        }
      }
    }

    // Count parts inside each logical job so subjects read Part x of y per FM/GM/Advance list.
    const jobPartTotals=new Map();
    emailParts.forEach(p=>jobPartTotals.set(p.job,(jobPartTotals.get(p.job)||0)+1));
    const jobPartIndex=new Map();

    const sendWithRetry=async(params)=>{
      let lastErr;
      for(let attempt=1;attempt<=2;attempt++){
        try{return await emailjs.send(EMAILJS_SERVICE_ID,EMAILJS_TEMPLATE_ID,params,EMAILJS_PUBLIC_KEY);}catch(err){lastErr=err;if(attempt<2) await sleep(1400);}
      }
      throw lastErr;
    };

    for(let i=0;i<emailParts.length;i++){
      const part=emailParts[i], job=part.job;
      const idx=(jobPartIndex.get(job)||0)+1; jobPartIndex.set(job,idx);
      const total=jobPartTotals.get(job)||1;
      let pdfData=null;
      const contentMode=part.forcePdf?'pdf':'html';
      if(part.forcePdf){
        pdfData=createDispatchPdf(part.batch,job.section,idx,total);
        if(part.autoPdf) toast('Combined list is too large for inline tables — sending one email with the full PDF attached.','info');
      }
      const params=makeParams(part.batch,job.section,idx,total,pdfData,contentMode);
      if(paramsBytes(params)>49*1024) throw new Error(`Email payload still exceeds EmailJS' 50 KB variables limit.`);
      toast(`Sending ${job.label}${total>1?` ${idx}/${total}`:''}…`,'info');
      await sendWithRetry(params);
      markDone(part.batch,job.section);
      if(i<emailParts.length-1) await sleep(RATE_DELAY_MS);
    }

    const fullyDone=pending.filter(isFullyDone).map(e=>e.id);
    const incomplete=pending.filter(e=>!isFullyDone(e)).map(e=>e.id);
    if(incomplete.length) await supabaseClient.from('entries').update({is_sent:false}).in('id',incomplete);
    rememberRecentlySent(fullyDone);
    toast(`Dispatched successfully · ${emailParts.length} email${emailParts.length===1?'':'s'}`,'success');
    document.getElementById('success-modal').classList.add('open');
    await loadEntries();
    return true;
  }catch(err){
    const rollback= pending.filter(e=>!isFullyDone(e)).map(e=>e.id);
    if(rollback.length){try{await supabaseClient.from('entries').update({is_sent:false}).in('id',rollback);}catch{}}
    const done=pending.filter(isFullyDone).map(e=>e.id); if(done.length) rememberRecentlySent(done);
    const msg=err?.text||err?.message||err?.status||JSON.stringify(err)||'Unknown error';
    console.error('Dispatch error full object:',err);
    toast('Dispatch failed: '+msg+(done.length?` (${done.length} requests fully completed)`:''),'error');
    if(isScheduled) sendEmail._lastMinute='';
    await loadEntries(); return false;
  }finally{isSending=false;}
}

// Schedule check — fires every 10s
// Guards: per-day lock + per-minute lock + isSending flag
let lastScheduledDate  = '';   // prevents re-firing same calendar day
let lastScheduledMinute = '';  // prevents re-firing same minute (multi-tab safe)

async function checkSchedule() {
  if (!dailySendTime || isSending) return;
  if (sizeTestRows.length) return; // test rows can never trigger a real automatic email

  const currentPending=getDispatchPendingEntries();
  if(currentPending.length && buildFullManualEmail(currentPending).bytes>=EMAILJS_HARD_LIMIT_BYTES){
    emailSizeAutoBlocked=true;
    updateMainEmailSizeGuard();
    return;
  }

  const now    = new Date();
  const hh     = String(now.getHours()).padStart(2,'0');
  const mm     = String(now.getMinutes()).padStart(2,'0');
  const t      = `${hh}:${mm}`;
  const today  = now.toISOString().split('T')[0];
  const minute = `${today}T${t}`;  // unique per-minute key

  // Already fired this minute or this day
  if (minute === lastScheduledMinute) return;
  if (today  === lastScheduledDate)   return;

  // Auto-dispatch only during the configured minute.
  // Opening/reloading the app after the scheduled time must NOT trigger a catch-up send.
  if (t !== dailySendTime) return;

  // Check freshly — reload from Supabase to avoid stale in-memory state
  let hasPending = entries.some(e => e.status === 'pending' && isDispatchEligible(e));
  if (!hasPending && supabaseClient) {
    try {
      const { data } = await supabaseClient.from('entries')
        .select('is_sent,on_hold,amount_sar,advance_amount').eq('is_sent',false).eq('on_hold',false).limit(50);
      hasPending = !!(data||[]).some(r=>Number(r.advance_amount||0)>0 || Number(r.amount_sar||0)>=10000);
    } catch {}
  }

  if (!hasPending) return;

  lastScheduledMinute = minute;
  const success = await sendEmail(true);
  if (success) {
    lastScheduledDate = today;
    try {
      await supabaseClient.from('settings').upsert([{key:'last_dispatch_date',value:today}],{onConflict:'key'});
    } catch {}
  } else {
    // Allow another attempt later in the same minute/day after a failure.
    lastScheduledMinute = '';
  }
}

// ═══════════════════════════
//  WEEKLY ADVANCES
// ═══════════════════════════
window.openWeeklyModal = function() {
  const tbody=document.getElementById('weekly-tbody'); if(!tbody) return;
  const ws=new Date(); ws.setDate(ws.getDate()-ws.getDay()); ws.setHours(0,0,0,0);
  const we=new Date(ws); we.setDate(ws.getDate()+6); we.setHours(23,59,59,999);
  const week=entries.filter(e=>e.advanceAmount>0&&e.date&&new Date(e.date)>=ws&&new Date(e.date)<=we);
  if(!week.length) return toast('No advances this week','info');
  tbody.innerHTML=week.map(e=>{
    const{suppNo,vendorName}=extractSupplier(e.supplier);
    const ac=((e.amount||0)*(e.advancePercent||0))/100;
    return `<tr><td><input type="checkbox" class="wk-cb" value="${e.id}" checked></td>
      <td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td>
      <td>${e.description||'-'}</td><td>${e.amount||0}</td><td>${e.currency||''}</td>
      <td>${ac}</td><td>${e.advanceAmount||0}</td><td>${e.notes||''}</td></tr>`;
  }).join('');
  document.getElementById('selAllWeekly').checked=true;
  document.getElementById('weekly-modal').classList.add('open');
  lucide.createIcons();
};
window.toggleSelAllWeekly=function(){const c=document.getElementById('selAllWeekly').checked;document.querySelectorAll('.wk-cb').forEach(cb=>cb.checked=c);};
window.copyWeeklyAdvances=function(){
  const ids=Array.from(document.querySelectorAll('.wk-cb:checked')).map(cb=>cb.value);
  if(!ids.length) return toast('No rows selected','info');
  const safe=s=>String(s).replace(/\t/g,' ').replace(/\n/g,' ');
  const text=entries.filter(e=>ids.includes(e.id)).map(e=>{
    const{suppNo,vendorName}=extractSupplier(e.supplier);
    const ac=((e.amount||0)*(e.advancePercent||0))/100;
    return `${safe(suppNo)}\t${safe(vendorName)}\t${safe(e.po||'')}\t${e.amount||0}\t${safe(e.currency||'')}\t${ac}\t${e.advanceAmount||0}\t${safe(e.notes||'')}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(()=>toast(`Copied ${ids.length} rows`,'success')).catch(()=>toast('Copy failed','error'));
};
window.copyAdvances=function(){
  const ids=Array.from(document.querySelectorAll('#advance-tbody .row-cb:checked')).map(cb=>cb.value);
  if(!ids.length) return toast('No advances selected','info');
  const safe=s=>String(s).replace(/\t/g,' ').replace(/\n/g,' ');
  const text=entries.filter(e=>ids.includes(e.id)).map(e=>{
    const{suppNo,vendorName}=extractSupplier(e.supplier);
    const ac=((e.amount||0)*(e.advancePercent||0))/100;
    return `${safe(suppNo)}\t${safe(vendorName)}\t${safe(e.po||'')}\t${e.amount||0}\t${safe(e.currency||'')}\t${ac}\t${e.advanceAmount||0}\t${safe(e.notes||'')}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(()=>{toast(`Copied ${ids.length} rows`,'success');updateSelBtns();}).catch(()=>toast('Copy failed','error'));
};

// ═══════════════════════════
//  EXPORT
// ═══════════════════════════
function exportToExcel(){
  if(!entries.length) return toast('No entries to export','info');
  const pos=entries.filter(e=>!e.advanceAmount||e.advanceAmount===0);
  const advs=entries.filter(e=>e.advanceAmount>0);
  const esc=s=>String(s).replace(/[<>&'"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
  const row=cells=>`<Row>${cells.map(c=>`<Cell><Data ss:Type="${typeof c==='number'?'Number':'String'}">${esc(c)}</Data></Cell>`).join('')}</Row>`;
  let xml=`<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`;
  xml+=`<Worksheet ss:Name="PO Approvals"><Table>${row(['Date','Description','Category','PR #','WO/SO #','PO #','Supplier','Amount','Currency','SAR','Notes','Status'])}`;
  pos.forEach(e=>xml+=row([e.date,e.description||'',e.category||'',e.prSo||'',e.woSo||'',e.po||'',e.supplier||'',e.amount,e.currency,e.amountSar,e.notes||'',e.status]));
  xml+=`</Table></Worksheet><Worksheet ss:Name="Advances"><Table>${row(['Date','Description','Category','PO #','Supplier','Amount','Currency','Adv%','Adv(Cur)','Adv(SAR)','Notes','Status'])}`;
  advs.forEach(e=>xml+=row([e.date,e.description||'',e.category||'',e.po||'',e.supplier||'',e.amount,e.currency,e.advancePercent,(e.amount*e.advancePercent/100),e.advanceAmount,e.notes||'',e.status]));
  xml+=`</Table></Worksheet></Workbook>`;
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([xml],{type:'application/vnd.ms-excel'}));
  a.download=`Approvals_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.xls`;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
}

// ═══════════════════════════
//  SUPPLIER MEMORY
// ═══════════════════════════
function updateSupplierList(){
  const dl=document.getElementById('supplier-list'); if(!dl) return;
  const forgotten=JSON.parse(localStorage.getItem('forgotten_suppliers')||'[]');
  const unique=[...new Set(entries.filter(e=>!isSizeTestEntry(e)).map(e=>e.supplier).filter(Boolean))].filter(s=>!forgotten.includes(s)).sort();
  dl.innerHTML=unique.map(s=>`<option value="${s}">`).join('');
}
function removeSupplierFromMemory(){
  const v=document.getElementById('supplier')?.value.trim(); if(!v) return toast('Type a supplier name first','info');
  if(!confirm(`Remove "${v}" from suggestions?`)) return;
  const f=JSON.parse(localStorage.getItem('forgotten_suppliers')||'[]');
  if(!f.includes(v)){f.push(v);localStorage.setItem('forgotten_suppliers',JSON.stringify(f));}
  updateSupplierList();buildReuseMenu();
  toast(`"${v}" removed`,'success');
  document.getElementById('supplier').value='';
}

// ═══════════════════════════
//  CC TAGS
// ═══════════════════════════
function renderCcTags(){
  const list=document.getElementById('cc-tags-list'); if(!list) return;
  list.innerHTML=ccEmails.map((e,i)=>`<div class="tag"><span title="${e}">${e}</span><svg onclick="removeCcTag(${i})" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="cursor:pointer;opacity:.75;flex-shrink:0"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`).join('');
}
window.addCcFromInput=function(){
  const input=document.getElementById('new-cc-input');
  const email=input?.value.trim();
  if(email&&email.includes('@')&&!ccEmails.includes(email)){ccEmails.push(email);input.value='';renderCcTags();saveSettings();}
};
window.removeCcTag=function(i){ccEmails.splice(i,1);renderCcTags();saveSettings();};

// ═══════════════════════════
//  THEME
// ═══════════════════════════
function updateThemeControl(theme){
  const ico=document.getElementById('theme-icon');
  const label=document.getElementById('theme-label');
  const btn=document.getElementById('btn-theme-toggle');
  const dark=theme==='dark';
  if(ico) ico.setAttribute('data-lucide',dark?'sun':'moon');
  if(label) label.textContent=dark?'Light':'Dark';
  if(btn) btn.title=dark?'Switch to light mode':'Switch to dark mode';
  lucide.createIcons();
}
function initTheme(){
  const t=localStorage.getItem('theme_preference')||'light';
  document.documentElement.setAttribute('data-theme',t);
  updateThemeControl(t);
}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'light';
  const nxt=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',nxt);
  localStorage.setItem('theme_preference',nxt);
  updateThemeControl(nxt);
}

// ═══════════════════════════
//  DRAFT SAVE / RESTORE
// ═══════════════════════════
const DRAFT_FIELDS=['approval-type','pr-so-number','po-number','wo-so-number','description','category','supplier','amount','currency','notes'];
function saveDraft(){
  if(editingId) return;
  const d={};
  DRAFT_FIELDS.forEach(id=>{const el=document.getElementById(id);if(el)d[id]=el.value;});
  d['has-advance']=hasAdvEl?.checked;
  d['pr-so-na']=document.getElementById('pr-so-na')?.checked || false;
  d['wo-so-na']=document.getElementById('wo-so-na')?.checked || false;
  d['advance-percent']=advPctEl?.value;
  d['custom-percent']=custPctEl?.value;
  sessionStorage.setItem('approval_form_draft',JSON.stringify(d));
}
function restoreDraft(){
  try{
    const d=JSON.parse(sessionStorage.getItem('approval_form_draft')||'{}');
    if(!Object.keys(d).length) return;
    DRAFT_FIELDS.forEach(id=>{const el=document.getElementById(id);if(el&&d[id]!==undefined)el.value=d[id];});
    setNAField('pr-so-number','pr-so-na',!!d['pr-so-na'] || String(d['pr-so-number']||'').toUpperCase()==='N/A', false);
    setNAField('wo-so-number','wo-so-na',!!d['wo-so-na'] || String(d['wo-so-number']||'').toUpperCase()==='N/A', false);
    if(hasAdvEl&&d['has-advance']) hasAdvEl.checked=d['has-advance'];
    if(advPctEl&&d['advance-percent']) advPctEl.value=d['advance-percent'];
    if(custPctEl&&d['custom-percent']) custPctEl.value=d['custom-percent'];
    if(advPctEl?.value==='custom') custPctGrp.style.display='block';
  }catch{}
}

// ═══════════════════════════
//  EMAIL LOCK
// ═══════════════════════════
async function hashPassword(pwd) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

let emailUnlocked = false;

window.toggleEmailLock = function() {
  if (emailUnlocked) {
    lockEmail();
  } else {
    // Show password modal
    document.getElementById('email-lock-modal').classList.add('open');
    setTimeout(() => document.getElementById('email-lock-password')?.focus(), 100);
  }
};

window.submitEmailLock = async function() {
  const pwd = document.getElementById('email-lock-password')?.value || '';
  const errEl = document.getElementById('email-lock-error');
  const hash = await hashPassword(pwd);

  // Compare against stored hash of SM112233
  const correctHash = await hashPassword('SM112233');
  if (hash === correctHash) {
    emailUnlocked = true;
    document.getElementById('email-lock-modal').classList.remove('open');
    document.getElementById('email-lock-password').value = '';
    errEl.style.display = 'none';
    showEmailFields();
    toast('Email settings unlocked', 'success');
    // If unlock was triggered by tab navigation, complete it
    if (window._pendingSettingsTab) {
      const pending = window._pendingSettingsTab;
      window._pendingSettingsTab = null;
      switchSettingsTab(pending);
    }
  } else {
    errEl.style.display = 'block';
    document.getElementById('email-lock-password').select();
  }
};

function showEmailFields() {
  const locked   = document.getElementById('email-locked-view');
  const unlocked = document.getElementById('email-unlocked-view');
  const btn      = document.getElementById('email-lock-btn');
  const ico      = document.getElementById('email-lock-icon');
  const tabIco   = document.getElementById('email-tab-lock-icon');
  if (locked)   locked.style.display   = 'none';
  if (unlocked) { unlocked.style.display = 'block'; void unlocked.offsetWidth; }
  if (btn) btn.classList.add('unlocked');
  if (ico)    { ico.setAttribute('data-lucide','unlock'); lucide.createIcons(); }
  if (tabIco) { tabIco.setAttribute('data-lucide','unlock'); tabIco.style.color='var(--green)'; tabIco.style.opacity='1'; lucide.createIcons(); }
}

function lockEmail() {
  emailUnlocked = false;
  const locked   = document.getElementById('email-locked-view');
  const unlocked = document.getElementById('email-unlocked-view');
  const btn      = document.getElementById('email-lock-btn');
  const ico      = document.getElementById('email-lock-icon');
  const tabIco   = document.getElementById('email-tab-lock-icon');
  if (locked)   locked.style.display   = 'block';
  if (unlocked) unlocked.style.display = 'none';
  if (btn) btn.classList.remove('unlocked');
  if (ico)    { ico.setAttribute('data-lucide','lock'); lucide.createIcons(); }
  if (tabIco) { tabIco.setAttribute('data-lucide','lock'); tabIco.style.color=''; tabIco.style.opacity='.5'; lucide.createIcons(); }
}

// Re-lock when settings modal closes
function setupEmailLockListeners() {
  // Lock email when clicking outside the unlock modal
  document.getElementById('email-lock-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('email-lock-modal')) {
      document.getElementById('email-lock-modal').classList.remove('open');
      document.getElementById('email-lock-password').value = '';
      document.getElementById('email-lock-error').style.display = 'none';
    }
  });
}

// ═══════════════════════════
//  LAYOUT
// ═══════════════════════════
function setupLayout(){
  const app=document.getElementById('app');
  const fab=document.getElementById('fab-restore');
  const btnSB=document.getElementById('btn-sb-toggle');
  const btnF=document.getElementById('btn-form-toggle');
  const btnM=document.getElementById('btn-maximize');

  btnSB?.addEventListener('click',()=>{
    if(app.classList.contains('maximized')) return;
    app.classList.toggle('sidebar-off');
    btnSB.classList.toggle('on',app.classList.contains('sidebar-off'));
  });
  btnF?.addEventListener('click',()=>{
    if(app.classList.contains('maximized')) return;
    const off=app.classList.toggle('form-off');
    btnF.classList.toggle('on',off);
    const ico=btnF.querySelector('i');
    if(ico){ico.setAttribute('data-lucide',off?'sidebar-open':'sidebar-close');lucide.createIcons();}
    if(fab) fab.style.display=off?'inline-flex':'none';
  });
  btnM?.addEventListener('click',()=>{
    const isMax=app.classList.contains('maximized');
    if(isMax){
      app.classList.remove('maximized','sidebar-off','form-off');
      btnM.classList.remove('on');
      const ico=btnM.querySelector('i');if(ico){ico.setAttribute('data-lucide','maximize-2');lucide.createIcons();}
      if(fab) fab.style.display='none';
    } else {
      app.classList.add('maximized','sidebar-off','form-off');
      btnM.classList.add('on');
      const ico=btnM.querySelector('i');if(ico){ico.setAttribute('data-lucide','minimize-2');lucide.createIcons();}
      if(fab) fab.style.display='inline-flex';
    }
  });
  fab?.addEventListener('click',()=>{
    app.classList.remove('maximized','sidebar-off','form-off');
    [btnSB,btnF,btnM].forEach(b=>b?.classList.remove('on'));
    const i1=btnM?.querySelector('i');if(i1){i1.setAttribute('data-lucide','maximize-2');lucide.createIcons();}
    const i2=btnF?.querySelector('i');if(i2){i2.setAttribute('data-lucide','sidebar-close');lucide.createIcons();}
    if(fab) fab.style.display='none';
  });

  document.addEventListener('keydown',e=>{
    const inp=['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);
    if(!inp&&e.key==='/'){e.preventDefault();document.getElementById('pipeline-search')?.focus();}
    if(!inp&&e.altKey&&e.key==='n'){e.preventDefault();document.getElementById('po-number')?.focus();document.querySelector('.form-inner')?.scrollTo({top:0,behavior:'smooth'});}
    if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key==='M'){e.preventDefault();btnM?.click();}
    if((e.metaKey||e.ctrlKey)&&e.key==='b'){e.preventDefault();btnSB?.click();}
  });
}

// ═══════════════════════════
//  LISTENERS
// ═══════════════════════════
form.addEventListener('submit', e=>handleSubmit(e, false));
document.getElementById('btn-save-hold')?.addEventListener('click', async e=>{ e.preventDefault(); if(form.reportValidity()) await handleSubmit({preventDefault:()=>{}}, true); });
form.addEventListener('input',  saveDraft);
form.addEventListener('change', saveDraft);
form.addEventListener('submit', ()=>setTimeout(()=>sessionStorage.removeItem('approval_form_draft'),1500));

amtEl.addEventListener('input',calculate);
document.getElementById('po-number')?.addEventListener('input',()=>{
  const po=gv('po-number');
  const category=document.getElementById('category');
  if (isCapexPO(po)) {
    if (category && (!category.value || category.dataset.autoCapex==='1')) { category.value='Capex'; category.dataset.autoCapex='1'; }
  } else if (category?.dataset.autoCapex==='1') {
    category.value=''; delete category.dataset.autoCapex;
  }
  updateApprovalRoutePreview();
});
document.getElementById('category')?.addEventListener('change',e=>{ if(e.target.dataset.autoCapex==='1' && e.target.value!=='Capex') delete e.target.dataset.autoCapex; });
curEl.addEventListener('change',calculate);
typeEl.addEventListener('change',calculate);
hasAdvEl.addEventListener('change',calculate);
advPctEl.addEventListener('change',()=>{
  custPctGrp.style.display=advPctEl.value==='custom'?'block':'none';
  calculate();
});
custPctEl.addEventListener('input',calculate);

document.getElementById('pr-so-na')?.addEventListener('change',e=>{ setNAField('pr-so-number','pr-so-na',e.target.checked); saveDraft(); });
document.getElementById('wo-so-na')?.addEventListener('change',e=>{ setNAField('wo-so-number','wo-so-na',e.target.checked); saveDraft(); });

document.getElementById('btn-settings')?.addEventListener('click',()=>settingsModal.classList.add('open'));
document.getElementById('btn-close-settings')?.addEventListener('click',()=>{
  settingsModal.classList.remove('open');
  lockEmail();
  // Switch back to connection tab so email tab isn't visible when reopened
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('on', b.dataset.tab === 'connection'));
  document.querySelectorAll('.stab-panel').forEach(p => p.style.display = 'none');
  const conn = document.getElementById('stab-connection'); if(conn) conn.style.display='block';
});
document.getElementById('btn-save-settings')?.addEventListener('click',saveSettings);
document.getElementById('btn-finalize')?.addEventListener('click',openDispatchPreview);
document.getElementById('btn-confirm-dispatch')?.addEventListener('click',confirmDispatch);
document.getElementById('btn-download-pdf')?.addEventListener('click',downloadDispatchPdfPreview);
document.getElementById('btn-close-preview')?.addEventListener('click',()=>document.getElementById('preview-modal').classList.remove('open'));
document.getElementById('btn-main-fill-limit')?.addEventListener('click',fillMainToEmailLimit);
document.getElementById('btn-main-clear-limit')?.addEventListener('click',clearMainSizeTestRows);
document.getElementById('btn-main-copy-full-email')?.addEventListener('click',copyFullEmail);
document.getElementById('btn-copy-full-email')?.addEventListener('click',copyFullEmail);
document.querySelectorAll('input[name="dispatch-grouping"]').forEach(r=>r.addEventListener('change',e=>{dispatchGrouping=e.target.value;localStorage.setItem('dispatch_grouping',dispatchGrouping);syncDispatchOptionsUI();}));
document.querySelectorAll('input[name="dispatch-content"]').forEach(r=>r.addEventListener('change',e=>{dispatchContent=e.target.value;localStorage.setItem('dispatch_content',dispatchContent);syncDispatchOptionsUI();}));
cancelBtn?.addEventListener('click',cancelEdit);
mgrEmailEl?.addEventListener('change',()=>{ managerEmail=mgrEmailEl.value.trim(); });
document.getElementById('btn-theme-toggle')?.addEventListener('click',toggleTheme);
document.getElementById('btn-activate-setup')?.addEventListener('click',activateDashboard);
document.getElementById('btn-export')?.addEventListener('click',exportToExcel);
document.getElementById('btn-remove-supplier')?.addEventListener('click',removeSupplierFromMemory);
document.getElementById('btn-close-weekly')?.addEventListener('click',()=>document.getElementById('weekly-modal').classList.remove('open'));

document.getElementById('new-cc-input')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===','){e.preventDefault();addCcFromInput();}
});
document.getElementById('new-mgr-input')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'){e.preventDefault();addManagerEmail();}
});

// Close modals on backdrop click
document.querySelectorAll('.mo').forEach(m=>{
  m.addEventListener('click',e=>{
    if(e.target===m){
      m.classList.remove('open');
      // If closing settings modal, lock email and reset to connection tab
      if(m.id==='settings-modal'){
        lockEmail();
        document.querySelectorAll('.stab').forEach(b=>b.classList.toggle('on',b.dataset.tab==='connection'));
        document.querySelectorAll('.stab-panel').forEach(p=>p.style.display='none');
        const conn=document.getElementById('stab-connection'); if(conn) conn.style.display='block';
      }
    }
  });
});

// ═══════════════════════════
//  BOOT
// ═══════════════════════════
setupLayout();
setupEmailLockListeners();
init();

// ═══════════════════════════
//  SETTINGS TABS
// ═══════════════════════════
window.switchSettingsTab = function(tab) {
  // Email tab requires unlock
  if (tab === 'email' && !emailUnlocked) {
    document.getElementById('email-lock-modal').classList.add('open');
    // After unlock, auto-navigate to email tab
    window._pendingSettingsTab = 'email';
    setTimeout(() => document.getElementById('email-lock-password')?.focus(), 100);
    return;
  }
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.stab-panel').forEach(p => p.style.display = 'none');
  const panel = document.getElementById('stab-' + tab);
  if (panel) panel.style.display = 'block';
  if (tab === 'status') runStatusChecks();
  if (tab === 'columns') renderColumnGrids();
};

// ═══════════════════════════
//  MULTIPLE MANAGER EMAILS
// ═══════════════════════════
function renderManagerEmails() {
  // Settings modal list
  const list = document.getElementById('mgr-emails-list');
  if (list) {
    if (!managerEmails.length) {
      list.innerHTML = '<div class="mgr-empty">No manager emails added yet</div>';
    } else {
      list.innerHTML = managerEmails.map((e, i) => `
        <div class="mgr-item">
          <span class="mgr-item-email" title="${e}">${e}</span>
          ${i === 0 ? '<span class="mgr-item-primary">Primary</span>' : ''}
          <button class="mgr-item-del" onclick="removeManagerEmail(${i})" title="Remove">
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>`).join('');
    }
  }

  // Sidebar display
  const sidebar = document.getElementById('mgr-emails-sidebar');
  if (sidebar) {
    if (!managerEmails.length) {
      sidebar.innerHTML = '<div style="font-size:.72rem;color:var(--t2)">No managers configured</div>';
    } else {
      sidebar.innerHTML = managerEmails.map(e => `
        <div class="mgr-sidebar-item">
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e}</span>
        </div>`).join('');
    }
  }
}

window.addManagerEmail = function() {
  const input = document.getElementById('new-mgr-input');
  const val = input?.value.trim();
  if (!val || !val.includes('@')) return toast('Enter a valid email', 'info');
  if (managerEmails.includes(val)) return toast('Already added', 'info');
  managerEmails.push(val);
  if (input) input.value = '';
  renderManagerEmails();
  // Auto-save to DB
  if (supabaseClient) {
    supabaseClient.from('settings').upsert([{key:'manager_emails', value:managerEmails.join(',')}],{onConflict:'key'})
      .then(() => toast('Manager email added','success'))
      .catch(() => toast('Save failed','error'));
  }
};

window.removeManagerEmail = function(i) {
  managerEmails.splice(i, 1);
  renderManagerEmails();
  if (supabaseClient) {
    supabaseClient.from('settings').upsert([{key:'manager_emails', value:managerEmails.join(',')}],{onConflict:'key'})
      .catch(() => {});
  }
};

// ═══════════════════════════
//  COLUMN CUSTOMIZER
// ═══════════════════════════
const PO_COLS_DEFAULT = [
  {key:'suppNo',    label:'Supp. No.',   visible:true},
  {key:'supplier',  label:'Vendor',      visible:true},
  {key:'po',        label:'PO #',        visible:true},
  {key:'amount',    label:'Amount',      visible:true},
  {key:'currency',  label:'Cur',         visible:true},
  {key:'amountSar', label:'SAR ⃁',      visible:true},
  {key:'approval',  label:'Approval',    visible:true},
  {key:'notes',     label:'Notes',       visible:true},
  {key:'date',      label:'Date',        visible:true},
  {key:'description',label:'Description',visible:true},
  {key:'category',  label:'Category',    visible:true},
  {key:'status',    label:'Status',      visible:true},
];

const ADV_COLS_DEFAULT = [
  {key:'suppNo',        label:'Supp. No.',   visible:true},
  {key:'supplier',      label:'Vendor',      visible:true},
  {key:'po',            label:'PO #',        visible:true},
  {key:'amount',        label:'PO Amt',      visible:true},
  {key:'currency',      label:'Cur',         visible:true},
  {key:'advCur',        label:'Adv (Cur)',   visible:true},
  {key:'advanceAmount', label:'Adv SAR ⃁',  visible:true},
  {key:'notes',         label:'Notes',       visible:true},
  {key:'date',          label:'Date',        visible:true},
  {key:'description',   label:'Description', visible:true},
  {key:'category',      label:'Category',    visible:true},
  {key:'status',        label:'Status',      visible:true},
];

let poCols  = PO_COLS_DEFAULT.map(c=>({...c}));
let advCols = ADV_COLS_DEFAULT.map(c=>({...c}));

function parseColConfig(json, defaults) {
  try {
    const saved = JSON.parse(json);
    if (saved && Array.isArray(saved) && saved.length > 0) {
      // Merge: keep saved order/visibility, add any new defaults not yet in saved
      const savedKeys = new Set(saved.map(c=>c.key));
      const merged = [...saved];
      defaults.forEach(d => { if (!savedKeys.has(d.key)) merged.push({...d}); });
      return merged;
    }
  } catch {}
  return defaults.map(c=>({...c}));
}

function loadColsFromSettings(settingsData) {
  const get = k => settingsData?.find(i=>i.key===k);
  const po  = get('col_config_po');
  const adv = get('col_config_adv');
  if (po)  poCols  = parseColConfig(po.value,  PO_COLS_DEFAULT);
  if (adv) advCols = parseColConfig(adv.value, ADV_COLS_DEFAULT);
  // Also migrate any old localStorage config on first load
  if (!po && !adv) {
    try {
      const lsPo  = localStorage.getItem('po_cols');
      const lsAdv = localStorage.getItem('adv_cols');
      if (lsPo)  poCols  = parseColConfig(lsPo,  PO_COLS_DEFAULT);
      if (lsAdv) advCols = parseColConfig(lsAdv, ADV_COLS_DEFAULT);
      // Push migrated config to Supabase so teammates get it too
      if ((lsPo || lsAdv) && supabaseClient) {
        supabaseClient.from('settings').upsert([
          {key:'col_config_po',  value: JSON.stringify(poCols)},
          {key:'col_config_adv', value: JSON.stringify(advCols)},
        ], {onConflict:'key'}).then(()=>{
          localStorage.removeItem('po_cols');
          localStorage.removeItem('adv_cols');
        });
      }
    } catch {}
  }
}

function renderColumnGrids() {
  renderColGrid('col-grid-po',  poCols,  'po');
  renderColGrid('col-grid-adv', advCols, 'adv');
}

function renderColGrid(gridId, cols, tableKey) {
  const grid = document.getElementById(gridId); if (!grid) return;
  grid.innerHTML = cols.map((col, i) => `
    <div class="col-item" draggable="true" data-idx="${i}" data-table="${tableKey}"
      ondragstart="colDragStart(event)" ondragover="colDragOver(event)" ondrop="colDrop(event)">
      <input type="checkbox" ${col.visible ? 'checked' : ''} onchange="toggleColVisible('${tableKey}',${i},this.checked)">
      <span class="col-item-name">${col.label}${col.custom?'<span style="font-size:.58rem;color:var(--a);margin-left:3px">custom</span>':''}</span>
      ${col.custom ? `<button onclick="removeCustomCol('${tableKey}',${i})" style="background:none;border:none;cursor:pointer;color:var(--t2);padding:0;display:flex;align-items:center;" title="Remove column"><svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` :
      `<span class="col-drag-handle"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="18"/></svg></span>`}
    </div>`).join('');
}

window.removeCustomCol = function(tableKey, idx) {
  const cols = tableKey === 'po' ? poCols : advCols;
  cols.splice(idx, 1);
  renderColGrid(tableKey === 'po' ? 'col-grid-po' : 'col-grid-adv', cols, tableKey);
};

let dragSrcIdx = null, dragSrcTable = null;

window.colDragStart = function(e) {
  dragSrcIdx   = parseInt(e.currentTarget.dataset.idx);
  dragSrcTable = e.currentTarget.dataset.table;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
};

window.colDragOver = function(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.col-item').forEach(el => el.classList.remove('drag-over'));
  e.currentTarget.classList.add('drag-over');
};

window.colDrop = function(e) {
  e.preventDefault();
  document.querySelectorAll('.col-item').forEach(el => el.classList.remove('dragging','drag-over'));
  const destIdx   = parseInt(e.currentTarget.dataset.idx);
  const destTable = e.currentTarget.dataset.table;
  if (destTable !== dragSrcTable || dragSrcIdx === destIdx) return;
  const cols = dragSrcTable === 'po' ? poCols : advCols;
  const [moved] = cols.splice(dragSrcIdx, 1);
  cols.splice(destIdx, 0, moved);
  renderColGrid(dragSrcTable === 'po' ? 'col-grid-po' : 'col-grid-adv', cols, dragSrcTable);
};

window.toggleColVisible = function(tableKey, idx, visible) {
  const cols = tableKey === 'po' ? poCols : advCols;
  cols[idx].visible = visible;
};

window.saveColumns = async function() {
  if (!supabaseClient) {
    toast('Not connected to database', 'error');
    return;
  }
  try {
    await supabaseClient.from('settings').upsert([
      {key:'col_config_po',  value: JSON.stringify(poCols)},
      {key:'col_config_adv', value: JSON.stringify(advCols)},
    ], {onConflict:'key'});
    renderDashboard();
    toast('Column layout saved — visible to all team members', 'success');
  } catch(err) {
    toast('Save failed: ' + (err.message||err), 'error');
  }
};

window.resetColumns = async function() {
  poCols  = PO_COLS_DEFAULT.map(c=>({...c}));
  advCols = ADV_COLS_DEFAULT.map(c=>({...c}));
  localStorage.removeItem('po_cols');
  localStorage.removeItem('adv_cols');
  if (supabaseClient) {
    await supabaseClient.from('settings').upsert([
      {key:'col_config_po',  value: JSON.stringify(poCols)},
      {key:'col_config_adv', value: JSON.stringify(advCols)},
    ], {onConflict:'key'});
  }
  renderColumnGrids();
  renderDashboard();
  toast('Columns reset to default for all team members', 'info');
};

// ═══════════════════════════
//  SYSTEM STATUS CHECKS
// ═══════════════════════════
window.runStatusChecks = async function() {
  const container = document.getElementById('status-checks');
  if (!container) return;

  const checks = [
    { label: 'Supabase Connection',     run: checkSupabase },
    { label: 'Manager Email',           run: checkManagerEmail },
    { label: 'EmailJS Configuration',   run: checkEmailJS },
    { label: 'Auto-Dispatch Schedule',  run: checkScheduleConfig },
    { label: 'Pending Entries',         run: checkPendingEntries },
    { label: 'On Hold Entries',         run: checkHoldEntries },
    { label: 'Database — entries table',run: checkEntriesTable },
  ];

  // Show spinners
  container.innerHTML = checks.map(c => `
    <div class="status-item">
      <div class="status-icon spin-icon"><svg class="spin" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg></div>
      <div class="status-body"><div class="status-label">${c.label}</div><div class="status-detail">Checking…</div></div>
    </div>`).join('');

  // Run all checks in parallel
  const results = await Promise.allSettled(checks.map(c => c.run()));

  container.innerHTML = results.map((r, i) => {
    const res = r.status === 'fulfilled' ? r.value : { status: 'fail', detail: r.reason?.message || 'Error' };
    const iconMap = {
      ok:   `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      warn: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
      fail: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    };
    return `
      <div class="status-item">
        <div class="status-icon ${res.status}">${iconMap[res.status]||iconMap.fail}</div>
        <div class="status-body">
          <div class="status-label">${checks[i].label}</div>
          <div class="status-detail">${res.detail}</div>
        </div>
      </div>`;
  }).join('');
};

async function checkSupabase() {
  if (!supabaseClient) return { status:'fail', detail:'Not connected. Enter Supabase URL and Key in Connection tab.' };
  const {error} = await supabaseClient.from('settings').select('key').limit(1);
  if (error) return { status:'fail', detail:'Connection error: ' + error.message };
  return { status:'ok', detail:'Connected to Supabase successfully.' };
}

async function checkManagerEmail() {
  if (!managerEmails.length && !managerEmail) return { status:'fail', detail:'No manager email configured. Add one in the Email tab.' };
  const count = managerEmails.length || 1;
  const primary = managerEmails[0] || managerEmail;
  return { status:'ok', detail:`${count} manager email${count>1?'s':''} configured. Primary: ${primary}` };
}

async function checkEmailJS() {
  if (!EMAILJS_SERVICE_ID) return { status:'fail', detail:'EmailJS Service ID missing. Add it in Connection tab.' };
  if (!EMAILJS_TEMPLATE_ID) return { status:'fail', detail:'EmailJS Template ID missing. Add it in Connection tab.' };
  if (!EMAILJS_PUBLIC_KEY)  return { status:'fail', detail:'EmailJS Public Key missing. Add it in Connection tab.' };
  if (typeof emailjs === 'undefined') return { status:'fail', detail:'EmailJS library not loaded. Check your internet connection.' };
  if (dispatchContent==='pdf') {
    if (!window.jspdf?.jsPDF) return { status:'fail', detail:'PDF mode selected but the PDF library did not load.' };
    return { status:'warn', detail:`EmailJS ready · PDF mode selected. Confirm your EmailJS template has Variable Attachment parameter "approval_pdf" and that your plan supports attachments.` };
  }
  return { status:'ok', detail:`EmailJS ready · Service: ${EMAILJS_SERVICE_ID} · Template: ${EMAILJS_TEMPLATE_ID}` };
}

async function checkScheduleConfig() {
  if (!dailySendTime) return { status:'fail', detail:'No auto-dispatch time set. Add one in Settings → Connection.' };
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2,'0');
  const mm  = String(now.getMinutes()).padStart(2,'0');
  const current = `${hh}:${mm}`;
  const detail = `Scheduled at ${dailySendTime} daily. Current time: ${current}. Last fired: ${lastScheduledDate||'not yet today'}.`;
  return { status:'ok', detail };
}

async function checkPendingEntries() {
  const pending = entries.filter(e => e.status === 'pending');
  if (!pending.length) return { status:'warn', detail:'No pending entries to dispatch.' };
  const sarTotal = pending.reduce((s,e) => s + (e.advanceAmount > 0 ? (e.advanceAmount||0) : (e.amountSar||0)), 0);
  return { status:'ok', detail:`${pending.length} pending entries · Total: ${sarTotal.toLocaleString()} SAR ⃁` };
}

async function checkHoldEntries() {
  const held = entries.filter(e => e.status === 'hold');
  if (!held.length) return { status:'ok', detail:'No entries currently on hold.' };
  return { status:'warn', detail:`${held.length} entr${held.length>1?'ies':'y'} on hold — these will NOT be dispatched.` };
}

async function checkEntriesTable() {
  if (!supabaseClient) return { status:'fail', detail:'Not connected.' };
  const {data, error} = await supabaseClient.from('entries').select('id').limit(1);
  if (error) return { status:'fail', detail:'Cannot read entries table: ' + error.message };
  const hasHold = entries.length === 0 || entries[0].hasOwnProperty('on_hold');
  if (!hasHold) return { status:'warn', detail:'Table found but "on_hold" column may be missing. Run: ALTER TABLE entries ADD COLUMN IF NOT EXISTS on_hold boolean DEFAULT false;' };
  return { status:'ok', detail:`Entries table accessible. ${entries.length} total records.` };
}

// ═══════════════════════════
//  ADD CUSTOM COLUMN
// ═══════════════════════════
window.addCustomColumn = function() {
  const label = document.getElementById('new-col-label')?.value.trim();
  const target = document.getElementById('new-col-table')?.value || 'po';
  if (!label) return toast('Enter a column label first', 'info');

  // Generate a safe key from the label
  const key = 'extra_' + label.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  const newCol = { key, label, visible: true, custom: true };

  if (target === 'po' || target === 'both') {
    if (!poCols.find(c => c.key === key)) poCols.push({...newCol});
  }
  if (target === 'adv' || target === 'both') {
    if (!advCols.find(c => c.key === key)) advCols.push({...newCol});
  }

  document.getElementById('new-col-label').value = '';
  renderColumnGrids();
  toast(`Column "${label}" added — click Apply & Save`, 'success');
};

// ═══════════════════════════
//  DISPATCH METHOD UI
// ═══════════════════════════
function updateDispatchMethodUI(method='emailjs') {
  const ejsSection = document.getElementById('emailjs-section');
  const paSection  = document.getElementById('pa-section');
  if (!ejsSection || !paSection) return;
  if (method === 'powerautomate') {
    ejsSection.style.display = 'none';
    paSection.style.display  = 'block';
  } else {
    ejsSection.style.display = 'block';
    paSection.style.display  = 'none';
  }
}
