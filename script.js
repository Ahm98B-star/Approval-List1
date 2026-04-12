// CONFIGURATION
let SUPABASE_URL = localStorage.getItem('supabase_project_url') || '';
let SUPABASE_ANON_KEY = localStorage.getItem('supabase_anon_key') || '';
let EMAILJS_SERVICE_ID = localStorage.getItem('emailjs_service_id') || '';
let EMAILJS_TEMPLATE_ID = localStorage.getItem('emailjs_template_id') || '';
let EMAILJS_PUBLIC_KEY = localStorage.getItem('emailjs_public_key') || '';

let supabaseClient = null;
let entries = [];
let editMode = false;
let currentEditingId = null;
let dailySendTime = '09:00';
let managerEmail = '';
let ccEmailsArray = [];
let isSendingNow = false;

// SELECTORS
const approvalForm = document.getElementById('approval-form');
const poTbody = document.getElementById('po-tbody');
const advanceTbody = document.getElementById('advance-tbody');
const poDateSpan = document.getElementById('po-date');
const amountInput = document.getElementById('amount');
const currencySelect = document.getElementById('currency');
const amountSarInput = document.getElementById('amount-sar');
const advanceFields = document.getElementById('advance-fields');
const approvalTypeSelect = document.getElementById('approval-type');
const advancePercentSelect = document.getElementById('advance-percent');
const customPercentInput = document.getElementById('custom-percent');
const customPercentGroup = document.getElementById('custom-percent-group');
const advanceAmountInput = document.getElementById('advance-amount');
const inputManagerEmail = document.getElementById('input-manager-email');
const inputSendTime = document.getElementById('input-send-time');
const inputDbKey = document.getElementById('input-db-key');
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const setupModal = document.getElementById('setup-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnActivateSetup = document.getElementById('btn-activate-setup');
const btnFinalize = document.getElementById('btn-finalize');
const btnCancelEdit = document.getElementById('btn-cancel-edit');

// HELPERS
const getVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const getNum = (id) => parseFloat(getVal(id)) || 0;

function extractSupplier(supplierStr) {
  let vendorName = (supplierStr || "").trim();
  if (!vendorName || vendorName === "-") return { suppNo: "", vendorName: "-" };
  
  let m = vendorName.match(/^(\d{3,15})(?:\s*[-_@:\|]+\s*|\s+)(.*)$/);
  if (m) return { suppNo: m[1], vendorName: m[2].trim() };
  
  m = vendorName.match(/^(.*?)(?:\s*[-_@:\|]+\s*|\s+)(\d{3,15})$/);
  if (m) return { suppNo: m[2], vendorName: m[1].trim() };
  
  return { suppNo: "", vendorName };
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

// INITIALIZATION
async function init() {
  lucide.createIcons();
  poDateSpan.textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  initTheme();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    setupModal.classList.add('active');
    return;
  }

  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
      emailjs.init(EMAILJS_PUBLIC_KEY);
    }

    await loadSettings();
    await autoPurgeOldRecords();
    await loadEntries();
    subscribeToChanges();
    calculate();
    setInterval(checkSchedule, 30000); // Check every 30 seconds closely
  } catch (err) {
    showToast('Database connection failed. Please check your key in Settings.', 'error');
  }
}

async function activateDashboard() {
  const urlEl = document.getElementById('setup-db-url');
  const keyEl = document.getElementById('setup-db-key');
  const url = urlEl ? urlEl.value.trim() : '';
  const key = keyEl ? keyEl.value.trim() : '';
  
  if (!url || !key) return showToast('Please enter both the Project URL and the Team Database Key', 'error');

  // Basic cleanup in case they pasted the full URL incorrectly
  const cleanUrl = url.endsWith('/') ? url.slice(0, -1) : url;

  localStorage.setItem('supabase_project_url', cleanUrl);
  localStorage.setItem('supabase_anon_key', key);
  SUPABASE_URL = cleanUrl;
  SUPABASE_ANON_KEY = key;
  setupModal.classList.remove('active');
  window.location.reload(); // Restart with the new connection
}

