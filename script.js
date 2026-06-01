// ═══════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════
let SUPABASE_URL      = localStorage.getItem('supabase_project_url') || '';
let SUPABASE_ANON_KEY = localStorage.getItem('supabase_anon_key')    || '';
let EMAILJS_SERVICE_ID  = localStorage.getItem('emailjs_service_id')  || '';
let EMAILJS_TEMPLATE_ID = localStorage.getItem('emailjs_template_id') || '';
let EMAILJS_PUBLIC_KEY  = localStorage.getItem('emailjs_public_key')  || '';

let supabaseClient   = null;
let entries          = [];
let editMode         = false;
let currentEditingId = null;
let dailySendTime    = '09:00';
let managerEmail     = '';
let ccEmailsArray    = [];
let isSendingNow     = false;
let activeFilter     = 'all';
let sortState        = { table: null, col: null, dir: 'asc' };
let searchFilters    = { po: true, adv: true };

// ═══════════════════════════════════════
//  SELECTORS
// ═══════════════════════════════════════
const approvalForm       = document.getElementById('approval-form');
const poTbody            = document.getElementById('po-tbody');
const advanceTbody       = document.getElementById('advance-tbody');
const amountInput        = document.getElementById('amount');
const currencySelect     = document.getElementById('currency');
const amountSarInput     = document.getElementById('amount-sar');
const advanceFields      = document.getElementById('advance-fields');
const approvalTypeSelect = document.getElementById('approval-type');
const hasAdvanceCheckbox = document.getElementById('has-advance');
const advancePercentSelect  = document.getElementById('advance-percent');
const customPercentInput    = document.getElementById('custom-percent');
const customPercentGroup    = document.getElementById('custom-percent-group');
const advanceAmountInput    = document.getElementById('advance-amount');
const inputManagerEmail     = document.getElementById('input-manager-email');
const inputSendTime         = document.getElementById('input-send-time');
const inputDbKey            = document.getElementById('input-db-key');
const btnSettings    = document.getElementById('btn-settings');
const settingsModal  = document.getElementById('settings-modal');
const setupModal     = document.getElementById('setup-modal');
const btnSaveSettings    = document.getElementById('btn-save-settings');
const btnActivateSetup   = document.getElementById('btn-activate-setup');
const btnFinalize        = document.getElementById('btn-finalize');
const btnCancelEdit      = document.getElementById('btn-cancel-edit');

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
const getVal = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const getNum = id => parseFloat(getVal(id)) || 0;

function extractSupplier(s) {
  let v = (s || '').trim();
  if (!v || v === '-') return { suppNo: '', vendorName: '-' };
  let m = v.match(/^(\d{3,15})(?:\s*[-_@:|]+\s*|\s+)(.*)$/);
  if (m) return { suppNo: m[1], vendorName: m[2].trim() };
  m = v.match(/^(.*?)(?:\s*[-_@:|]+\s*|\s+)(\d{3,15})$/);
  if (m) return { suppNo: m[2], vendorName: m[1].trim() };
  return { suppNo: '', vendorName: v };
}

function showToast(msg, type = 'info') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'toastOut .22s ease forwards';
    setTimeout(() => t.remove(), 220);
  }, 3500);
}

function animateStat(id, newVal) {
  const el = document.getElementById(id);
  if (!el) return;
  const old = el.textContent;
  if (old !== String(newVal)) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.textContent = newVal;
    el.classList.add('bump');
  }
}

// ═══════════════════════════════════════
//  INIT
// ═══════════════════════════════════════
async function init() {
  lucide.createIcons();
  const d = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const el1 = document.getElementById('po-date'); if (el1) el1.textContent = d;
  const el2 = document.getElementById('po-date-form'); if (el2) el2.textContent = d;
  initTheme();
  restoreDraft();
  calculate();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setupModal.classList.add('active');
    return;
  }
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) emailjs.init(EMAILJS_PUBLIC_KEY);
    await loadSettings();
    await autoPurgeOldRecords();
    await loadEntries();
    subscribeToChanges();
    calculate();
    setInterval(checkSchedule, 30000);
  } catch (err) {
    showToast('Database connection failed. Check Settings.', 'error');
  }
}

async function activateDashboard() {
  const url = document.getElementById('setup-db-url')?.value.trim();
  const key = document.getElementById('setup-db-key')?.value.trim();
  if (!url || !key) return showToast('Enter both Project URL and Key', 'error');
  const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  localStorage.setItem('supabase_project_url', cleanUrl);
  localStorage.setItem('supabase_anon_key', key);
  setupModal.classList.remove('active');
  window.location.reload();
}

// ═══════════════════════════════════════
//  DATABASE
// ═══════════════════════════════════════
async function loadSettings() {
  const { data } = await supabaseClient.from('settings').select('*');
  if (!data) return;
  const sTime  = data.find(i => i.key === 'send_time');
  const sEmail = data.find(i => i.key === 'manager_email');
  const sCC    = data.find(i => i.key === 'cc_emails');

  if (inputDbKey) inputDbKey.value = SUPABASE_ANON_KEY;
  const urlEl = document.getElementById('input-db-url'); if (urlEl) urlEl.value = SUPABASE_URL;
  const svcEl = document.getElementById('input-emailjs-svc'); if (svcEl) svcEl.value = EMAILJS_SERVICE_ID;
  const tplEl = document.getElementById('input-emailjs-tpl'); if (tplEl) tplEl.value = EMAILJS_TEMPLATE_ID;
  const pubEl = document.getElementById('input-emailjs-pub'); if (pubEl) pubEl.value = EMAILJS_PUBLIC_KEY;

  if (sTime) {
    dailySendTime = sTime.value;
    if (inputSendTime) inputSendTime.value = dailySendTime;
    const sb = document.getElementById('daily-schedule-text');
    if (sb) sb.innerHTML = `<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${dailySendTime}`;
    lucide.createIcons();
  }
  if (sEmail) { managerEmail = sEmail.value; if (inputManagerEmail) inputManagerEmail.value = managerEmail; }
  if (sCC) {
    ccEmailsArray = sCC.value ? sCC.value.split(',').map(e => e.trim()).filter(Boolean) : [];
    renderCcTags();
  }
}

