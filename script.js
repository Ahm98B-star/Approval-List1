// CONFIGURATION
const SUPABASE_URL = 'https://oigjdfdfovmxfjsvpplv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pZ2pkZmRmb3ZteGZqc3ZwcGx2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDIwNDU3MDUsImV4cCI6MjA1NzYyMTcwNX0.J_gXGvQYmO9Y8T6eR0t1-N-a7T7L4H6Y1z7q8v9p';
const EMAILJS_SERVICE_ID = 'service_pz1v6gq';
const EMAILJS_TEMPLATE_ID = 'template_t156fbg';
const EMAILJS_PUBLIC_KEY = 'iOabUF7I4IR2pyt6q';

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
const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
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
  try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    if (typeof emailjs !== 'undefined') emailjs.init(EMAILJS_PUBLIC_KEY);
    
    lucide.createIcons();
    poDateSpan.textContent = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    await loadSettings();
    await loadEntries();
    subscribeToChanges();
    initTheme();
    calculate();
    setInterval(checkSchedule, 60000); // Check every minute
  } catch (err) {
    showToast('Initialization Error: Check Database Key', 'error');
  }
}

// DATABASE LOGIC
async function loadSettings() {
  const { data } = await supabaseClient.from('settings').select('*');
  if (data) {
    const sTime = data.find(i => i.key === 'send_time');
    const sEmail = data.find(i => i.key === 'manager_email');
    const sCC = data.find(i => i.key === 'cc_emails');
    
    if (sTime) { dailySendTime = sTime.value; inputSendTime.value = dailySendTime; }
    if (sEmail) { managerEmail = sEmail.value; inputManagerEmail.value = managerEmail; }
    if (sCC) { 
      ccEmailsArray = sCC.value ? sCC.value.split(',').map(e => e.trim()).filter(e=>e) : [];
      renderCcTags();
    }
  }
}

async function updateSettings() {
  const newTime = inputSendTime.value;
  const newEmail = inputManagerEmail.value.trim();
  const newCC = ccEmailsArray.join(',');

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
  if (error) return showToast('Load Failed', 'error');
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
    is_sent: i.is_sent,
    status: i.status || 'Pending'
  }));
  renderDashboard();
}

async function createEntry(e) {
  if (e) e.preventDefault();
  
  const entryData = {
    approval_type: getVal('approval-type') || 'PO Approval',
    pr_so_number: getVal('pr-so-number'),
    po_number: getVal('po-number'),
    wo_so_number: getVal('wo-so-number'),
    description: getVal('description'),
    category: getVal('category'),
    supplier: getVal('supplier'),
    amount: getNum('amount'),
    currency: getVal('currency'),
    amount_sar: getNum('amount-sar'),
    advance_percent: (getVal('advance-percent') === 'custom' ? getNum('custom-percent') : getNum('advance-percent')),
    advance_amount: getNum('advance-amount'),
    notes: getVal('notes'),
    po_date: poDateSpan.textContent,
    is_sent: false,
    status: 'Pending'
  };

  try {
    const { error } = editMode 
      ? await supabaseClient.from('entries').update(entryData).eq('id', currentEditingId)
      : await supabaseClient.from('entries').insert([entryData]);

    if (error) throw error;
    showToast(editMode ? 'Success!' : 'Logged!', 'success');
    approvalForm.reset();
    cancelEdit();
    calculate();
    await loadEntries();
  } catch (err) { showToast('Error: ' + err.message, 'error'); }
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
  const pos = entries.filter(i => (i.advanceAmount === 0 || !i.advanceAmount));
  const advs = entries.filter(i => i.advanceAmount > 0);

  if (poTbody) poTbody.innerHTML = pos.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
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
        ${!e.is_sent ? `
          <button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>
          <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  if (advanceTbody) advanceTbody.innerHTML = advs.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
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
        ${!e.is_sent ? `
          <button onclick="startEdit('${e.id}')" class="btn btn-outline" style="padding:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>
          <button onclick="deleteEntry('${e.id}')" class="btn btn-danger" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>
        ` : ''}
      </td>
    </tr>
  `).join('');
  
  lucide.createIcons();
}

// CC TAGS
function renderCcTags() {
  const list = document.getElementById('cc-tags-list');
  list.innerHTML = ccEmailsArray.map((e, i) => `
    <div class="tag">${e} <i data-lucide="x" onclick="removeCcTag(${i})" style="width:12px;"></i></div>
  `).join('');
  lucide.createIcons();
}