// DATABASE LOGIC
async function loadSettings() {
  const { data } = await supabaseClient.from('settings').select('*');
  if (data) {
    const sTime = data.find(i => i.key === 'send_time');
    const sEmail = data.find(i => i.key === 'manager_email');
    const sCC = data.find(i => i.key === 'cc_emails');

    inputDbKey.value = SUPABASE_ANON_KEY;
    const inputUrl = document.getElementById('input-db-url');
    if (inputUrl) inputUrl.value = SUPABASE_URL;

    const inputEmailSvc = document.getElementById('input-emailjs-svc');
    const inputEmailTpl = document.getElementById('input-emailjs-tpl');
    const inputEmailPub = document.getElementById('input-emailjs-pub');
    if (inputEmailSvc) inputEmailSvc.value = EMAILJS_SERVICE_ID;
    if (inputEmailTpl) inputEmailTpl.value = EMAILJS_TEMPLATE_ID;
    if (inputEmailPub) inputEmailPub.value = EMAILJS_PUBLIC_KEY;

    if (sTime) { 
      dailySendTime = sTime.value; 
      inputSendTime.value = dailySendTime; 
      const scheduleText = document.getElementById('daily-schedule-text');
      if (scheduleText) scheduleText.textContent = 'Auto-Dispatch: ' + dailySendTime;
    }
    if (sEmail) { managerEmail = sEmail.value; inputManagerEmail.value = managerEmail; }
    if (sCC) {
      ccEmailsArray = sCC.value ? sCC.value.split(',').map(e => e.trim()).filter(e => e) : [];
      renderCcTags();
    }
  }
}

async function updateSettings() {
  const newKey = inputDbKey.value.trim();
  const inputUrlEl = document.getElementById('input-db-url');
  const newUrl = inputUrlEl ? inputUrlEl.value.trim() : SUPABASE_URL;
  
  const inputEmailSvcEl = document.getElementById('input-emailjs-svc');
  const newEmailSvc = inputEmailSvcEl ? inputEmailSvcEl.value.trim() : EMAILJS_SERVICE_ID;
  const inputEmailTplEl = document.getElementById('input-emailjs-tpl');
  const newEmailTpl = inputEmailTplEl ? inputEmailTplEl.value.trim() : EMAILJS_TEMPLATE_ID;
  const inputEmailPubEl = document.getElementById('input-emailjs-pub');
  const newEmailPub = inputEmailPubEl ? inputEmailPubEl.value.trim() : EMAILJS_PUBLIC_KEY;

  const newTime = inputSendTime.value;
  const newEmail = inputManagerEmail.value.trim();
  const newCC = ccEmailsArray.join(',');

  const scheduleText = document.getElementById('daily-schedule-text');
  if (scheduleText) scheduleText.textContent = 'Auto-Dispatch: ' + newTime;

  if (newKey !== SUPABASE_ANON_KEY || newUrl !== SUPABASE_URL || newEmailSvc !== EMAILJS_SERVICE_ID || newEmailTpl !== EMAILJS_TEMPLATE_ID || newEmailPub !== EMAILJS_PUBLIC_KEY) {
    localStorage.setItem('supabase_anon_key', newKey);
    localStorage.setItem('supabase_project_url', newUrl);
    localStorage.setItem('emailjs_service_id', newEmailSvc);
    localStorage.setItem('emailjs_template_id', newEmailTpl);
    localStorage.setItem('emailjs_public_key', newEmailPub);
    showToast('Credentials updated. Refreshing...', 'success');
    setTimeout(() => window.location.reload(), 1000);
    return;
  }

  try {
    await supabaseClient.from('settings').upsert([{ key: 'send_time', value: newTime }], { onConflict: 'key' });
    await supabaseClient.from('settings').upsert([{ key: 'manager_email', value: newEmail }], { onConflict: 'key' });
    await supabaseClient.from('settings').upsert([{ key: 'cc_emails', value: newCC }], { onConflict: 'key' });

    dailySendTime = newTime;
    managerEmail = newEmail;
    showToast('Settings Saved!', 'success');
    settingsModal.classList.remove('active');
  } catch (e) { showToast('Sync Failed', 'error'); }
}

async function loadEntries() {
  const { data, error } = await supabaseClient.from('entries').select('*').order('created_at', { ascending: false });
  if (error) {
    console.error('Supabase Load Error:', error);
    return showToast('Load Failed: ' + error.message, 'error');
  }
  entries = data.map(i => ({
    id: i.id,
    date: i.po_date,
    prSo: i.pr_so_number,
    po: i.po_number,
    woSo: i.wo_so_number,
    description: i.description,
    category: i.category,
    supplier: i.supplier,
    amount: i.amount,
    currency: i.currency,
    amountSar: i.amount_sar,
    advancePercent: i.advance_percent,
    advanceAmount: i.advance_amount,
    notes: i.notes,
    is_sent: i.is_sent
  }));
  renderDashboard();
  updateSupplierList();
}