async function updateSettings() {
  const newKey = inputDbKey?.value.trim() || '';
  const newUrl = document.getElementById('input-db-url')?.value.trim() || SUPABASE_URL;
  const newSvc = document.getElementById('input-emailjs-svc')?.value.trim() || '';
  const newTpl = document.getElementById('input-emailjs-tpl')?.value.trim() || '';
  const newPub = document.getElementById('input-emailjs-pub')?.value.trim() || '';
  const newTime  = inputSendTime?.value || '';
  const newEmail = inputManagerEmail?.value.trim() || '';
  const newCC    = ccEmailsArray.join(',');

  const sb = document.getElementById('daily-schedule-text');
  if (sb) { sb.innerHTML = `<i data-lucide="clock"></i>&nbsp;Auto-Dispatch: ${newTime}`; lucide.createIcons(); }

  if (newKey !== SUPABASE_ANON_KEY || newUrl !== SUPABASE_URL || newSvc !== EMAILJS_SERVICE_ID || newTpl !== EMAILJS_TEMPLATE_ID || newPub !== EMAILJS_PUBLIC_KEY) {
    localStorage.setItem('supabase_anon_key', newKey);
    localStorage.setItem('supabase_project_url', newUrl);
    localStorage.setItem('emailjs_service_id', newSvc);
    localStorage.setItem('emailjs_template_id', newTpl);
    localStorage.setItem('emailjs_public_key', newPub);
    showToast('Credentials updated. Refreshing…', 'success');
    setTimeout(() => window.location.reload(), 1000);
    return;
  }
  try {
    await supabaseClient.from('settings').upsert([{ key:'send_time',     value:newTime  }], { onConflict:'key' });
    await supabaseClient.from('settings').upsert([{ key:'manager_email', value:newEmail }], { onConflict:'key' });
    await supabaseClient.from('settings').upsert([{ key:'cc_emails',     value:newCC    }], { onConflict:'key' });
    dailySendTime = newTime; managerEmail = newEmail;
    showToast('Settings saved!', 'success');
    settingsModal.classList.remove('active');
  } catch { showToast('Sync failed', 'error'); }
}

async function loadEntries() {
  const { data, error } = await supabaseClient.from('entries').select('*').order('created_at', { ascending:false });
  if (error) return showToast('Load failed: ' + error.message, 'error');
  entries = data.map(i => ({
    id: i.id, date: i.po_date, prSo: i.pr_so_number, po: i.po_number,
    woSo: i.wo_so_number, description: i.description, category: i.category,
    supplier: i.supplier, amount: i.amount, currency: i.currency,
    amountSar: i.amount_sar, advancePercent: i.advance_percent,
    advanceAmount: i.advance_amount, notes: i.notes, is_sent: i.is_sent
  }));
  renderDashboard();
  updateSupplierList();
  buildReuseMenu();
}

async function createEntry(e) {
  e.preventDefault();
  const entryData = {
    po_date:         new Date().toISOString().split('T')[0],
    description:     getVal('description'),
    category:        getVal('category'),
    pr_so_number:    getVal('pr-so-number'),
    wo_so_number:    getVal('wo-so-number'),
    po_number:       getVal('po-number'),
    supplier:        getVal('supplier'),
    amount:          parseFloat(amountInput.value),
    currency:        currencySelect.value,
    amount_sar:      parseFloat(amountSarInput.value),
    advance_percent: parseFloat(advancePercentSelect.value === 'custom' ? customPercentInput.value : advancePercentSelect.value) || 0,
    advance_amount:  parseFloat(advanceAmountInput.value) || 0,
    notes:           getVal('notes'),
    is_sent:         false
  };
  try {
    if (currentEditingId) {
      const { error } = await supabaseClient.from('entries').update(entryData).eq('id', currentEditingId);
      if (error) throw error;
      currentEditingId = null;
      btnCancelEdit.style.display = 'none';
      document.getElementById('edit-indicator')?.classList.remove('show');
      showToast('Entry updated', 'success');
    } else {
      if (approvalTypeSelect.value === 'PO Approval' && hasAdvanceCheckbox.checked) {
        const { error } = await supabaseClient.from('entries').insert([
          { ...entryData, advance_amount:0, advance_percent:0 },
          { ...entryData }
        ]);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from('entries').insert([entryData]);
        if (error) throw error;
      }
      showToast('Entry recorded', 'success');
    }
    approvalForm.reset();
    if (hasAdvanceCheckbox) hasAdvanceCheckbox.checked = false;
    document.getElementById('form-title').textContent = 'New Record';
    editMode = false;
    sessionStorage.removeItem('approval_form_draft');
    calculate();
  } catch (err) { showToast('Save failed: ' + err.message, 'error'); }
}

async function deleteEntry(id) {
  if (!confirm('Delete this record?')) return;
  await supabaseClient.from('entries').delete().eq('id', id);
  await loadEntries();
}

async function autoPurgeOldRecords() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  try { await supabaseClient.from('entries').delete().lt('po_date', d.toISOString().split('T')[0]); }
  catch {}
}

function subscribeToChanges() {
  supabaseClient.channel('all').on('postgres_changes', { event:'*', schema:'public', table:'entries' }, loadEntries).subscribe();
}

