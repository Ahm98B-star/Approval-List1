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
    setInterval(checkSchedule, 60000); // Check every minute
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

  if (poTbody) poTbody.innerHTML = pos.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
      <td>${e.date}</td>
      <td title="${e.description || ''}">${e.description || '-'}</td>
      <td><span class="badge" style="background:rgba(255,255,255,0.1);">${e.category || '-'}</span></td>
      <td>${e.prSo || '-'}</td>
      <td>${e.woSo || '-'}</td>
      <td>${e.po || '-'}</td>
      <td>${e.supplier || '-'}</td>
      <td>${(e.amountSar || 0).toLocaleString()}</td>
      <td>${e.notes || '-'}</td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td>
        ${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px; margin-right:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}
        <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
      </td>
    </tr>
  `).join('');

  if (advanceTbody) advanceTbody.innerHTML = advs.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td><input type="checkbox" class="row-checkbox" value="${e.id}" onchange="updateDeleteSelectButton()"></td>
      <td>${e.date}</td>
      <td title="${e.description || ''}">${e.description || '-'}</td>
      <td><span class="badge" style="background:rgba(255,255,255,0.1);">${e.category || '-'}</span></td>
      <td>${e.prSo || '-'}</td>
      <td>${e.woSo || '-'}</td>
      <td>${e.po || '-'}</td>
      <td>${e.supplier || '-'}</td>
      <td>${(e.advanceAmount || 0).toLocaleString()}</td>
      <td>${e.notes ? 'Yes' : '-'}</td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td>
        ${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px; margin-right:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}
        <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
      </td>
    </tr>
  `).join('');

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
  const btnDel = document.getElementById('btn-delete-selected');
  const countSpanDel = document.getElementById('selected-count');
  const btnReq = document.getElementById('btn-requeue-selected');
  const countSpanReq = document.getElementById('requeue-count');

  if (checked.length > 0) {
    if (countSpanDel) countSpanDel.textContent = checked.length;
    if (btnDel) btnDel.style.display = 'inline-flex';
    if (countSpanReq) countSpanReq.textContent = checked.length;
    if (btnReq) btnReq.style.display = 'inline-flex';
  } else {
    if (btnDel) btnDel.style.display = 'none';
    if (btnReq) btnReq.style.display = 'none';
  }
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
  } else {
    advanceFields.style.display = 'none';
    advanceAmountInput.value = 0;
  }
}

async function sendEmailToManager(isScheduled = false) {
  const pending = entries.filter(i => !i.is_sent);
  if (pending.length === 0) {
    if (!isScheduled) showToast('No pending items to send', 'info');
    return;
  }

  // Prevent multiple tabs from firing at the exact same minute
  if (isScheduled) {
    const todayStr = new Date().toLocaleDateString();
    const lastSentDate = localStorage.getItem('last_auto_send_date');
    if (lastSentDate === todayStr) {
      return; // Already sent today automatically
    }
    localStorage.setItem('last_auto_send_date', todayStr);
  }

  isSendingNow = true;

  try {
    if (!managerEmail) throw new Error('Manager email not set');
    if (!EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID || !EMAILJS_PUBLIC_KEY) {
      throw new Error('EmailJS keys missing! Please configure them in Settings.');
    }

    // Concurrency Check: Mark as sent in DB first to prevent other users from sending the same records
    const idsToUpdate = pending.map(i => i.id);
    const { data: updatedRecords, error: updateError } = await supabaseClient
      .from('entries')
      .update({ is_sent: true })
      .in('id', idsToUpdate)
      .eq('is_sent', false)
      .select();

    if (updateError) throw updateError;

    // If another device already sent them, updatedRecords will be empty
    if (!updatedRecords || updatedRecords.length === 0) {
      if (!isScheduled) showToast('Items were already sent by another device.', 'info');
      isSendingNow = false;
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
    const emailSubject = `GM Procurement Approval Request - ${todayStr}`;

    const pos = pending.filter(i => i.advanceAmount === 0);
    const advs = pending.filter(i => i.advanceAmount > 0);

    let poH = pos.length ? `<h3 style="color:#1e293b; font-family:sans-serif;">📅 PO require approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;background-color:#ffffff;border-color:#e2e8f0;color:#334155;">
      <tr style="background-color:#f8fafc;color:#0f172a;"><th>Date</th><th>Description</th><th>Category</th><th>PR/SO #</th><th>WO/SO #</th><th>PO #</th><th>Supplier</th><th>Original</th><th>Cur</th><th>Amount (SAR)</th><th>Notes</th></tr>` : "";
    pos.forEach(e => poH += `<tr><td>${e.date}</td><td>${e.description || '-'}</td><td>${e.category}</td><td>${e.prSo || '-'}</td><td>${e.woSo || '-'}</td><td>${e.po}</td><td>${e.supplier}</td><td>${(e.amount || 0).toLocaleString()}</td><td>${e.currency}</td><td><b style="color:#2563eb;">${(e.amountSar || 0).toLocaleString()}</b></td><td>${e.notes ? e.notes : '-'}</td></tr>`);
    if (pos.length) poH += "</table>";

    let advH = advs.length ? `<h3 style="color:#1e293b; font-family:sans-serif;">💰 PO advances require Approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:12px;font-family:sans-serif;background-color:#ffffff;border-color:#e2e8f0;color:#334155;">
      <tr style="background-color:#f8fafc;color:#0f172a;"><th>Date</th><th>Description</th><th>Category</th><th>PR/SO #</th><th>WO/SO #</th><th>PO #</th><th>Supplier</th><th>Full (SAR)</th><th>Adv %</th><th>Adv (SAR)</th><th>Notes</th></tr>` : "";
    advs.forEach(e => advH += `<tr><td>${e.date}</td><td>${e.description || '-'}</td><td>${e.category}</td><td>${e.prSo || '-'}</td><td>${e.woSo || '-'}</td><td>${e.po}</td><td>${e.supplier}</td><td>${(e.amountSar || 0).toLocaleString()}</td><td>${e.advancePercent}%</td><td><b style="color:#d97706;">${(e.advanceAmount || 0).toLocaleString()}</b></td><td>${e.notes ? e.notes : '-'}</td></tr>`);
    if (advs.length) advH += "</table>";

    const totalPoSum = pos.reduce((sum, i) => sum + (i.amountSar || 0), 0);
    const totalAdvSum = advs.reduce((sum, i) => sum + (i.advanceAmount || 0), 0);
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
      adv_count: advs.length,
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

// START
init();