async function createEntry(e) {
  e.preventDefault();
  const entryData = {
    po_date: new Date().toISOString().split('T')[0],
    description: document.getElementById('description').value,
    category: document.getElementById('category').value,
    pr_so_number: document.getElementById('pr-so-number').value,
    wo_so_number: document.getElementById('wo-so-number').value,
    po_number: document.getElementById('po-number').value,
    supplier: document.getElementById('supplier').value,
    amount: parseFloat(amountInput.value),
    currency: currencySelect.value,
    amount_sar: parseFloat(amountSarInput.value),
    advance_percent: parseFloat(advancePercentSelect.value === 'custom' ? customPercentInput.value : advancePercentSelect.value) || 0,
    advance_amount: parseFloat(advanceAmountInput.value) || 0,
    notes: document.getElementById('notes').value,
    is_sent: false
  };

  try {
    if (currentEditingId) {
      const { error } = await supabaseClient.from('entries').update(entryData).eq('id', currentEditingId);
      if (error) throw error;
      currentEditingId = null;
      btnCancelEdit.style.display = 'none';
      showToast('Entry Updated Successfully', 'success');
    } else {
      const { error } = await supabaseClient.from('entries').insert([entryData]);
      if (error) throw error;
      showToast('Entry Recorded Successfully', 'success');
    }
    approvalForm.reset();
    calculate();
  } catch (err) {
    console.error('Save error:', err);
    showToast('Save Failed: ' + err.message, 'error');
  }
}

async function deleteEntry(id) {
  if (confirm('Delete this record?')) {
    await supabaseClient.from('entries').delete().eq('id', id);
    await loadEntries();
  }
}

// EDITING
function startEdit(id) {
  const e = entries.find(i => i.id === id);
  if (!e) return;
  editMode = true;
  currentEditingId = id;
  document.getElementById('form-title').textContent = 'Editing Approval Record';
  btnCancelEdit.style.display = 'inline-flex';

  document.getElementById('approval-type').value = (e.advanceAmount > 0) ? 'Advance Approval' : 'PO Approval';
  document.getElementById('pr-so-number').value = e.prSo || '';
  document.getElementById('po-number').value = e.po || '';
  document.getElementById('wo-so-number').value = e.woSo || '';
  document.getElementById('description').value = e.description || '';
  document.getElementById('category').value = e.category || '';
  document.getElementById('supplier').value = e.supplier || '';
  document.getElementById('amount').value = e.amount;
  document.getElementById('currency').value = e.currency;
  document.getElementById('notes').value = e.notes || '';

  if (e.advanceAmount > 0) {
    advancePercentSelect.value = 'custom';
    customPercentGroup.style.display = 'block';
    customPercentInput.value = e.advancePercent;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
  calculate();
}

function cancelEdit() {
  editMode = false;
  currentEditingId = null;
  document.getElementById('form-title').textContent = 'Create New Approval Record';
  btnCancelEdit.style.display = 'none';
  approvalForm.reset();
  calculate();
}

// RENDER
function renderDashboard() {
  const hideSent = document.getElementById('toggle-hide-sent') ? document.getElementById('toggle-hide-sent').checked : false;

  let pos = entries.filter(i => (i.advanceAmount === 0 || !i.advanceAmount));
  let advs = entries.filter(i => i.advanceAmount > 0);

  if (hideSent) {
    pos = pos.filter(i => !i.is_sent);
    advs = advs.filter(i => !i.is_sent);
  }

  const poCountEl = document.getElementById('po-count');
  if (poCountEl) poCountEl.textContent = pos.length;
  
  const advCountEl = document.getElementById('adv-count');
  if (advCountEl) advCountEl.textContent = advs.length;

  if (poTbody) poTbody.innerHTML = pos.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    return `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
      <td>${suppNo || '-'}</td>
      <td>${vendorName}</td>
      <td>${e.po || '-'}</td>
      <td>${(e.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td>${e.currency || ''}</td>
      <td>${(e.amountSar || 0).toLocaleString()}</td>
      <td>${e.notes || '-'}</td>
      <td>${e.date}</td>
      <td title="${e.description || ''}">${e.description || '-'}</td>
      <td><span class="badge" style="background:rgba(255,255,255,0.1);">${e.category || '-'}</span></td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td>
        ${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px; margin-right:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}
        <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
      </td>
    </tr>
  `}).join('');

  if (advanceTbody) advanceTbody.innerHTML = advs.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    return `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
      <td>${suppNo || '-'}</td>
      <td>${vendorName}</td>
      <td>${e.po || '-'}</td>
      <td>${(e.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td>${e.currency || ''}</td>
      <td>${(((e.amount || 0) * (e.advancePercent || 0)) / 100).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
      <td>${(e.advanceAmount || 0).toLocaleString()}</td>
      <td>${e.notes || '-'}</td>
      <td>${e.date}</td>
      <td title="${e.description || ''}">${e.description || '-'}</td>
      <td><span class="badge" style="background:rgba(255,255,255,0.1);">${e.category || '-'}</span></td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td>
        ${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px; margin-right:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}
        <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
      </td>
    </tr>
  `}).join('');

  lucide.createIcons();
}