// ═══════════════════════════════════════
//  EDITING
// ═══════════════════════════════════════
function startEdit(id) {
  const e = entries.find(i => i.id === id);
  if (!e) return;
  editMode = true; currentEditingId = id;
  document.getElementById('form-title').textContent = 'Editing Record';
  btnCancelEdit.style.display = 'inline-flex';
  document.getElementById('edit-indicator')?.classList.add('show');

  document.getElementById('approval-type').value = (e.advanceAmount > 0) ? 'Advance Approval' : 'PO Approval';
  if (hasAdvanceCheckbox) hasAdvanceCheckbox.checked = false;
  ['pr-so-number','po-number','wo-so-number','description','category','supplier','notes'].forEach(fid => {
    const el = document.getElementById(fid);
    const key = { 'pr-so-number':'prSo','po-number':'po','wo-so-number':'woSo','description':'description','category':'category','supplier':'supplier','notes':'notes' }[fid];
    if (el) el.value = e[key] || '';
  });
  document.getElementById('amount').value = e.amount;
  document.getElementById('currency').value = e.currency;
  if (e.advanceAmount > 0) {
    if (advancePercentSelect.value !== 'custom') { advancePercentSelect.value = e.advancePercent; }
    else { customPercentGroup.style.display = 'block'; customPercentInput.value = e.advancePercent; }
  }

  // Scroll form panel to top + focus PO field
  document.querySelector('.form-inner')?.scrollTo({ top:0, behavior:'smooth' });
  setTimeout(() => document.getElementById('po-number')?.focus(), 200);
  calculate();
}

function cancelEdit() {
  editMode = false; currentEditingId = null;
  document.getElementById('form-title').textContent = 'New Record';
  btnCancelEdit.style.display = 'none';
  document.getElementById('edit-indicator')?.classList.remove('show');
  approvalForm.reset(); calculate();
}

// Row reuse — fill form from any existing entry
function reuseEntry(id) {
  const e = entries.find(i => i.id === id);
  if (!e) return;
  document.getElementById('approval-type').value = (e.advanceAmount > 0) ? 'Advance Approval' : 'PO Approval';
  if (hasAdvanceCheckbox) hasAdvanceCheckbox.checked = (e.advanceAmount > 0);
  ['description','category','supplier','notes'].forEach(fid => {
    const key = { description:'description', category:'category', supplier:'supplier', notes:'notes' }[fid];
    const el = document.getElementById(fid); if (el) el.value = e[key] || '';
  });
  // Clear PO/PR fields — those should be fresh
  ['po-number','pr-so-number','wo-so-number'].forEach(fid => { const el = document.getElementById(fid); if (el) el.value = ''; });
  document.getElementById('amount').value = e.amount;
  document.getElementById('currency').value = e.currency;
  calculate();
  document.querySelector('.form-inner')?.scrollTo({ top:0, behavior:'smooth' });
  document.getElementById('po-number')?.focus();
  showToast('Row prefilled — update PO number & submit', 'info');
}

// ═══════════════════════════════════════
//  REUSE DROPDOWN (smart autocomplete)
// ═══════════════════════════════════════
function buildReuseMenu() {
  const menu = document.getElementById('reuse-menu');
  if (!menu) return;
  const recent = entries.slice(0, 20);
  if (recent.length === 0) { menu.innerHTML = '<div class="reuse-empty">No history yet</div>'; return; }
  menu.innerHTML = recent.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    return `<div class="reuse-item" onclick="reuseEntry('${e.id}'); document.getElementById('reuse-menu').classList.remove('open')">
      <div style="min-width:0">
        <div class="ri-main">${vendorName}${suppNo ? ' <span style="color:var(--t3);font-weight:400">· '+suppNo+'</span>' : ''}</div>
        <div class="ri-sub">${e.po || 'No PO'} · ${e.category || ''} · ${(e.amount||0).toLocaleString()} ${e.currency}</div>
      </div>
      <span class="ri-badge ${e.is_sent ? 'sp sent' : 'sp pending'}">${e.is_sent ? '✓' : '·'}</span>
    </div>`;
  }).join('');
}

window.filterReuseMenu = function(q) {
  const menu = document.getElementById('reuse-menu');
  if (!menu) return;
  if (!q || q.length < 1) { menu.classList.remove('open'); return; }
  const lower = q.toLowerCase();
  const matches = entries.filter(e =>
    [e.supplier, e.po, e.description, e.category].some(v => v && v.toLowerCase().includes(lower))
  ).slice(0, 8);
  if (matches.length === 0) { menu.classList.remove('open'); return; }
  menu.innerHTML = matches.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    return `<div class="reuse-item" onclick="reuseEntry('${e.id}'); document.getElementById('reuse-menu').classList.remove('open'); document.getElementById('supplier').value = '${e.supplier.replace(/'/g,"\\'")}'"  >
      <div style="min-width:0">
        <div class="ri-main">${vendorName}${suppNo ? ' <span style="color:var(--t3);font-weight:400">· '+suppNo+'</span>' : ''}</div>
        <div class="ri-sub">${e.po || 'No PO'} · ${e.category || ''} · ${(e.amount||0).toLocaleString()} ${e.currency}</div>
      </div>
    </div>`;
  }).join('');
  menu.classList.add('open');
};

// Close reuse menu on outside click
document.addEventListener('click', e => {
  const menu = document.getElementById('reuse-menu');
  if (menu && !menu.closest('.reuse-wrap')?.contains(e.target)) menu.classList.remove('open');
});

// ═══════════════════════════════════════
//  FILTER & SORT
// ═══════════════════════════════════════
window.setFilter = function(f) {
  activeFilter = f;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('fc-' + f)?.classList.add('active');
  renderDashboard();
};

window.toggleSearchFilter = function(which) {
  searchFilters[which] = !searchFilters[which];
  document.getElementById('sf-' + which)?.classList.toggle('on', searchFilters[which]);
  renderDashboard();
};

