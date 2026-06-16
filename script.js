// ═══════════════════════════
//  CONFIG & STATE
// ═══════════════════════════
let SUPABASE_URL      = localStorage.getItem('supabase_project_url') || '';
let SUPABASE_ANON_KEY = localStorage.getItem('supabase_anon_key')    || '';
let EMAILJS_SERVICE_ID  = localStorage.getItem('emailjs_service_id')  || '';
let EMAILJS_TEMPLATE_ID = localStorage.getItem('emailjs_template_id') || '';
let EMAILJS_PUBLIC_KEY  = localStorage.getItem('emailjs_public_key')  || '';

let supabaseClient = null;
let entries        = [];
let editingId      = null;
let dailySendTime  = '09:00';
let managerEmail   = '';
let ccEmails       = [];
let isSending      = false;
let activeFilter   = 'all';
let sortState      = { table:null, col:null, dir:'asc' };
let sfState        = { po:true, adv:true };

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
    setInterval(checkSchedule, 60000);
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
  if (sEmail) { managerEmail=sEmail.value; if(mgrEmailEl) mgrEmailEl.value=managerEmail; }
  const sCC=get('cc_emails');
  if (sCC) { ccEmails=sCC.value?sCC.value.split(',').map(e=>e.trim()).filter(Boolean):[]; renderCcTags(); }
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

  const sb=document.getElementById('daily-schedule-text');
  if(sb){sb.innerHTML=`<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${newTime}`;lucide.createIcons();}

  if (newKey!==SUPABASE_ANON_KEY||newUrl!==SUPABASE_URL||newSvc!==EMAILJS_SERVICE_ID||newTpl!==EMAILJS_TEMPLATE_ID||newPub!==EMAILJS_PUBLIC_KEY) {
    localStorage.setItem('supabase_anon_key',newKey);
    localStorage.setItem('supabase_project_url',newUrl);
    localStorage.setItem('emailjs_service_id',newSvc);
    localStorage.setItem('emailjs_template_id',newTpl);
    localStorage.setItem('emailjs_public_key',newPub);
    toast('Credentials saved. Refreshing…','success');
    setTimeout(()=>window.location.reload(),1000);
    return;
  }
  try {
    await Promise.all([
      supabaseClient.from('settings').upsert([{key:'send_time',value:newTime}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'manager_email',value:newEmail}],{onConflict:'key'}),
      supabaseClient.from('settings').upsert([{key:'cc_emails',value:newCC}],{onConflict:'key'}),
    ]);
    dailySendTime=newTime; managerEmail=newEmail;
    toast('Settings saved','success');
    settingsModal.classList.remove('open');
  } catch { toast('Sync failed','error'); }
}

async function loadEntries() {
  const {data,error} = await supabaseClient.from('entries').select('*').order('created_at',{ascending:false});
  if (error) return toast('Load failed: '+error.message,'error');
  entries = data.map(i=>({
    id:i.id, date:i.po_date, prSo:i.pr_so_number, po:i.po_number,
    woSo:i.wo_so_number, description:i.description, category:i.category,
    supplier:i.supplier, amount:i.amount, currency:i.currency,
    amountSar:i.amount_sar, advancePercent:i.advance_percent,
    advanceAmount:i.advance_amount, notes:i.notes,
    is_sent:i.is_sent,
    status: i.is_sent ? 'sent' : (i.on_hold ? 'hold' : 'pending'),
    on_hold: i.on_hold || false
  }));
  renderDashboard();
  updateSupplierList();
  buildReuseMenu();
}

async function autoPurge() {
  const d=new Date(); d.setDate(d.getDate()-30);
  try { await supabaseClient.from('entries').delete().lt('po_date',d.toISOString().split('T')[0]); } catch{}
}