window.toggleSelectAll = function(type) {
  const isChecked = document.getElementById(type === 'po' ? 'selectAllPo' : 'selectAllAdv').checked;
  const checkboxes = document.querySelectorAll(type === 'po' ? '#po-tbody .row-checkbox' : '#advance-tbody .row-checkbox');
  checkboxes.forEach(cb => cb.checked = isChecked);
  updateDeleteSelectButton();
};

window.updateDeleteSelectButton = function() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  const checkedAdv = document.querySelectorAll('#advance-tbody .row-checkbox:checked');
  const btnDel = document.getElementById('btn-delete-selected');
  const countSpanDel = document.getElementById('selected-count');
  const btnReq = document.getElementById('btn-requeue-selected');
  const countSpanReq = document.getElementById('requeue-count');
  const btnCopy = document.getElementById('btn-copy-advances');
  const countSpanCopy = document.getElementById('copy-count');

  if (checked.length > 0) {
    if (countSpanDel) countSpanDel.textContent = checked.length;
    if (btnDel) btnDel.style.display = 'inline-flex';
    if (countSpanReq) countSpanReq.textContent = checked.length;
    if (btnReq) btnReq.style.display = 'inline-flex';
  } else {
    if (btnDel) btnDel.style.display = 'none';
    if (btnReq) btnReq.style.display = 'none';
  }
  
  if (checkedAdv.length > 0) {
    if (countSpanCopy) countSpanCopy.textContent = checkedAdv.length;
    if (btnCopy) btnCopy.style.display = 'inline-flex';
  } else {
    if (btnCopy) btnCopy.style.display = 'none';
  }
};

window.openWeeklyAdvancesModal = function() {
  const modal = document.getElementById('weekly-advances-modal');
  const tbody = document.getElementById('weekly-advances-tbody');
  if (!modal || !tbody) return;

  const now = new Date();
  const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
  startOfWeek.setHours(0,0,0,0);
  now.setTime(new Date().getTime());
  const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6));
  endOfWeek.setHours(23,59,59,999);
  
  const weeklyAdvs = entries.filter(e => {
    if (!e.date || e.advanceAmount === 0 || !e.advanceAmount) return false;
    const d = new Date(e.date);
    return d >= startOfWeek && d <= endOfWeek;
  });

  if (weeklyAdvs.length === 0) {
    return showToast('No advances found for this week', 'info');
  }

  tbody.innerHTML = weeklyAdvs.map(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    const advCur = ((e.amount || 0) * (e.advancePercent || 0)) / 100;
    return `
      <tr>
        <td><input type="checkbox" class="weekly-row-checkbox" value="${e.id}" checked></td>
        <td>${suppNo || '-'}</td>
        <td>${vendorName}</td>
        <td>${e.po || '-'}</td>
        <td title="${e.description || ''}">${e.description || '-'}</td>
        <td>${e.amount || 0}</td>
        <td>${e.currency || ''}</td>
        <td>${advCur}</td>
        <td>${e.advanceAmount || 0}</td>
        <td>${e.notes || ''}</td>
      </tr>
    `;
  }).join('');
  
  const selectAll = document.getElementById('selectAllWeekly');
  if (selectAll) selectAll.checked = true;
  
  modal.classList.add('active');
  if (window.lucide) lucide.createIcons();
};

window.toggleSelectAllWeekly = function() {
  const isChecked = document.getElementById('selectAllWeekly').checked;
  document.querySelectorAll('.weekly-row-checkbox').forEach(cb => cb.checked = isChecked);
};