window.sortTable = function(table, col) {
  if (sortState.table === table && sortState.col === col) {
    sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
  } else {
    sortState = { table, col, dir: 'asc' };
  }
  // Update header classes
  const tId = table === 'po' ? 'po-table' : 'adv-table';
  document.querySelectorAll(`#${tId} thead th`).forEach(th => {
    th.classList.remove('sort-asc','sort-desc');
    if (th.getAttribute('onclick') === `sortTable('${table}','${col}')`) {
      th.classList.add(sortState.dir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
  renderDashboard();
};

function applySort(arr, table) {
  if (sortState.table !== table || !sortState.col) return arr;
  const col = sortState.col, dir = sortState.dir === 'asc' ? 1 : -1;
  return [...arr].sort((a, b) => {
    let va = a[col] ?? '', vb = b[col] ?? '';
    if (typeof va === 'number') return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function applyFilter(arr) {
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay()); weekStart.setHours(0,0,0,0);
  switch (activeFilter) {
    case 'pending': return arr.filter(e => !e.is_sent);
    case 'sent':    return arr.filter(e => e.is_sent);
    case 'today':   return arr.filter(e => e.date === today);
    case 'week':    return arr.filter(e => e.date && new Date(e.date) >= weekStart);
    default: return arr;
  }
}

// ═══════════════════════════════════════
//  RENDER
// ═══════════════════════════════════════
function renderDashboard() {
  const hideSent = document.getElementById('toggle-hide-sent')?.checked ?? true;
  const q = document.getElementById('pipeline-search')?.value.trim().toLowerCase() ?? '';

  let pos  = entries.filter(e => !e.advanceAmount || e.advanceAmount === 0);
  let advs = entries.filter(e => e.advanceAmount > 0);

  // Apply filter chips
  pos  = applyFilter(pos);
  advs = applyFilter(advs);

  // Hide sent (overrides filter if checked)
  if (hideSent && activeFilter === 'all') {
    pos  = pos.filter(e => !e.is_sent);
    advs = advs.filter(e => !e.is_sent);
  }

  // Search
  if (q) {
    const match = e => [e.supplier, e.po, e.description, e.category, e.prSo, e.woSo, e.notes]
      .some(v => v && v.toLowerCase().includes(q));
    if (searchFilters.po)  pos  = pos.filter(match);
    if (searchFilters.adv) advs = advs.filter(match);
    if (!searchFilters.po)  pos  = [];
    if (!searchFilters.adv) advs = [];
  }

  // Sort
  pos  = applySort(pos,  'po');
  advs = applySort(advs, 'adv');

  // Count pills
  const poC  = document.getElementById('po-count');
  const advC = document.getElementById('adv-count');
  if (poC)  { if (poC.textContent  !== String(pos.length))  { poC.textContent  = pos.length;  poC.classList.add('bump');  setTimeout(()=>poC.classList.remove('bump'),300);  } }
  if (advC) { if (advC.textContent !== String(advs.length)) { advC.textContent = advs.length; advC.classList.add('bump'); setTimeout(()=>advC.classList.remove('bump'),300); } }

  // Sidebar stats
  const allPos  = entries.filter(e => !e.advanceAmount || e.advanceAmount === 0);
  const allAdvs = entries.filter(e => e.advanceAmount > 0);
  const pendingSar = entries.filter(e => !e.is_sent)
    .reduce((s, e) => s + (e.advanceAmount > 0 ? (e.advanceAmount||0) : (e.amountSar||0)), 0);
  const now2 = new Date(), ws2 = new Date(now2);
  ws2.setDate(now2.getDate() - now2.getDay()); ws2.setHours(0,0,0,0);
  const sentWeek = entries.filter(e => e.is_sent && new Date(e.date) >= ws2).length;

  animateStat('stat-po-count',    allPos.length);
  animateStat('stat-adv-count',   allAdvs.length);
  animateStat('stat-pending-sar', pendingSar.toLocaleString('en-US', { maximumFractionDigits:0 }));
  animateStat('stat-sent-week',   sentWeek);

  const badge = is => is
    ? `<span class="sp sent">Sent</span>`
    : `<span class="sp pending">Pending</span>`;
  const cat = c => c ? `<span class="cp">${c}</span>` : '-';

  const emptyPo = `<tr class="empty-row"><td colspan="13"><div class="empty-state"><i data-lucide="file-text" class="e-ico"></i><p>${q ? 'No results' : 'No PO entries yet'}</p><span>${q ? 'Try a different search term' : 'Fill the form and click Log Entry'}</span></div></td></tr>`;
  const emptyAdv = `<tr class="empty-row"><td colspan="14"><div class="empty-state"><i data-lucide="landmark" class="e-ico"></i><p>${q ? 'No results' : 'No advance entries yet'}</p><span>${q ? 'Try a different search term' : 'Check "Advance?" when logging'}</span></div></td></tr>`;

  if (poTbody) {
    poTbody.innerHTML = pos.length === 0 ? emptyPo : pos.map(e => {
      const { suppNo, vendorName } = extractSupplier(e.supplier);
      return `<tr style="${e.is_sent ? 'opacity:.55' : ''}">
        <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
        <td>${suppNo || '-'}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${vendorName}">${vendorName}</td>
        <td>${e.po || '-'}</td>
        <td>${(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${e.currency||''}</td>
        <td style="font-weight:600">${(e.amountSar||0).toLocaleString()}</td>
        <td style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)" title="${e.notes||''}">${e.notes||'-'}</td>
        <td style="color:var(--t2)">${e.date}</td>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)" title="${e.description||''}">${e.description||'-'}</td>
        <td>${cat(e.category)}</td>
        <td>${badge(e.is_sent)}</td>
        <td><div class="row-acts">
          ${!e.is_sent ? `<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>` : ''}
          <button class="ra copy-row" onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra danger"   onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  }

  if (advanceTbody) {
    advanceTbody.innerHTML = advs.length === 0 ? emptyAdv : advs.map(e => {
      const { suppNo, vendorName } = extractSupplier(e.supplier);
      const advCur = ((e.amount||0) * (e.advancePercent||0)) / 100;
      return `<tr style="${e.is_sent ? 'opacity:.55' : ''}">
        <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
        <td>${suppNo||'-'}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${vendorName}">${vendorName}</td>
        <td>${e.po||'-'}</td>
        <td>${(e.amount||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td>${e.currency||''}</td>
        <td>${advCur.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
        <td style="font-weight:600">${(e.advanceAmount||0).toLocaleString()}</td>
        <td style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)" title="${e.notes||''}">${e.notes||'-'}</td>
        <td style="color:var(--t2)">${e.date}</td>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--t2)" title="${e.description||''}">${e.description||'-'}</td>
        <td>${cat(e.category)}</td>
        <td>${badge(e.is_sent)}</td>
        <td><div class="row-acts">
          ${!e.is_sent ? `<button class="ra" onclick="startEdit('${e.id}')" title="Edit"><i data-lucide="pencil"></i></button>` : ''}
          <button class="ra copy-row" onclick="reuseEntry('${e.id}')" title="Reuse as new"><i data-lucide="copy-plus"></i></button>
          <button class="ra danger"   onclick="deleteEntry('${e.id}')" title="Delete"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`;
    }).join('');
  }
  lucide.createIcons();
}

// ═══════════════════════════════════════
//  SELECTION BUTTONS
// ═══════════════════════════════════════
window.toggleSelectAll = function(type) {
  const allId = type === 'po' ? 'selectAllPo' : 'selectAllAdv';
  const isChecked = document.getElementById(allId).checked;
  const scope = type === 'po' ? '#po-tbody' : '#advance-tbody';
  document.querySelectorAll(`${scope} .row-checkbox`).forEach(cb => cb.checked = isChecked);
  updateDeleteSelectButton();
};

window.updateDeleteSelectButton = function() {
  const all    = document.querySelectorAll('.row-checkbox:checked');
  const allAdv = document.querySelectorAll('#advance-tbody .row-checkbox:checked');
  const show = (id, count, countId) => {
    const el = document.getElementById(id);
    const ce = document.getElementById(countId);
    if (!el) return;
    if (count > 0) { el.classList.add('visible'); if (ce) ce.textContent = count; }
    else           { el.classList.remove('visible'); }
  };
  show('btn-delete-selected',  all.length,    'selected-count');
  show('btn-requeue-selected', all.length,    'requeue-count');
  show('btn-copy-advances',    allAdv.length, 'copy-count');
};

// ═══════════════════════════════════════
//  WEEKLY ADVANCES MODAL
// ═══════════════════════════════════════
window.openWeeklyAdvancesModal = function() {
  const modal = document.getElementById('weekly-advances-modal');
  const tbody = document.getElementById('weekly-advances-tbody');
  if (!modal || !tbody) return;
  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate() - now.getDay()); start.setHours(0,0,0,0);
  const end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
  const week  = entries.filter(e => e.advanceAmount > 0 && e.date && new Date(e.date) >= start && new Date(e.date) <= end);
  if (!week.length) return showToast('No advances this week', 'info');
  tbody.innerHTML = week.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    const advCur = ((e.amount||0) * (e.advancePercent||0)) / 100;
    return `<tr><td><input type="checkbox" class="weekly-row-checkbox" value="${e.id}" checked></td>
      <td>${suppNo||'-'}</td><td>${vendorName}</td><td>${e.po||'-'}</td>
      <td>${e.description||'-'}</td><td>${e.amount||0}</td><td>${e.currency||''}</td>
      <td>${advCur}</td><td>${e.advanceAmount||0}</td><td>${e.notes||''}</td></tr>`;
  }).join('');
  document.getElementById('selectAllWeekly').checked = true;
  modal.classList.add('active');
  lucide.createIcons();
};

window.toggleSelectAllWeekly = function() {
  const c = document.getElementById('selectAllWeekly').checked;
  document.querySelectorAll('.weekly-row-checkbox').forEach(cb => cb.checked = c);
};

window.copyWeeklyAdvances = function() {
  const checked = document.querySelectorAll('.weekly-row-checkbox:checked');
  if (!checked.length) return showToast('No rows selected', 'info');
  const ids = Array.from(checked).map(cb => cb.value);
  const sel = entries.filter(e => ids.includes(e.id));
  const safe = s => String(s).replace(/\t/g,' ').replace(/\n/g,' ');
  const text = sel.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    const advCur = ((e.amount||0) * (e.advancePercent||0)) / 100;
    return `${safe(suppNo)}\t${safe(vendorName)}\t${safe(e.po||'')}\t${e.amount||0}\t${safe(e.currency||'')}\t${advCur}\t${e.advanceAmount||0}\t${safe(e.notes||'')}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast(`Copied ${sel.length} advances`, 'success'))
    .catch(() => showToast('Copy failed', 'error'));
};

window.copyAdvances = function() {
  const checked = document.querySelectorAll('#advance-tbody .row-checkbox:checked');
  if (!checked.length) return showToast('No advances selected', 'info');
  const ids = Array.from(checked).map(cb => cb.value);
  const sel = entries.filter(e => ids.includes(e.id));
  const safe = s => String(s).replace(/\t/g,' ').replace(/\n/g,' ');
  const text = sel.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    const advCur = ((e.amount||0) * (e.advancePercent||0)) / 100;
    return `${safe(suppNo)}\t${safe(vendorName)}\t${safe(e.po||'')}\t${e.amount||0}\t${safe(e.currency||'')}\t${advCur}\t${e.advanceAmount||0}\t${safe(e.notes||'')}`;
  }).join('\n');
  navigator.clipboard.writeText(text).then(() => { showToast(`Copied ${sel.length} rows`, 'success'); updateDeleteSelectButton(); })
    .catch(() => showToast('Copy failed', 'error'));
};

window.requeueSelected = async function() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  if (!checked.length) return;
  const ids = Array.from(checked).map(cb => cb.value);
  try {
    const { error } = await supabaseClient.from('entries').update({ is_sent:false }).in('id', ids);
    if (error) throw error;
    showToast(`Re-queued ${ids.length} records`, 'success');
    await loadEntries();
  } catch (err) { showToast('Requeue failed: ' + err.message, 'error'); }
};

window.deleteSelected = async function() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  if (!checked.length) return;
  if (!confirm(`Delete ${checked.length} selected records?`)) return;
  const ids = Array.from(checked).map(cb => cb.value);
  try {
    const { error } = await supabaseClient.from('entries').delete().in('id', ids);
    if (error) throw error;
    showToast(`Deleted ${ids.length} records`, 'success');
    await loadEntries();
  } catch (err) { showToast('Delete failed: ' + err.message, 'error'); }
};

// ═══════════════════════════════════════
//  CALCULATE
// ═══════════════════════════════════════
function calculate() {
  const amt   = getNum('amount');
  const rates = { SAR:1, USD:3.75, EUR:4.10, GBP:4.80, AED:1.02, BHD:9.95, KWD:12.20, OMR:9.75, QAR:1.03, CNY:0.52 };
  const cur   = currencySelect.value;
  const rate  = rates[cur] || 1;
  const sar   = amt * rate;
  amountSarInput.value = sar.toFixed(2);
  const hint = document.getElementById('rate-hint');
  if (hint) hint.textContent = cur === 'SAR' ? '' : `Rate: 1 ${cur} = ${rate} SAR`;

  const showAdv = approvalTypeSelect.value === 'Advance Approval' || (approvalTypeSelect.value === 'PO Approval' && hasAdvanceCheckbox.checked);
  if (showAdv) {
    advanceFields.style.display = 'grid';
    const p = advancePercentSelect.value === 'custom' ? getNum('custom-percent') : getNum('advance-percent');
    advanceAmountInput.value = (sar * p / 100).toFixed(2);
    const advCurEl = document.getElementById('advance-amount-cur');
    if (advCurEl) advCurEl.value = (amt * p / 100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ' + cur;
  } else {
    advanceFields.style.display = 'none';
    advanceAmountInput.value = 0;
    const advCurEl = document.getElementById('advance-amount-cur');
    if (advCurEl) advCurEl.value = '';
  }
}

// ═══════════════════════════════════════
//  EMAIL DISPATCH
// ═══════════════════════════════════════
async function sendEmailToManager(isScheduled = false) {
  const pending = entries.filter(i => !i.is_sent);
  if (!pending.length) { if (!isScheduled) showToast('No pending items to send', 'info'); return; }
  if (isScheduled) {
    const lock = localStorage.getItem('last_auto_send_lock');
    if (lock && (Date.now() - parseInt(lock) < 120000)) return;
    localStorage.setItem('last_auto_send_lock', Date.now().toString());
  }
  isSendingNow = true;
  try {
    if (!managerEmail) throw new Error('Manager email not set');
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) throw new Error('EmailJS keys missing in Settings');
    const ids = pending.map(i => i.id);
    const { error:ue } = await supabaseClient.from('entries').update({ is_sent:true }).in('id', ids).eq('is_sent', false);
    if (ue) throw ue;
    const today = new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'}).replace(/\//g,'-');
    const pos  = pending.filter(i => !i.advanceAmount || i.advanceAmount === 0);
    const advs = pending.filter(i => i.advanceAmount > 0);
    const mkRow = (...cells) => `<tr>${cells.map(c=>`<td>${c}</td>`).join('')}</tr>`;
    const th = s => `<th>${s}</th>`;
    const tblStyle = 'border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;';
    const thStyle = 'background:#f8fafc;color:#0f172a;';
    let poH = '', advH = '';
    if (pos.length) {
      poH = `<h3 style="font-family:sans-serif">📅 PO Approvals:</h3><table border="1" cellpadding="8" style="${tblStyle}"><tr style="${thStyle}">${['Supp.','Vendor','PO #','Description','Amount','Cur','SAR ⃁','Notes'].map(th).join('')}</tr>`;
      pos.forEach(e => { const {suppNo,vendorName}=extractSupplier(e.supplier); poH+=mkRow(suppNo||'-',vendorName,e.po||'-',e.description||'-',(e.amount||0).toLocaleString(),e.currency||'-',`<b>${(e.amountSar||0).toLocaleString()}</b>`,e.notes||'-'); });
      poH += '</table>';
    }
    if (advs.length) {
      advH = `<h3 style="font-family:sans-serif">💰 Advance Approvals:</h3><table border="1" cellpadding="8" style="${tblStyle}"><tr style="${thStyle}">${['Supp.','Vendor','PO #','Description','PO Amt','Cur','Adv (Cur)','Adv (SAR)','Notes'].map(th).join('')}</tr>`;
      advs.forEach(e => { const {suppNo,vendorName}=extractSupplier(e.supplier); const ac=(((e.amount||0)*(e.advancePercent||0))/100); advH+=mkRow(suppNo||'-',vendorName,e.po||'-',e.description||'-',(e.amount||0).toLocaleString(),e.currency||'-',`<b>${ac.toLocaleString()}</b>`,`<b>${(e.advanceAmount||0).toLocaleString()}</b>`,e.notes||'-'); });
      advH += '</table>';
    }
    const totalPo  = pos.reduce((s,i)=>s+(i.amountSar||0),0);
    const totalAdv = advs.reduce((s,i)=>s+(i.advanceAmount||0),0);
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      subject_line:`GM Procurement Approval Request - ${today}`,
      to_email: managerEmail, cc_email: ccEmailsArray.join(', '),
      po_table: poH, adv_table: advH,
      summary_count: pending.length, po_count: pos.length, adv_count: advs.length,
      total_po_sar: totalPo.toLocaleString(), total_adv_sar: totalAdv.toLocaleString(),
      total_sar: (totalPo+totalAdv).toLocaleString()
    }, EMAILJS_PUBLIC_KEY);
    showToast('Dispatched successfully!', 'success');
  } catch (err) {
    if (pending.length) await supabaseClient.from('entries').update({ is_sent:false }).in('id', pending.map(i=>i.id));
    showToast('Dispatch failed: ' + (err.text || err.message || err), 'error');
  } finally { isSendingNow = false; }
}

async function checkSchedule() {
  const now = new Date();
  const t = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  if (t === dailySendTime && !isSendingNow && entries.some(e => !e.is_sent)) await sendEmailToManager(true);
}

// ═══════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════
function exportToExcel() {
  if (!entries.length) return showToast('No entries to export', 'info');
  const pos  = entries.filter(e => !e.advanceAmount || e.advanceAmount === 0);
  const advs = entries.filter(e => e.advanceAmount > 0);
  const esc  = s => String(s).replace(/[<>&'"]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]));
  const row  = cells => `<Row>${cells.map(c=>`<Cell><Data ss:Type="${typeof c==='number'?'Number':'String'}">${esc(c)}</Data></Cell>`).join('')}</Row>`;
  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`;
  xml += `<Worksheet ss:Name="PO Approvals"><Table>${row(['Date','Description','Category','PR/SO #','WO/SO #','PO #','Supplier','Amount','Currency','SAR','Notes','Status'])}`;
  pos.forEach(e => xml += row([e.date,e.description||'',e.category||'',e.prSo||'',e.woSo||'',e.po||'',e.supplier||'',e.amount,e.currency,e.amountSar,e.notes||'',e.is_sent?'SENT':'Pending']));
  xml += `</Table></Worksheet><Worksheet ss:Name="Advances"><Table>${row(['Date','Description','Category','PO #','Supplier','Amount','Currency','Adv%','Adv(Cur)','Adv(SAR)','Notes','Status'])}`;
  advs.forEach(e => xml += row([e.date,e.description||'',e.category||'',e.po||'',e.supplier||'',e.amount,e.currency,e.advancePercent,(e.amount*e.advancePercent/100),e.advanceAmount,e.notes||'',e.is_sent?'SENT':'Pending']));
  xml += `</Table></Worksheet></Workbook>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([xml],{type:'application/vnd.ms-excel'}));
  a.download = `Approvals_${new Date().toLocaleDateString('en-GB').replace(/\//g,'-')}.xls`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ═══════════════════════════════════════
//  SUPPLIER MEMORY
// ═══════════════════════════════════════
function updateSupplierList() {
  const dl = document.getElementById('supplier-list');
  if (!dl) return;
  const forgotten = JSON.parse(localStorage.getItem('forgotten_suppliers') || '[]');
  const unique = [...new Set(entries.map(e=>e.supplier).filter(Boolean))].filter(s=>!forgotten.includes(s)).sort();
  dl.innerHTML = unique.map(s=>`<option value="${s}">`).join('');
}

function removeSupplierFromMemory() {
  const v = document.getElementById('supplier')?.value.trim();
  if (!v) return showToast('Type a supplier name first', 'info');
  if (!confirm(`Remove "${v}" from suggestions?`)) return;
  const f = JSON.parse(localStorage.getItem('forgotten_suppliers')||'[]');
  if (!f.includes(v)) { f.push(v); localStorage.setItem('forgotten_suppliers', JSON.stringify(f)); }
  updateSupplierList(); buildReuseMenu();
  showToast(`"${v}" removed`, 'success');
  document.getElementById('supplier').value = '';
}

// ═══════════════════════════════════════
//  CC TAGS
// ═══════════════════════════════════════
function renderCcTags() {
  const list = document.getElementById('cc-tags-list');
  if (!list) return;
  list.innerHTML = ccEmailsArray.map((e,i) =>
    `<div class="tag"><span>${e}</span><i data-lucide="x" onclick="removeCcTag(${i})"></i></div>`
  ).join('');
  lucide.createIcons();
}
window.addCcFromInput = function() {
  const input = document.getElementById('new-cc-input');
  const email = input?.value.trim();
  if (email && email.includes('@') && !ccEmailsArray.includes(email)) {
    ccEmailsArray.push(email); input.value = '';
    renderCcTags(); updateSettings();
  }
};
window.removeCcTag = function(i) { ccEmailsArray.splice(i,1); renderCcTags(); updateSettings(); };

// ═══════════════════════════════════════
//  THEME
// ═══════════════════════════════════════
function initTheme() {
  const t = localStorage.getItem('theme_preference') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const ico = document.getElementById('theme-icon');
  if (ico) { ico.setAttribute('data-lucide', t==='dark'?'sun':'moon'); lucide.createIcons(); }
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const nxt = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', nxt);
  localStorage.setItem('theme_preference', nxt);
  const ico = document.getElementById('theme-icon');
  if (ico) { ico.setAttribute('data-lucide', nxt==='dark'?'sun':'moon'); lucide.createIcons(); }
}

// ═══════════════════════════════════════
//  FORM DRAFT
// ═══════════════════════════════════════
const DRAFT_FIELDS = ['approval-type','pr-so-number','po-number','wo-so-number','description','category','supplier','amount','currency','notes'];
function saveDraft() {
  if (currentEditingId) return;
  const d = {};
  DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) d[id] = el.value; });
  d['has-advance']      = hasAdvanceCheckbox?.checked;
  d['advance-percent']  = advancePercentSelect?.value;
  d['custom-percent']   = customPercentInput?.value;
  sessionStorage.setItem('approval_form_draft', JSON.stringify(d));
}
function restoreDraft() {
  try {
    const d = JSON.parse(sessionStorage.getItem('approval_form_draft') || '{}');
    if (!Object.keys(d).length) return;
    DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el && d[id] !== undefined) el.value = d[id]; });
    if (hasAdvanceCheckbox && d['has-advance']) hasAdvanceCheckbox.checked = d['has-advance'];
    if (advancePercentSelect && d['advance-percent']) advancePercentSelect.value = d['advance-percent'];
    if (customPercentInput  && d['custom-percent'])  customPercentInput.value = d['custom-percent'];
    if (advancePercentSelect?.value === 'custom') customPercentGroup.style.display = 'block';
  } catch {}
}