window.addCcFromInput = function() {
  const input = document.getElementById('new-cc-input');
  const email = input.value.trim();
  if (email && email.includes('@') && !ccEmailsArray.includes(email)) {
    ccEmailsArray.push(email);
    input.value = '';
    renderCcTags();
    updateSettings();
  }
};

window.removeCcTag = function(i) {
  ccEmailsArray.splice(i, 1);
  renderCcTags();
  updateSettings();
};

// LOGIC
function calculate() {
  const amt = getNum('amount');
  const rates = { 'SAR': 1, 'USD': 3.75, 'EUR': 4.10, 'GBP': 4.80 };
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

async function sendEmailToManager(isTest = false) {
  const pending = entries.filter(e => !e.is_sent);
  if (pending.length === 0) return showToast('Nothing to send!', 'warning');
  
  if (!managerEmail) return showToast('Set Manager Email first', 'error');

  const btn = isTest ? null : btnFinalize;
  const original = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Sending...'; lucide.createIcons(); }

  try {
    const pos = pending.filter(i => (i.advanceAmount === 0 || !i.advanceAmount));
    const advs = pending.filter(i => i.advanceAmount > 0);

    let poH = pos.length ? `<h3 style="color:#1e293b;">📅 PO require approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:10px;background-color:#ffffff;">
      <tr style="background-color:#f8fafc;"><th>Date</th><th>Description</th><th>Category</th><th>PR/SO #</th><th>WO/SO #</th><th>PO #</th><th>Supplier</th><th>Original</th><th>Cur</th><th>Amount (⃁)</th></tr>` : "";
    pos.forEach(e => poH += `<tr><td>${e.date}</td><td>${e.description || '-'}</td><td>${e.category || '-'}</td><td>${e.prSo || '-'}</td><td>${e.woSo || '-'}</td><td>${e.po || '-'}</td><td>${e.supplier || '-'}</td><td>${(e.amount || 0).toLocaleString()}</td><td>${e.currency}</td><td><b>${(e.amountSar || 0).toLocaleString()}</b></td></tr>`);
    if(pos.length) poH += "</table>";

    let advH = advs.length ? `<h3 style="color:#1e293b;">💰 PO advances require Approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:10px;background-color:#ffffff;">
      <tr style="background-color:#f8fafc;"><th>Date</th><th>Description</th><th>Category</th><th>PR/SO #</th><th>WO/SO #</th><th>PO #</th><th>Supplier</th><th>Full (⃁)</th><th>Adv %</th><th>Adv (⃁)</th></tr>` : "";
    advs.forEach(e => advH += `<tr><td>${e.date}</td><td>${e.description || '-'}</td><td>${e.category || '-'}</td><td>${e.prSo || '-'}</td><td>${e.woSo || '-'}</td><td>${e.po || '-'}</td><td>${e.supplier || '-'}</td><td>${(e.amountSar || 0).toLocaleString()}</td><td>${e.advancePercent}%</td><td><b>${(e.advanceAmount || 0).toLocaleString()}</b></td></tr>`);
    if(advs.length) advH += "</table>";

    const totalPoSum = pos.reduce((a, b) => a + (b.amountSar || 0), 0);
    const totalAdvSum = advs.reduce((a, b) => a + (b.advanceAmount || 0), 0);
    const grandTotal = totalPoSum + totalAdvSum;
    
    const todayStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const emailSubject = "GM Procurement Approval Request - " + todayStr;

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      subject_line: emailSubject,
      to_email: managerEmail,
      cc_email: ccEmailsArray.join(', '),
      po_table: poH,
      adv_table: advH,
      summary_count: pending.length,
      total_po_sar: totalPoSum.toLocaleString(),
      total_adv_sar: totalAdvSum.toLocaleString(),
      total_sar: grandTotal.toLocaleString()
    });

    if (!isTest) {
      await supabaseClient.from('entries').update({ is_sent: true }).in('id', pending.map(e => e.id));
      await loadEntries();
      document.getElementById('success-modal').classList.add('active');
    }
    showToast('Sent!', 'success');
  } catch (err) { 
    console.error(err);
    showToast('Failed: Check API Settings', 'error'); 
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; lucide.createIcons(); }
  }
}

async function checkSchedule() {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (timeStr === dailySendTime && !isSendingNow && entries.some(e=>!e.is_sent)) await sendEmailToManager();
}

function subscribeToChanges() {
  supabaseClient.channel('custom-all-channel').on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, () => {
    loadEntries();
  }).subscribe();
}

// THEME LOGIC
function initTheme() {
  const saved = localStorage.getItem('theme_preference') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
  const icon = document.getElementById('theme-icon');
  if (icon) {
    icon.setAttribute('data-lucide', saved === 'dark' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
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

// START
init();