window.copyWeeklyAdvances = function() {
  const checkedBoxes = document.querySelectorAll('.weekly-row-checkbox:checked');
  if (checkedBoxes.length === 0) return showToast('No rows selected to copy', 'info');
  
  const ids = Array.from(checkedBoxes).map(cb => cb.value);
  const selectedAdvs = entries.filter(e => ids.includes(e.id));
  
  let text = "";
  
  selectedAdvs.forEach(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    
    const poNum = e.po || "";
    const description = e.description || "";
    const poAmount = e.amount || 0;
    const poCurr = e.currency || "";
    const advCur = ((e.amount || 0) * (e.advancePercent || 0)) / 100;
    const advSar = e.advanceAmount || 0;
    const remarks = e.notes || "";
    
    const safeStr = (str) => String(str).replace(/\t/g, " ").replace(/\n/g, " ");
    
    text += `${safeStr(suppNo)}\t${safeStr(vendorName)}\t${safeStr(poNum)}\t${safeStr(description)}\t${poAmount}\t${safeStr(poCurr)}\t${advCur}\t${advSar}\t${safeStr(remarks)}\n`;
  });
  
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied ${selectedAdvs.length} advances to clipboard!`, 'success');
  }).catch(err => {
    showToast('Failed to copy. Please try again.', 'error');
  });
};

window.copyAdvances = function() {
  const checkedAdv = document.querySelectorAll('#advance-tbody .row-checkbox:checked');
  if (checkedAdv.length === 0) return showToast('No advances selected to copy', 'info');
  
  const ids = Array.from(checkedAdv).map(cb => cb.value);
  const selectedAdvs = entries.filter(e => ids.includes(e.id));
  
  let text = "Supplier No.\tVendor Name\tPO number\tDescription\tPO amount\tPO Currency\tAdvance amount in PO Currency\tAdvance amount in SAR\tRemarks\n";
  
  selectedAdvs.forEach(e => {
    const { suppNo, vendorName } = extractSupplier(e.supplier);
    
    const poNum = e.po || "";
    const description = e.description || "";
    const poAmount = e.amount || 0;
    const poCurr = e.currency || "";
    const advCur = ((e.amount || 0) * (e.advancePercent || 0)) / 100;
    const advSar = e.advanceAmount || 0;
    const remarks = e.notes || "";
    
    const safeStr = (str) => String(str).replace(/\t/g, " ").replace(/\n/g, " ");
    
    text += `${safeStr(suppNo)}\t${safeStr(vendorName)}\t${safeStr(poNum)}\t${safeStr(description)}\t${poAmount}\t${safeStr(poCurr)}\t${advCur}\t${advSar}\t${safeStr(remarks)}\n`;
  });
  
  navigator.clipboard.writeText(text).then(() => {
    showToast(`Copied ${selectedAdvs.length} rows to clipboard!`, 'success');
    if(document.getElementById('selectAllAdv')) document.getElementById('selectAllAdv').checked = false;
    document.querySelectorAll('#advance-tbody .row-checkbox:checked').forEach(cb => cb.checked = false);
    updateDeleteSelectButton();
  }).catch(err => {
    showToast('Failed to copy to clipboard', 'error');
  });
};

window.requeueSelected = async function() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  if (checked.length === 0) return;
  const ids = Array.from(checked).map(cb => cb.value);
  try {
    const { error } = await supabaseClient.from('entries').update({ is_sent: false }).in('id', ids);
    if (error) throw error;
    showToast(`Re-Queued ${ids.length} records instantly!`, 'success');
    document.getElementById('btn-delete-selected').style.display = 'none';
    const btnReq = document.getElementById('btn-requeue-selected');
    if (btnReq) btnReq.style.display = 'none';
    if(document.getElementById('selectAllPo')) document.getElementById('selectAllPo').checked = false;
    if(document.getElementById('selectAllAdv')) document.getElementById('selectAllAdv').checked = false;
    await loadEntries();
  } catch (err) {
    showToast('Requeue Failed: ' + err.message, 'error');
  }
};

window.deleteSelected = async function() {
  const checked = document.querySelectorAll('.row-checkbox:checked');
  if (checked.length === 0) return;
  if (!confirm(`Permanently delete ${checked.length} selected records?`)) return;
  const ids = Array.from(checked).map(cb => cb.value);
  try {
    const { error } = await supabaseClient.from('entries').delete().in('id', ids);
    if (error) throw error;
    showToast(`Deleted ${ids.length} records!`, 'success');
    document.getElementById('btn-delete-selected').style.display = 'none';
    const btnReq = document.getElementById('btn-requeue-selected');
    if (btnReq) btnReq.style.display = 'none';
    if(document.getElementById('selectAllPo')) document.getElementById('selectAllPo').checked = false;
    if(document.getElementById('selectAllAdv')) document.getElementById('selectAllAdv').checked = false;
    await loadEntries();
  } catch (err) {
    showToast('Delete Failed: ' + err.message, 'error');
  }
};

async function autoPurgeOldRecords() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  try {
    await supabaseClient.from('entries').delete().lt('po_date', thirtyDaysAgo.toISOString().split('T')[0]);
  } catch (e) { console.log('Auto Purge passed'); }
}

// CC TAGS
function renderCcTags() {
  const list = document.getElementById('cc-tags-list');
  list.innerHTML = ccEmailsArray.map((e, i) => `
    <div class="tag">${e} <i data-lucide="x" onclick="removeCcTag(${i})" style="width:12px;"></i></div>
  `).join('');
  lucide.createIcons();
}

window.addCcFromInput = function () {
  const input = document.getElementById('new-cc-input');
  const email = input.value.trim();
  if (email && email.includes('@') && !ccEmailsArray.includes(email)) {
    ccEmailsArray.push(email);
    input.value = '';
    renderCcTags();
    updateSettings();
  }
};

window.removeCcTag = function (i) {
  ccEmailsArray.splice(i, 1);
  renderCcTags();
  updateSettings();
};

// LOGIC
function calculate() {
  const amt = getNum('amount');
  const rates = { 
    'SAR': 1, 'USD': 3.75, 'EUR': 4.10, 'GBP': 4.80, 
    'AED': 1.02, 'BHD': 9.95, 'KWD': 12.20, 'OMR': 9.75, 'QAR': 1.03, 'CNY': 0.52 
  };
  const sar = amt * (rates[currencySelect.value] || 1);
  amountSarInput.value = sar.toFixed(2);

  if (approvalTypeSelect.value === 'Advance Approval') {
    advanceFields.style.display = 'grid';
    const p = (getVal('advance-percent') === 'custom') ? getNum('custom-percent') : getNum('advance-percent');
    advanceAmountInput.value = (sar * p / 100).toFixed(2);
    
    const advCurEl = document.getElementById('advance-amount-cur');
    if (advCurEl) {
      advCurEl.value = (amt * p / 100).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' ' + currencySelect.value;
    }
  } else {
    advanceFields.style.display = 'none';
    advanceAmountInput.value = 0;
    const advCurEl = document.getElementById('advance-amount-cur');
    if (advCurEl) advCurEl.value = '';
  }
}

async function sendEmailToManager(isScheduled = false) {
  const pending = entries.filter(i => !i.is_sent);
  if (pending.length === 0) {
    if (!isScheduled) showToast('No pending items to send', 'info');
    return;
  }

  // Prevent multiple tabs from firing at the exact same minute during auto-send
  if (isScheduled) {
    const lockTime = localStorage.getItem('last_auto_send_lock');
    const nowTime = new Date().getTime();
    // If it dispatched within the last 2 minutes, ignore to prevent duplicate tab sends
    if (lockTime && (nowTime - parseInt(lockTime) < 120000)) {
      return; 
    }
    localStorage.setItem('last_auto_send_lock', nowTime.toString());
  }

  isSendingNow = true;

  try {
    if (!managerEmail) throw new Error('Manager email not set');
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      throw new Error('EmailJS keys missing! Please configure them in Settings.');
    }

    // To prevent multi-device race conditions, mark as sent in DB first.
    // We ignore the .select() return because Supabase RLS often hides mutated rows.
    const idsToUpdate = pending.map(i => i.id);
    const { error: updateError } = await supabaseClient
      .from('entries')
      .update({ is_sent: true })
      .in('id', idsToUpdate)
      .eq('is_sent', false);

    if (updateError) throw updateError;

    const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const emailSubject = `GM Procurement Approval Request - ${todayStr}`;

    const pos = pending.filter(i => i.advanceAmount === 0);
    const advsMapped = pending.filter(i => i.advanceAmount > 0);

    let poH = pos.length ? `<h3 style="color:#1e293b; font-family:sans-serif;">📅 SAP PO require approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;background-color:#ffffff;border-color:#e2e8f0;color:#334155;">
      <tr style="background-color:#f8fafc;color:#0f172a;"><th>Supplier No.</th><th>Vendor Name</th><th>PO number</th><th>Description</th><th>PO amount</th><th>PO Currency</th><th>Amount (SAR)</th><th>Remarks</th></tr>` : "";
    pos.forEach(e => {
      const { suppNo, vendorName } = extractSupplier(e.supplier);
      poH += `<tr><td>${suppNo || '-'}</td><td>${vendorName}</td><td>${e.po || '-'}</td><td>${e.description ? e.description : '-'}</td><td>${(e.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td><td>${e.currency || '-'}</td><td><b style="color:#2563eb;">${(e.amountSar || 0).toLocaleString()}</b></td><td>${e.notes ? e.notes : '-'}</td></tr>`;
    });
    if (pos.length) poH += "</table>";

    let advH = advsMapped.length ? `<h3 style="color:#1e293b; font-family:sans-serif;">💰 SAP PO advances require Approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;background-color:#ffffff;border-color:#e2e8f0;color:#334155;">
      <tr style="background-color:#f8fafc;color:#0f172a;"><th>Supplier No.</th><th>Vendor Name</th><th>PO number</th><th>Description</th><th>PO amount</th><th>PO Currency</th><th>Advance amount in PO Currency</th><th>Advance amount in SAR</th><th>Remarks</th></tr>` : "";
    advsMapped.forEach(e => {
      const { suppNo, vendorName } = extractSupplier(e.supplier);
      const advCur = (((e.amount || 0) * (e.advancePercent || 0)) / 100);
      advH += `<tr><td>${suppNo || '-'}</td><td>${vendorName}</td><td>${e.po || '-'}</td><td>${e.description ? e.description : '-'}</td><td>${(e.amount || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td><td>${e.currency || '-'}</td><td><b>${advCur.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</b></td><td><b style="color:#d97706;">${(e.advanceAmount || 0).toLocaleString()}</b></td><td>${e.notes ? e.notes : '-'}</td></tr>`;
    });
    if (advsMapped.length) advH += "</table>";

    const totalPoSum = pos.reduce((sum, i) => sum + (i.amountSar || 0), 0);
    const totalAdvSum = advsMapped.reduce((sum, i) => sum + (i.advanceAmount || 0), 0);
    const grandTotal = totalPoSum + totalAdvSum;

    // Send via EmailJS using the exact variable names expected in the template
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      subject_line: emailSubject,
      to_email: managerEmail,
      cc_email: ccEmailsArray.join(', '),
      po_table: poH,
      adv_table: advH,
      summary_count: pending.length,
      po_count: pos.length,
      adv_count: advsMapped.length,
      total_po_sar: totalPoSum.toLocaleString(),
      total_adv_sar: totalAdvSum.toLocaleString(),
      total_sar: grandTotal.toLocaleString()
    }, EMAILJS_PUBLIC_KEY);

    showToast('Dispatch Successful: Email Sent & Records Updated', 'success');
  } catch (err) {
    console.error('Email error:', err);
    
    // Rollback if email failed to send
    if (pending && pending.length > 0) {
      await supabaseClient.from('entries').update({ is_sent: false }).in('id', pending.map(i => i.id));
    }
    
    // EmailJS Custom error parsing
    const errMsg = err.text || err.message || (typeof err === 'string' ? err : 'Unknown Error');
    showToast('Dispatch Failed: ' + errMsg, 'error');
  } finally {
    isSendingNow = false;
  }
}

async function checkSchedule() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (timeStr === dailySendTime && !isSendingNow && entries.some(e => !e.is_sent)) await sendEmailToManager(true);
}

function subscribeToChanges() {
  supabaseClient.channel('custom-all-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => {
    loadEntries();
  }).subscribe();
}

// EXPORT TO EXCEL (Native XML Multi-Sheet - No External Libraries)
function exportToExcel() {
  if (entries.length === 0) return showToast('No entries to export', 'info');

  const pos = entries.filter(e => e.advanceAmount === 0 || !e.advanceAmount);
  const advs = entries.filter(e => e.advanceAmount > 0);

  const getXmlRow = (cells) => `<Row>${cells.map(c => `<Cell><Data ss:Type="${typeof c === 'number' ? 'Number' : 'String'}">${String(c).replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','\'':'&apos;','"':'&quot;'}[c]))}</Data></Cell>`).join('')}</Row>`;

  const poHeaders = ["Date", "Description", "Category", "PR/SO #", "WO/SO #", "PO #", "Supplier", "Amount", "Currency", "Amount (SAR)", "Notes", "Status"];
  const advHeaders = ["Date", "Description", "Category", "PR/SO #", "WO/SO #", "PO #", "Supplier", "Amount (Orig)", "Currency", "Adv %", "Adv (Cur)", "Adv (SAR)", "Notes", "Status"];

  let xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">`;
  
  // Sheet 1: PO Approvals
  xml += `<Worksheet ss:Name="PO Approvals"><Table>${getXmlRow(poHeaders)}`;
  pos.forEach(e => {
    xml += getXmlRow([e.date, e.description||'', e.category||'', e.prSo||'', e.woSo||'', e.po||'', e.supplier||'', e.amount, e.currency, e.amountSar, e.notes||'', e.is_sent?'SENT':'Pending']);
  });
  xml += `</Table></Worksheet>`;

  // Sheet 2: Advances
  xml += `<Worksheet ss:Name="Advances"><Table>${getXmlRow(advHeaders)}`;
  advs.forEach(e => {
    xml += getXmlRow([e.date, e.description||'', e.category||'', e.prSo||'', e.woSo||'', e.po||'', e.supplier||'', e.amount, e.currency, e.advancePercent, (e.amount * e.advancePercent / 100), e.advanceAmount, e.notes||'', e.is_sent?'SENT':'Pending']);
  });
  xml += `</Table></Worksheet></Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const dateStr = new Date().toLocaleDateString('en-GB').replace(/\//g, '-');
  link.setAttribute("download", `Approval_System_Export_${dateStr}.xls`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// SUPPLIER AUTO-COMPLETE & MEMORY
function updateSupplierList() {
  const datalist = document.getElementById('supplier-list');
  if (!datalist) return;
  const forgotten = JSON.parse(localStorage.getItem('forgotten_suppliers') || '[]');
  const uniqueSuppliers = [...new Set(entries.map(e => e.supplier).filter(Boolean))]
    .filter(s => !forgotten.includes(s))
    .sort();
  datalist.innerHTML = uniqueSuppliers.map(s => `<option value="${s}">`).join('');
}

function removeSupplierFromMemory() {
  const current = document.getElementById('supplier').value.trim();
  if (!current) return showToast('Type a supplier name to remove it from memory', 'info');
  
  if (confirm(`Remove "${current}" from memory? It will no longer show up in suggestions.`)) {
    const forgotten = JSON.parse(localStorage.getItem('forgotten_suppliers') || '[]');
    if (!forgotten.includes(current)) {
      forgotten.push(current);
      localStorage.setItem('forgotten_suppliers', JSON.stringify(forgotten));
    }
    updateSupplierList();
    showToast(`"${current}" removed from suggestions`, 'success');
    document.getElementById('supplier').value = '';
  }
}

// THEME LOGIC
function initTheme() {
  const saved = localStorage.getItem('theme_preference') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.setAttribute('data-lucide', saved === 'dark' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', target);
  localStorage.setItem('theme_preference', target);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.setAttribute('data-lucide', target === 'dark' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }
}

// LISTENERS
approvalForm.addEventListener('submit', createEntry);
amountInput.addEventListener('input', calculate);
currencySelect.addEventListener('change', calculate);
approvalTypeSelect.addEventListener('change', calculate);
advancePercentSelect.addEventListener('change', () => {
  customPercentGroup.style.display = (advancePercentSelect.value === 'custom') ? 'block' : 'none';
  calculate();
});
customPercentInput.addEventListener('input', calculate);
btnSettings.addEventListener('click', () => settingsModal.classList.add('active'));
btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
btnSaveSettings.addEventListener('click', updateSettings);
btnFinalize.addEventListener('click', () => sendEmailToManager(false));
btnCancelEdit.addEventListener('click', cancelEdit);
inputManagerEmail.addEventListener('change', updateSettings);
document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);
btnActivateSetup.addEventListener('click', activateDashboard);
const exportBtn = document.getElementById('btn-export');
if (exportBtn) exportBtn.addEventListener('click', exportToExcel);
const removeSupplierBtn = document.getElementById('btn-remove-supplier');
if (removeSupplierBtn) removeSupplierBtn.addEventListener('click', removeSupplierFromMemory);
const btnCloseWeeklyAdvances = document.getElementById('btn-close-weekly-advances');
if (btnCloseWeeklyAdvances) btnCloseWeeklyAdvances.addEventListener('click', () => document.getElementById('weekly-advances-modal').classList.remove('active'));

// START
init();