// ═══════════════════════════════════════
//  LAYOUT CONTROLS
// ═══════════════════════════════════════
function setupLayout() {
  const app  = document.getElementById('app');
  const fab  = document.getElementById('fab-restore');
  const btnS = document.getElementById('btn-sidebar-toggle');
  const btnF = document.getElementById('btn-form-toggle');
  const btnM = document.getElementById('btn-maximize');

  btnS?.addEventListener('click', () => {
    if (app.classList.contains('maximized')) return;
    app.classList.toggle('sidebar-off');
    btnS.classList.toggle('on', app.classList.contains('sidebar-off'));
  });

  btnF?.addEventListener('click', () => {
    if (app.classList.contains('maximized')) return;
    const off = app.classList.toggle('form-off');
    btnF.classList.toggle('on', off);
    const ico = btnF.querySelector('i');
    if (ico) ico.setAttribute('data-lucide', off ? 'sidebar-open' : 'sidebar-close');
    lucide.createIcons();
    if (fab) fab.style.display = off ? 'inline-flex' : 'none';
  });

  btnM?.addEventListener('click', () => {
    const isMax = app.classList.contains('maximized');
    if (isMax) {
      app.classList.remove('maximized','sidebar-off','form-off');
      btnM.classList.remove('on');
      const ico = btnM.querySelector('i'); if (ico) { ico.setAttribute('data-lucide','maximize-2'); lucide.createIcons(); }
      if (fab) fab.style.display = 'none';
    } else {
      app.dataset.prevS = app.classList.contains('sidebar-off') ? '1' : '0';
      app.dataset.prevF = app.classList.contains('form-off')    ? '1' : '0';
      app.classList.add('maximized','sidebar-off','form-off');
      btnM.classList.add('on');
      const ico = btnM.querySelector('i'); if (ico) { ico.setAttribute('data-lucide','minimize-2'); lucide.createIcons(); }
      if (fab) fab.style.display = 'inline-flex';
    }
  });

  fab?.addEventListener('click', () => {
    app.classList.remove('maximized','sidebar-off','form-off');
    btnM?.classList.remove('on');
    btnF?.classList.remove('on');
    btnS?.classList.remove('on');
    const ico = btnM?.querySelector('i'); if (ico) { ico.setAttribute('data-lucide','maximize-2'); lucide.createIcons(); }
    const ico2 = btnF?.querySelector('i'); if (ico2) { ico2.setAttribute('data-lucide','sidebar-close'); lucide.createIcons(); }
    if (fab) fab.style.display = 'none';
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);
    if (!inInput && e.key === '/') { e.preventDefault(); document.getElementById('pipeline-search')?.focus(); }
    if (!inInput && (e.altKey && e.key === 'n')) { e.preventDefault(); document.getElementById('po-number')?.focus(); document.querySelector('.form-inner')?.scrollTo({top:0,behavior:'smooth'}); }
    if ((e.metaKey||e.ctrlKey) && e.shiftKey && e.key === 'M') { e.preventDefault(); btnM?.click(); }
    if ((e.metaKey||e.ctrlKey) && e.key === 'b') { e.preventDefault(); btnS?.click(); }
  });
}