function subscribeRealtime() {
  supabaseClient.channel('entries-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'entries'}, ()=>loadEntries())
    .subscribe();
}

// ═══════════════════════════
//  CREATE / EDIT
// ═══════════════════════════
async function handleSubmit(e, onHold=false) {
  e.preventDefault();
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
    on_hold:      onHold
  };

  try {
    if (editingId) {
      const {error} = await supabaseClient.from('entries').update(data).eq('id',editingId);
      if (error) throw error;
      cancelEdit();
      toast(onHold?'Saved on hold':'Entry updated','success');
    } else {
      if (typeEl.value==='PO Approval' && hasAdvEl.checked) {
        const {error} = await supabaseClient.from('entries').insert([
          {...data, advance_amount:0, advance_percent:0, on_hold:onHold},
          {...data, on_hold:onHold}
        ]);
        if (error) throw error;
      } else {
        const {error} = await supabaseClient.from('entries').insert([data]);
        if (error) throw error;
      }
      toast(onHold?'Saved for later — won\'t dispatch until released':'Entry recorded','success');
    }
    form.reset();
    hasAdvEl.checked=false;
    document.getElementById('form-title').textContent='New Record';
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
  ['pr-so-number','po-number','wo-so-number','description','category','supplier','notes'].forEach(fid=>{
    const map={'pr-so-number':'prSo','po-number':'po','wo-so-number':'woSo','description':'description','category':'category','supplier':'supplier','notes':'notes'};
    const el=document.getElementById(fid); if(el) el.value=e[map[fid]]||'';
  });
  document.getElementById('amount').value=e.amount;
  curEl.value=e.currency;
  calculate();
  document.querySelector('.form-inner')?.scrollTo({top:0,behavior:'smooth'});
  setTimeout(()=>document.getElementById('po-number')?.focus(),200);
}

function cancelEdit() {
  editingId=null;
  document.getElementById('form-title').textContent='New Record';
  cancelBtn.style.display='none';
  editBanner.classList.remove('show');
  holdBanner.classList.remove('show');
  form.reset(); calculate();
}

async function deleteEntry(id) {
  if (!confirm('Delete this record?')) return;
  await supabaseClient.from('entries').delete().eq('id',id);
  await loadEntries();
}

// Toggle hold status on existing entry
async function toggleHold(id) {
  const e=entries.find(i=>i.id===id); if(!e) return;
  const newHold=!e.on_hold;
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
  const recent=entries.slice(0,20);
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
  const hits=entries.filter(e=>[e.supplier,e.po,e.description,e.category].some(v=>v&&v.toLowerCase().includes(lo))).slice(0,8);
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

  const badge = e => {
    if (e.status==='hold')    return `<span class="sp hold">⏸ On Hold</span>`;
    if (e.status==='sent')    return `<span class="sp sent">Sent</span>`;
    return `<span class="sp pending">Pending</span>`;
  };
  const catBadge = c => c ? `<span class="cp">${c}</span>` : '-';

  const emptyPo  = `<tr class="erow"><td colspan="13"><div class="empty"><i data-lucide="file-text" class="e-ico"></i><p>${q?'No results':'No PO entries yet'}</p><span>${q?'Try a different search':'Fill the form and click Log Entry'}</span></div></td></tr>`;
  const emptyAdv = `<tr class="erow"><td colspan="14"><div class="empty"><i data-lucide="landmark" class="e-ico"></i><p>${q?'No results':'No advance entries yet'}</p><span>${q?'Try a different search':'Check "Advance?" when logging'}</span></div></td></tr>`;

  if (poTbody) {
    poTbody.innerHTML = pos.length===0 ? emptyPo : pos.map(e=>{
      const {suppNo,vendorName}=extractSupplier(e.supplier);
      const rowCls=e.status==='hold'?' class="held-row"':'';
      return `<tr${rowCls} style="${e.status==='sent'?'opacity:.5':''}">
        <td><input type="checkbox" class="row-cb" value="${e.id}" onchange="updateSelBtns()"></td>
        <td>${suppNo||'-'}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${vendorName}">${vendorName}</td>
        <td>${e.po||'-'}</td>
        <td>${(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${e.currency||''}</td>
        <td style="font-weight:600">${(e.amountSar||0).toLocaleString()}</td>
        <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1)" title="${e.notes||''}">${e.notes||'-'}</td>
        <td style="color:var(--t1)">${e.date||''}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1)" title="${e.description||''}">${e.description||'-'}</td>
        <td>${catBadge(e.category)}</td>
        <td>${badge(e)}</td>
        <td><div class="row-acts">
          ${e.status!=='sent'?`<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>`:''}
          <button class="ra reuse"   onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra ${e.on_hold?'unhold':'hold'}" onclick="toggleHold('${e.id}')" title="${e.on_hold?'Release — include in dispatch':'Hold — exclude from dispatch'}">
            <i data-lucide="${e.on_hold?'play-circle':'pause-circle'}"></i>
          </button>
          <button class="ra del" onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  }

  if (advTbody) {
    advTbody.innerHTML = advs.length===0 ? emptyAdv : advs.map(e=>{
      const {suppNo,vendorName}=extractSupplier(e.supplier);
      const advCur=((e.amount||0)*(e.advancePercent||0))/100;
      const rowCls=e.status==='hold'?' class="held-row"':'';
      return `<tr${rowCls} style="${e.status==='sent'?'opacity:.5':''}">
        <td><input type="checkbox" class="row-cb" value="${e.id}" onchange="updateSelBtns()"></td>
        <td>${suppNo||'-'}</td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${vendorName}">${vendorName}</td>
        <td>${e.po||'-'}</td>
        <td>${(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${e.currency||''}</td>
        <td>${advCur.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="font-weight:600">${(e.advanceAmount||0).toLocaleString()}</td>
        <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1)" title="${e.notes||''}">${e.notes||'-'}</td>
        <td style="color:var(--t1)">${e.date||''}</td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t1)" title="${e.description||''}">${e.description||'-'}</td>
        <td>${catBadge(e.category)}</td>
        <td>${badge(e)}</td>
        <td><div class="row-acts">
          ${e.status!=='sent'?`<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>`:''}
          <button class="ra reuse"   onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra ${e.on_hold?'unhold':'hold'}" onclick="toggleHold('${e.id}')" title="${e.on_hold?'Release — include in dispatch':'Hold — exclude from dispatch'}">
            <i data-lucide="${e.on_hold?'play-circle':'pause-circle'}"></i>
          </button>
          <button class="ra del" onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  }
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
  const all=document.querySelectorAll('.row-cb:checked');
  const allAdv=document.querySelectorAll('#advance-tbody .row-cb:checked');
  const show=(id,n,cid)=>{
    const el=document.getElementById(id); const ce=document.getElementById(cid); if(!el) return;
    if(n>0){el.classList.add('show');if(ce)ce.textContent=n;}else el.classList.remove('show');
  };
  show('btn-delete-selected',  all.length,    'selected-count');
  show('btn-requeue-selected', all.length,    'requeue-count');
  show('btn-copy-advances',    allAdv.length, 'copy-count');
};

window.requeueSelected = async function() {
  const ids=Array.from(document.querySelectorAll('.row-cb:checked')).map(cb=>cb.value);
  if(!ids.length) return;
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
}

// ═══════════════════════════
//  EMAIL — FIXED DOUBLE SEND
// ═══════════════════════════
// Uses a per-minute lock stored in supabase settings to prevent
// multiple tabs or rapid interval ticks from sending twice.
async function openDispatchPreview() {
  const pending=entries.filter(e=>e.status==='pending');
  if (!pending.length) return toast('No pending items to dispatch','info');

  const pos=pending.filter(e=>!e.advanceAmount||e.advanceAmount===0);
  const advs=pending.filter(e=>e.advanceAmount>0);
  const totalPo=pos.reduce((s,e)=>s+(e.amountSar||0),0);
  const totalAdv=advs.reduce((s,e)=>s+(e.advanceAmount||0),0);

  const th=s=>`<th>${s}</th>`;
  const ts='border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;margin-bottom:14px';
  const ths='background:#f8fafc;color:#0f172a;';
  let html='';
  if (pos.length) {
    html+=`<div class="preview-count"><i data-lucide="file-text"></i> ${pos.length} PO Approval${pos.length!==1?'s':''} · Total SAR: <b>${totalPo.toLocaleString()}</b></div>`;
    html+=`<table border="1" cellpadding="6" style="${ts}"><tr style="${ths}">${['Supp.','Vendor','PO #','Description','Amount','Cur','SAR ⃁','Notes'].map(th).join('')}</tr>`;
    pos.forEach(e=>{const{suppNo,vendorName}=extractSupplier(e.supplier);html+=`<tr><td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td><td>${e.description||'-'}</td><td>${(e.amount||0).toLocaleString()}</td><td>${e.currency||''}</td><td><b>${(e.amountSar||0).toLocaleString()}</b></td><td>${e.notes||'-'}</td></tr>`;});
    html+='</table>';
  }
  if (advs.length) {
    html+=`<div class="preview-count" style="margin-top:10px"><i data-lucide="landmark"></i> ${advs.length} Advance${advs.length!==1?'s':''} · Total SAR: <b>${totalAdv.toLocaleString()}</b></div>`;
    html+=`<table border="1" cellpadding="6" style="${ts}"><tr style="${ths}">${['Supp.','Vendor','PO #','Description','PO Amt','Cur','Adv (Cur)','Adv SAR'].map(th).join('')}</tr>`;
    advs.forEach(e=>{const{suppNo,vendorName}=extractSupplier(e.supplier);const ac=((e.amount||0)*(e.advancePercent||0))/100;html+=`<tr><td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td><td>${e.description||'-'}</td><td>${(e.amount||0).toLocaleString()}</td><td>${e.currency||''}</td><td><b>${ac.toLocaleString()}</b></td><td><b>${(e.advanceAmount||0).toLocaleString()}</b></td></tr>`;});
    html+='</table>';
  }

  document.getElementById('preview-content').innerHTML=html;
  lucide.createIcons();
  document.getElementById('preview-modal').classList.add('open');
  settingsModal.classList.remove('open');
}

async function confirmDispatch() {
  document.getElementById('preview-modal').classList.remove('open');
  await sendEmail(false);
}

async function sendEmail(isScheduled=false) {
  if (isSending) return;

  const pending=entries.filter(e=>e.status==='pending');
  if (!pending.length) { if(!isScheduled) toast('Nothing pending to send','info'); return; }

  // ── DOUBLE-SEND FIX ──
  // Atomic lock in Supabase: try to write a lock row with current minute.
  // If it already exists (another tab or tick), bail out immediately.
  if (supabaseClient) {
    const minuteKey = new Date().toISOString().slice(0,16); // "2026-06-01T09:00"
    try {
      // insert will fail on unique constraint if another tab already inserted this minute
      const {error} = await supabaseClient.from('settings')
        .insert([{key:`dispatch_lock_${minuteKey}`, value:'1'}]);
      if (error) {
        // Already sent this minute — abort silently for scheduled, warn for manual
        if (!isScheduled) toast('Already dispatched this minute — please wait','info');
        return;
      }
      // Clean up old lock keys (keep only last 5 minutes)
      const oldKey = new Date(Date.now()-5*60000).toISOString().slice(0,16);
      await supabaseClient.from('settings').delete().lt('key',`dispatch_lock_${oldKey}`).like('key','dispatch_lock_%');
    } catch {}
  }

  isSending=true;
  try {
    if (!managerEmail) throw new Error('Manager email not set');
    if (!EMAILJS_SERVICE_ID||!EMAILJS_TEMPLATE_ID||!EMAILJS_PUBLIC_KEY) throw new Error('EmailJS keys missing in Settings');

    const ids=pending.map(i=>i.id);
    // Mark sent BEFORE sending email — prevents retry getting different data
    const {error:ue}=await supabaseClient.from('entries').update({is_sent:true}).in('id',ids).eq('is_sent',false);
    if(ue) throw ue;

    const pos=pending.filter(e=>!e.advanceAmount||e.advanceAmount===0);
    const advs=pending.filter(e=>e.advanceAmount>0);
    const today=new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    const th=s=>`<th>${s}</th>`;
    const ts='border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;';
    const ths='background:#f8fafc;color:#0f172a;';
    let poH='', advH='';
    if (pos.length) {
      poH=`<h3 style="font-family:sans-serif">📅 PO Approvals (${pos.length}):</h3><table border="1" cellpadding="8" style="${ts}"><tr style="${ths}">${['Supp.','Vendor','PO #','Description','Amount','Cur','SAR ⃁','Notes'].map(th).join('')}</tr>`;
      pos.forEach(e=>{const{suppNo,vendorName}=extractSupplier(e.supplier);poH+=`<tr><td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td><td>${e.description||'-'}</td><td>${(e.amount||0).toLocaleString()}</td><td>${e.currency||''}</td><td><b>${(e.amountSar||0).toLocaleString()}</b></td><td>${e.notes||'-'}</td></tr>`;});
      poH+='</table>';
    }
    if (advs.length) {
      advH=`<h3 style="font-family:sans-serif">💰 Advances (${advs.length}):</h3><table border="1" cellpadding="8" style="${ts}"><tr style="${ths}">${['Supp.','Vendor','PO #','Description','PO Amt','Cur','Adv (Cur)','Adv SAR'].map(th).join('')}</tr>`;
      advs.forEach(e=>{const{suppNo,vendorName}=extractSupplier(e.supplier);const ac=((e.amount||0)*(e.advancePercent||0))/100;advH+=`<tr><td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td><td>${e.description||'-'}</td><td>${(e.amount||0).toLocaleString()}</td><td>${e.currency||''}</td><td><b>${ac.toLocaleString()}</b></td><td><b>${(e.advanceAmount||0).toLocaleString()}</b></td></tr>`;});
      advH+='</table>';
    }
    const totalPo=pos.reduce((s,e)=>s+(e.amountSar||0),0);
    const totalAdv=advs.reduce((s,e)=>s+(e.advanceAmount||0),0);

    await emailjs.send(EMAILJS_SERVICE_ID,EMAILJS_TEMPLATE_ID,{
      subject_line:`GM Procurement Approval Request - ${today}`,
      to_email:managerEmail, cc_email:ccEmails.join(', '),
      po_table:poH, adv_table:advH,
      summary_count:pending.length, po_count:pos.length, adv_count:advs.length,
      total_po_sar:totalPo.toLocaleString(), total_adv_sar:totalAdv.toLocaleString(),
      total_sar:(totalPo+totalAdv).toLocaleString()
    }, EMAILJS_PUBLIC_KEY);

    toast('Dispatched successfully!','success');
    document.getElementById('success-modal').classList.add('open');
  } catch(err) {
    // Rollback is_sent
    const pending2=entries.filter(e=>e.status==='pending');
    if(pending2.length) await supabaseClient.from('entries').update({is_sent:false}).in('id',pending2.map(i=>i.id));
    toast('Dispatch failed: '+(err.text||err.message||err),'error');
  } finally { isSending=false; }
}

// Schedule check — fires every 60s (one tick per minute max)
// Extra guard: track last-sent date in memory
let lastScheduledDate = '';
async function checkSchedule() {
  const now=new Date();
  const t=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const today=now.toISOString().split('T')[0];
  if (t===dailySendTime && today!==lastScheduledDate && !isSending && entries.some(e=>e.status==='pending')) {
    lastScheduledDate=today;
    await sendEmail(true);
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
  xml+=`<Worksheet ss:Name="PO Approvals"><Table>${row(['Date','Description','Category','PR/SO #','WO/SO #','PO #','Supplier','Amount','Currency','SAR','Notes','Status'])}`;
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
  const unique=[...new Set(entries.map(e=>e.supplier).filter(Boolean))].filter(s=>!forgotten.includes(s)).sort();
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
  list.innerHTML=ccEmails.map((e,i)=>`<div class="tag"><span>${e}</span><i data-lucide="x" onclick="removeCcTag(${i})"></i></div>`).join('');
  lucide.createIcons();
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
function initTheme(){
  const t=localStorage.getItem('theme_preference')||'dark';
  document.documentElement.setAttribute('data-theme',t);
  const ico=document.getElementById('theme-icon');
  if(ico){ico.setAttribute('data-lucide',t==='dark'?'sun':'moon');lucide.createIcons();}
}
function toggleTheme(){
  const cur=document.documentElement.getAttribute('data-theme')||'dark';
  const nxt=cur==='dark'?'light':'dark';
  document.documentElement.setAttribute('data-theme',nxt);
  localStorage.setItem('theme_preference',nxt);
  const ico=document.getElementById('theme-icon');
  if(ico){ico.setAttribute('data-lucide',nxt==='dark'?'sun':'moon');lucide.createIcons();}
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
  d['advance-percent']=advPctEl?.value;
  d['custom-percent']=custPctEl?.value;
  sessionStorage.setItem('approval_form_draft',JSON.stringify(d));
}
function restoreDraft(){
  try{
    const d=JSON.parse(sessionStorage.getItem('approval_form_draft')||'{}');
    if(!Object.keys(d).length) return;
    DRAFT_FIELDS.forEach(id=>{const el=document.getElementById(id);if(el&&d[id]!==undefined)el.value=d[id];});
    if(hasAdvEl&&d['has-advance']) hasAdvEl.checked=d['has-advance'];
    if(advPctEl&&d['advance-percent']) advPctEl.value=d['advance-percent'];
    if(custPctEl&&d['custom-percent']) custPctEl.value=d['custom-percent'];
    if(advPctEl?.value==='custom') custPctGrp.style.display='block';
  }catch{}
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
document.getElementById('btn-save-hold')?.addEventListener('click', e=>{ e.preventDefault(); if(form.reportValidity()) handleSubmit(e,true); });
form.addEventListener('input',  saveDraft);
form.addEventListener('change', saveDraft);
form.addEventListener('submit', ()=>setTimeout(()=>sessionStorage.removeItem('approval_form_draft'),1500));

amtEl.addEventListener('input',calculate);
curEl.addEventListener('change',calculate);
typeEl.addEventListener('change',calculate);
hasAdvEl.addEventListener('change',calculate);
advPctEl.addEventListener('change',()=>{
  custPctGrp.style.display=advPctEl.value==='custom'?'block':'none';
  calculate();
});
custPctEl.addEventListener('input',calculate);

document.getElementById('btn-settings')?.addEventListener('click',()=>settingsModal.classList.add('open'));
document.getElementById('btn-close-settings')?.addEventListener('click',()=>settingsModal.classList.remove('open'));
document.getElementById('btn-save-settings')?.addEventListener('click',saveSettings);
document.getElementById('btn-finalize')?.addEventListener('click',openDispatchPreview);
document.getElementById('btn-confirm-dispatch')?.addEventListener('click',confirmDispatch);
document.getElementById('btn-close-preview')?.addEventListener('click',()=>document.getElementById('preview-modal').classList.remove('open'));
cancelBtn?.addEventListener('click',cancelEdit);
mgrEmailEl?.addEventListener('change',saveSettings);
document.getElementById('btn-theme-toggle')?.addEventListener('click',toggleTheme);
document.getElementById('btn-activate-setup')?.addEventListener('click',activateDashboard);
document.getElementById('btn-export')?.addEventListener('click',exportToExcel);
document.getElementById('btn-remove-supplier')?.addEventListener('click',removeSupplierFromMemory);
document.getElementById('btn-close-weekly')?.addEventListener('click',()=>document.getElementById('weekly-modal').classList.remove('open'));

document.getElementById('new-cc-input')?.addEventListener('keydown',e=>{
  if(e.key==='Enter'||e.key===','){e.preventDefault();addCcFromInput();}
});

// Close modals on backdrop click
document.querySelectorAll('.mo').forEach(m=>{
  m.addEventListener('click',e=>{ if(e.target===m) m.classList.remove('open'); });
});

// ═══════════════════════════
//  BOOT
// ═══════════════════════════
setupLayout();
init();