// ═══════════════════════════════════════
//  LISTENERS
// ═══════════════════════════════════════
approvalForm.addEventListener('submit', createEntry);
approvalForm.addEventListener('input',  saveDraft);
approvalForm.addEventListener('change', saveDraft);
approvalForm.addEventListener('submit', () => setTimeout(() => sessionStorage.removeItem('approval_form_draft'), 1500));

amountInput.addEventListener('input', calculate);
currencySelect.addEventListener('change', calculate);
approvalTypeSelect.addEventListener('change', calculate);
hasAdvanceCheckbox.addEventListener('change', calculate);
advancePercentSelect.addEventListener('change', () => {
  customPercentGroup.style.display = advancePercentSelect.value === 'custom' ? 'block' : 'none';
  calculate();
});
customPercentInput.addEventListener('input', calculate);

btnSettings?.addEventListener('click', () => settingsModal.classList.add('active'));
document.getElementById('btn-close-settings')?.addEventListener('click', () => settingsModal.classList.remove('active'));
btnSaveSettings?.addEventListener('click', updateSettings);
btnFinalize?.addEventListener('click', () => sendEmailToManager(false));
btnCancelEdit?.addEventListener('click', cancelEdit);
inputManagerEmail?.addEventListener('change', updateSettings);
document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
btnActivateSetup?.addEventListener('click', activateDashboard);
document.getElementById('btn-export')?.addEventListener('click', exportToExcel);
document.getElementById('btn-remove-supplier')?.addEventListener('click', removeSupplierFromMemory);
document.getElementById('btn-close-weekly-advances')?.addEventListener('click', () => document.getElementById('weekly-advances-modal').classList.remove('active'));

// CC enter key
document.getElementById('new-cc-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addCcFromInput(); }
});

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════
setupLayout();
init();
