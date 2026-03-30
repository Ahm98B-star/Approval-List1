// State Management
let entries = [];
let suppliers = JSON.parse(localStorage.getItem('approval_suppliers')) || [];
let currentTheme = localStorage.getItem('approval_theme') || 'dark';

// --- SUPABASE CONFIGURATION ---
const SUPABASE_URL = 'https://gwrkdhhghuynowmqzwxp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5mcdvM_jJDmxncG4Gr2LDw_3Q2ReD4D';

let supabaseClient;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error("Supabase Initialization Error:", e);
}

// --- EMAILJS CONFIGURATION ---
const EMAILJS_PUBLIC_KEY = 'iOabUF7I4IR2pyt6q';
const EMAILJS_SERVICE_ID = 'service_pz1v6gq';
const EMAILJS_TEMPLATE_ID = 'template_t156fbg';

if (typeof emailjs !== 'undefined') {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

// Configuration (Approximate rates to SAR - Updated for 2026)
const exchangeRates = {
  SAR: 1, USD: 3.75, EUR: 4.02, GBP: 4.75, AED: 1.02, QAR: 1.03, KWD: 12.20, BHD: 9.95, OMR: 9.74,
  JPY: 0.025, CNY: 0.52, INR: 0.045, EGP: 0.078, JOD: 5.29, PKR: 0.013, THB: 0.10, TRY: 0.11,
  IDR: 0.00024, MYR: 0.81, VND: 0.00015, PHP: 0.067, KRW: 0.0028, CHF: 4.25, CAD: 2.75,
  AUD: 2.45, NZD: 2.25, SEK: 0.35, NOK: 0.34, DKK: 0.54, SGD: 2.80, HKD: 0.48, MXN: 0.22,
  BRL: 0.75, ZAR: 0.20, RUB: 0.041, ILS: 1.01, TWD: 0.12, CZK: 0.16, HUF: 0.010, PLN: 0.94, LBP: 0.00004
};

// UI Elements
const poDateSpan = document.getElementById('po-date');
const dateInput = document.getElementById('date-input');
const approvalTypeSelect = document.getElementById('approval-type');
const advanceFields = document.getElementById('advance-fields');
const amountInput = document.getElementById('amount');
const currencySelect = document.getElementById('currency');
const amountSarInput = document.getElementById('amount-sar');
const advancePercentSelect = document.getElementById('advance-percent');
const customPercentGroup = document.getElementById('custom-percent-group');
const customPercentInput = document.getElementById('custom-percent');
const advanceAmountInput = document.getElementById('advance-amount');
const supplierInput = document.getElementById('supplier');
const supplierDatalist = document.getElementById('supplier-list');
const poNumberInput = document.getElementById('po-number');
const prSoInput = document.getElementById('pr-so-number');
const notesInput = document.getElementById('notes');
const entryForm = document.getElementById('entry-form');
const poTbody = document.getElementById('po-tbody');
const advanceTbody = document.getElementById('advance-tbody');
const btnExport = document.getElementById('btn-export');
const btnFinalize = document.getElementById('btn-finalize');
const themeToggle = document.getElementById('theme-toggle');

// New Scheduled Elements
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const btnTestSend = document.getElementById('btn-test-send');
const inputSendTime = document.getElementById('input-send-time');
const displaySendTime = document.getElementById('display-send-time');
const inputManagerEmail = document.getElementById('input-manager-email');
const toggleHistory = document.getElementById('toggle-history');

// App State
let dailySendTime = '14:00';
let managerEmail = 'a.bazuhair@amco-saudi.com';
let ccEmails = '';
let ccEmailsArray = [];
let isSendingNow = false;
let showHistory = false;
let editMode = false;
let currentEditingId = null;

// Core Functions
async function init() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons();

  const today = new Date().toISOString().split('T')[0];
  if (!dateInput.value) {
    poDateSpan.textContent = today;
    dateInput.value = today;
  }

  await loadSettings();
  await loadEntries();
  updateSupplierDatalist();
  subscribeToChanges();

  // Start the background timer (checks every 60 seconds)
  setInterval(checkSchedule, 60000);

  // Bind CC Tag Events
  const btnAddCc = document.getElementById('btn-add-cc');
  const newCcInput = document.getElementById('new-cc-input');
  if (btnAddCc) btnAddCc.addEventListener('click', addCcFromInput);
  if (newCcInput) newCcInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCcFromInput();
    }
  });
}

// Edit Logic
function startEdit(id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) return;

  editMode = true;
  currentEditingId = id;
  
  // Fill Form
  if (poDateSpan) poDateSpan.textContent = entry.date;
  if (dateInput) dateInput.value = entry.date;
  if (approvalTypeSelect) {
    approvalTypeSelect.value = entry.type;
    advanceFields.style.display = (entry.type === 'Advance Approval') ? 'grid' : 'none';
  }
  if (prSoInput) prSoInput.value = entry.prSo;
  if (poNumberInput) poNumberInput.value = entry.po;
  if (supplierInput) supplierInput.value = entry.supplier;
  if (amountInput) amountInput.value = entry.amount;
  if (currencySelect) currencySelect.value = entry.currency;
  if (notesInput) notesInput.value = entry.notes || '';

  if (entry.type === 'Advance Approval' && advancePercentSelect) {
    const isPredefined = ['10', '20', '30', '50', '100'].includes(String(entry.advancePercent));
    if (isPredefined) {
      advancePercentSelect.value = entry.advancePercent;
      customPercentGroup.style.display = 'none';
    } else {
      advancePercentSelect.value = 'custom';
      customPercentGroup.style.display = 'block';
      if (customPercentInput) customPercentInput.value = entry.advancePercent;
    }
  }

  // Update UI
  const logBtn = document.getElementById('btn-log-entry');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (logBtn) {
    logBtn.innerHTML = '<i data-lucide="save"></i> Update Entry Details';
    logBtn.classList.remove('btn-primary');
    logBtn.classList.add('btn-finalize');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  if (cancelBtn) cancelBtn.style.display = 'block';
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelEdit() {
  editMode = false;
  currentEditingId = null;
  entryForm.reset();
  
  const logBtn = document.getElementById('btn-log-entry');
  const cancelBtn = document.getElementById('btn-cancel-edit');
  if (logBtn) {
    logBtn.innerHTML = '<i data-lucide="plus-circle"></i> Log Entry into Team Database';
    logBtn.classList.add('btn-primary');
    logBtn.classList.remove('btn-finalize');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  calculate();
}

// Add Cancel Event Listener in Init or global
document.addEventListener('DOMContentLoaded', () => {
    const cancelBtn = document.getElementById('btn-cancel-edit');
    if (cancelBtn) cancelBtn.addEventListener('click', cancelEdit);
});

// CC Tag UI Logic
function renderCcTags() {
  const container = document.getElementById('cc-tags-container');
  const input = document.getElementById('new-cc-input');
  const btn = document.getElementById('btn-add-cc');
  if (!container) return;

  // Clear everything except input and button
  const currentTags = container.querySelectorAll('.cc-tag');
  currentTags.forEach(tag => tag.remove());

  ccEmailsArray.forEach((email, index) => {
    const tag = document.createElement('div');
    tag.className = 'cc-tag';
    tag.innerHTML = `
      <span>${email}</span>
      <span class="remove-btn" onclick="removeCcTag(${index})">
        <i data-lucide="x" style="width: 14px; height: 14px;"></i>
      </span>
    `;
    container.insertBefore(tag, input);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function addCcFromInput() {
  const input = document.getElementById('new-cc-input');
  const email = input.value.trim();
  if (email && email.includes('@') && !ccEmailsArray.includes(email)) {
    ccEmailsArray.push(email);
    input.value = '';
    renderCcTags();
    updateSettings(); // Auto-save on add
  }
}

function removeCcTag(index) {
  ccEmailsArray.splice(index, 1);
  renderCcTags();
  updateSettings(); // Auto-save on remove
}

// Settings Logic
async function loadSettings() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('settings')
      .select('key, value');

    if (data) {
      data.forEach(s => {
        if (s.key === 'daily_send_time') {
          dailySendTime = s.value;
          if (inputSendTime) inputSendTime.value = dailySendTime;
          if (displaySendTime) displaySendTime.textContent = format12h(dailySendTime);
        }
        if (s.key === 'manager_email') {
          managerEmail = s.value;
          if (inputManagerEmail) inputManagerEmail.value = managerEmail;
        }
        if (s.key === 'cc_emails') {
          ccEmails = s.value;
          ccEmailsArray = ccEmails ? ccEmails.split(',').map(e => e.trim()).filter(e => e) : [];
          renderCcTags();
        }
      });
    }
  } catch (e) { console.error('Settings load error:', e); }
}

async function updateSettings() {
  const newTime = inputSendTime ? inputSendTime.value : dailySendTime;
  const newEmail = inputManagerEmail ? inputManagerEmail.value.trim() : managerEmail;
  const newCC = ccEmailsArray.join(',');
  
  if (!newTime || !newEmail) return;
  
  try {
    // Show a smaller toast for auto-saves
    await supabaseClient
      .from('settings')
      .upsert([
        { key: 'daily_send_time', value: newTime },
        { key: 'manager_email', value: newEmail },
        { key: 'cc_emails', value: newCC }
      ], { onConflict: 'key' });
    
    dailySendTime = newTime;
    managerEmail = newEmail;
    ccEmails = newCC;
    if (displaySendTime) displaySendTime.textContent = format12h(newTime);
    // Don't close modal if it's an auto-save from the dashboard
    if (settingsModal && settingsModal.classList.contains('active')) {
       settingsModal.classList.remove('active');
       showToast('Settings saved successfully!', 'success');
    }
  } catch (e) { 
    console.error('Settings Update Error:', e);
  }
}

function format12h(time24) {
  if (!time24) return '2:00 PM';
  const [h, m] = time24.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

// Scheduling Logic
async function checkSchedule() {
  const now = new Date();
  const current24h = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  if (current24h === dailySendTime && !isSendingNow && entries.length > 0) {
    console.log('Auto-send triggered!');
    await sendEmailToManager(false); // Automated send
  }
}

// Real-time Subscription
function subscribeToChanges() {
  if (!supabaseClient) return;
  supabaseClient
    .channel('schema-db-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, (payload) => {
      loadEntries();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'settings' }, (payload) => {
      loadSettings();
    })
    .subscribe();
}

// Load Entries (Supabase)
async function loadEntries() {
  if (!supabaseClient) return;
  try {
    let query = supabaseClient.from('entries').select('*');
    if (!showHistory) {
      query = query.eq('is_sent', false);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;

    entries = data.map(item => ({
      id: item.id,
      date: item.po_date || '',
      type: item.approval_type,
      prSo: item.pr_so_number,
      po: item.po_number,
      supplier: item.supplier,
      amount: item.amount,
      currency: item.currency,
      amountSar: item.amount_sar,
      advancePercent: item.advance_percent || 0,
      advanceAmount: item.advance_amount || 0,
      advanceAmountOriginal: item.advance_amount_original || 0,
      notes: item.notes,
      status: item.status,
      timestamp: item.created_at,
      is_sent: item.is_sent
    }));
  } catch (err) {
    console.error('Supabase Load Error:', err);
    entries = [];
  }
  renderDashboard();
}

// Save Entry (Supabase)
async function createEntry(status = 'Logged') {
  const supplierName = supplierInput.value.trim();
  if (supplierName && !suppliers.includes(supplierName)) {
    suppliers.push(supplierName);
    localStorage.setItem('approval_suppliers', JSON.stringify(suppliers));
    updateSupplierDatalist();
  }

  const amount = parseFloat(amountInput.value) || 0;
  const advancePercentValue = approvalTypeSelect.value === 'Advance Approval' ?
    (advancePercentSelect.value === 'custom' ? parseFloat(customPercentInput.value) : parseFloat(advancePercentSelect.value)) : 0;

  const entryData = {
    po_date: dateInput.value,
    approval_type: approvalTypeSelect.value,
    pr_so_number: document.getElementById('pr-so-number').value,
    po_number: document.getElementById('po-number').value,
    supplier: supplierName,
    amount: amount,
    currency: currencySelect.value,
    amount_sar: parseFloat(amountSarInput.value) || 0,
    advance_percent: advancePercentValue,
    advance_amount: parseFloat(advanceAmountInput.value) || 0,
    advance_amount_original: (amount * advancePercentValue) / 100,
    notes: document.getElementById('notes').value,
    status: status,
    is_sent: false
  };

  try {
    if (!supabaseClient) throw new Error('Supabase client not initialized');
    showToast('Saving to Team Database...', 'info');
    const { error } = await supabaseClient.from('entries').insert([entryData]);
    if (error) throw error;

    showToast('Successfully logged to central database!', 'success');
    entryForm.reset();
    init();
  } catch (err) {
    console.error('Supabase Save Error:', err);
    showToast('Fatal error: Could not save to Database!', 'error');
  }
}

// Email Batch Logic
async function sendEmailToManager(isTest = false) {
  if (entries.length === 0) {
    if (!isTest) return;
    showToast('No entries to send!', 'warning');
    return;
  }

  isSendingNow = true;
  const currentRecipient = managerEmail || "a.bazuhair@amco-saudi.com";
  const btn = isTest ? btnTestSend : btnFinalize;
  const originalHtml = btn ? btn.innerHTML : 'Send';

  try {
    if (btn) { btn.disabled = true; btn.innerHTML = 'Sending...'; }

    const poEntries = entries.filter(e => e.type === 'PO Approval');
    const advanceEntries = entries.filter(e => e.type === 'Advance Approval');

    // -- GENERATE PO TABLE --
    let poHtml = poEntries.length > 0 ? `<h3 style="color: #1e293b; margin-top: 0;">📅 PO require approval :</h3>
    <table border="1" cellpadding="8" style="border-collapse: collapse; font-family: sans-serif; width: 100%; border: 1px solid #e2e8f0;">
      <tr style="background: #f1f5f9; color: #1e293b; text-align: left; font-size: 11px;">
        <th>Date</th><th>PR/SO #</th><th>PO #</th><th>Supplier</th><th>Amount</th><th>Curr</th><th>SAR</th><th>Notes</th>
      </tr>` : "";

    poEntries.forEach(e => {
      poHtml += `<tr style="font-size: 11px; border-bottom: 1px solid #f1f5f9;">
        <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
        <td>${e.amount.toLocaleString()}</td><td>${e.currency}</td><td>${e.amountSar.toLocaleString()}</td>
        <td style="color: #64748b; font-style: italic;">${e.notes || '-'}</td>
      </tr>`;
    });
    if (poEntries.length > 0) poHtml += `</table>`;

    // -- GENERATE ADVANCE TABLE --
    let advHtml = advanceEntries.length > 0 ? `<h3 style="color: #1e293b;">💰 PO advances require Approval :</h3>
    <table border="1" cellpadding="8" style="border-collapse: collapse; font-family: sans-serif; width: 100%; border: 1px solid #e2e8f0;">
      <tr style="background: #f1f5f9; color: #1e293b; text-align: left; font-size: 11px;">
        <th>Date</th><th>PR/SO #</th><th>PO #</th><th>Supplier</th><th>SAR (Full)</th><th>Adv %</th><th>Adv Amount (SAR)</th><th>Adv (Orig)</th><th>Notes</th>
      </tr>` : "";

    advanceEntries.forEach(e => {
      const origAdvFormatted = e.advanceAmountOriginal ? `${e.advanceAmountOriginal.toLocaleString()} ${e.currency}` : '-';
      advHtml += `<tr style="font-size: 11px; border-bottom: 1px solid #f1f5f9;">
        <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
        <td>${e.amountSar.toLocaleString()}</td><td>${e.advancePercent}%</td><td>${e.advanceAmount.toLocaleString()}</td>
        <td>${origAdvFormatted}</td>
        <td style="color: #64748b; font-style: italic;">${e.notes || '-'}</td>
      </tr>`;
    });
    if (advanceEntries.length > 0) advHtml += `</table>`;

    // Calculation for Summary Box
    const totalAdvanceOnly = advanceEntries.reduce((acc, curr) => acc + curr.advanceAmount, 0);

    const templateParams = {
      to_name: "",
      to_email: currentRecipient,
      cc_email: ccEmails || "",
      message: isTest ? "[TEST SEND] Review current item summary below:" : "Please find the final daily procurement summary for GM review:",
      po_table: poHtml,
      advance_table: advHtml,
      summary_count: entries.length,
      total_sar: totalAdvanceOnly.toLocaleString()
    };

    if (EMAILJS_PUBLIC_KEY === 'YOUR_EMAILJS_PUBLIC_KEY' || !EMAILJS_PUBLIC_KEY) {
      showToast('Simulation: Email service not configured.', 'info');
    } else {
      await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, templateParams);
      showToast(isTest ? 'Test email sent!' : 'Email sent to Manager!', 'success');
    }

    if (!isTest) {
      const ids = entries.map(e => e.id);
      await supabaseClient.from('entries').update({ is_sent: true }).in('id', ids);
      showToast('Dashboard cleared after sending.', 'info');
      await loadEntries();
    }
  } catch (err) {
    console.error('Email Error:', err);
    showToast('Failed to send email. Check console.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    setTimeout(() => { isSendingNow = false; }, 65000);
  }
}

// Delete Entry (Supabase)
async function deleteEntry(id) {
  if (!confirm('Are you sure you want to remove this entry?')) return;
  try {
    const { error } = await supabaseClient.from('entries').delete().eq('id', id);
    if (error) throw error;
    showToast('Removed from team database', 'info');
  } catch (err) {
    console.error('Supabase Delete Error:', err);
    showToast('Could not delete from Supabase', 'error');
  }
}

// UI Event Listeners
if (themeToggle) themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('approval_theme', currentTheme);
  updateThemeIcons();
});

if (btnSettings) btnSettings.addEventListener('click', () => settingsModal.classList.add('active'));
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
if (btnSaveSettings) btnSaveSettings.addEventListener('click', updateSettings);
if (btnTestSend) btnTestSend.addEventListener('click', () => sendEmailToManager(true));
if (btnFinalize) btnFinalize.addEventListener('click', () => sendEmailToManager(false));

if (toggleHistory) toggleHistory.addEventListener('change', (e) => {
  showHistory = e.target.checked;
  loadEntries();
});

if (settingsModal) settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.classList.remove('active');
});

function updateThemeIcons() {
  const sunIcon = document.getElementById('sun-icon');
  const moonIcon = document.getElementById('moon-icon');
  if (currentTheme === 'light') {
    if (sunIcon) sunIcon.style.display = 'none';
    if (moonIcon) moonIcon.style.display = 'block';
  } else {
    if (sunIcon) sunIcon.style.display = 'block';
    if (moonIcon) moonIcon.style.display = 'none';
  }
}

if (poDateSpan) poDateSpan.addEventListener('click', () => { dateInput.style.display = 'block'; dateInput.focus(); });
if (dateInput) dateInput.addEventListener('change', () => { poDateSpan.textContent = dateInput.value; dateInput.style.display = 'none'; });
if (approvalTypeSelect) approvalTypeSelect.addEventListener('change', (e) => {
  advanceFields.style.display = (e.target.value === 'Advance Approval') ? 'grid' : 'none';
});

function calculate() {
  const amount = parseFloat(amountInput.value) || 0;
  const rate = exchangeRates[currencySelect.value] || 1;
  const sarAmount = amount * rate;
  if (amountSarInput) amountSarInput.value = sarAmount.toFixed(2);

  if (approvalTypeSelect.value === 'Advance Approval') {
    let percent = parseFloat(advancePercentSelect.value);
    if (advancePercentSelect.value === 'custom') percent = parseFloat(customPercentInput.value) || 0;
    const advanceAmount = (sarAmount * percent) / 100;
    if (advanceAmountInput) advanceAmountInput.value = advanceAmount.toFixed(2);
  }
}

[amountInput, currencySelect, advancePercentSelect, customPercentInput].forEach(el => { if (el) el.addEventListener('input', calculate); });
if (advancePercentSelect) advancePercentSelect.addEventListener('change', () => {
  customPercentGroup.style.display = advancePercentSelect.value === 'custom' ? 'block' : 'none';
  calculate();
});

function updateSupplierDatalist() {
  if (supplierDatalist) supplierDatalist.innerHTML = suppliers.map(s => `<option value="${s}">`).join('');
}

if (entryForm) entryForm.addEventListener('submit', (e) => { e.preventDefault(); createEntry('Logged'); });

// Rendering
function renderDashboard() {
  const poEntries = entries.filter(e => e.type === 'PO Approval');
  const advanceEntries = entries.filter(e => e.type === 'Advance Approval');

  if (poTbody) poTbody.innerHTML = poEntries.map(e => `
    <tr style="${e.is_sent ? 'opacity: 0.6;' : ''}">
      <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
      <td>${e.amount.toLocaleString()}</td><td>${e.currency}</td><td>${e.amountSar.toLocaleString()}</td>
      <td><span style="color: ${e.is_sent ? 'var(--secondary)' : 'var(--success)'}; font-weight:bold;">● ${e.is_sent ? 'SENT' : e.status}</span></td>
      <td style="color: var(--text-muted); font-style: italic; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${e.notes || ''}">
        ${e.notes || '-'}
      </td>
      <td style="text-align: right; white-space: nowrap;">
        ${!e.is_sent ? `
          <button onclick="startEdit('${e.id}')" class="btn btn-outline btn-icon" title="Edit Entry"><i data-lucide="edit-3" style="width: 14px; height: 14px;"></i></button>
          <button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon" title="Delete Entry"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  if (advanceTbody) advanceTbody.innerHTML = advanceEntries.map(e => `
    <tr style="${e.is_sent ? 'opacity: 0.6;' : ''}">
      <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
      <td>${e.amountSar.toLocaleString()} (Full)</td><td>${e.advancePercent}%</td>
      <td>${e.advanceAmount.toLocaleString()}</td><td>${e.advanceAmountOriginal ? e.advanceAmountOriginal.toLocaleString() : '0'} ${e.currency}</td>
      <td><span style="color: ${e.is_sent ? 'var(--secondary)' : 'var(--success)'}; font-weight:bold;">● ${e.is_sent ? 'SENT' : e.status}</span></td>
      <td style="color: var(--text-muted); font-style: italic; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${e.notes || ''}">
        ${e.notes || '-'}
      </td>
      <td style="text-align: right; white-space: nowrap;">
        ${!e.is_sent ? `
          <button onclick="startEdit('${e.id}')" class="btn btn-outline btn-icon" title="Edit Entry"><i data-lucide="edit-3" style="width: 14px; height: 14px;"></i></button>
          <button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon" title="Delete Entry"><i data-lucide="trash-2" style="width: 14px; height: 14px;"></i></button>
        ` : ''}
      </td>
    </tr>
  `).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// Form Handlers
async function createEntry(e) {
  e.preventDefault();
  if (!supabaseClient) return;

  const type = approvalTypeSelect.value;
  const supplier = supplierInput.value.trim();
  const prSo = prSoInput.value.trim();
  const po = poNumberInput.value.trim();
  const date = poDateSpan.textContent;

  if (!supplier || !prSo || !po) {
    showToast('Please fill all required fields', 'warning');
    return;
  }

  const amount = parseFloat(amountInput.value) || 0;
  const advancePercentValue = approvalTypeSelect.value === 'Advance Approval' ?
    (advancePercentSelect.value === 'custom' ? parseFloat(customPercentInput.value) : parseFloat(advancePercentSelect.value)) : 0;

  const entryData = {
    type,
    supplier,
    prSo,
    po,
    date,
    amount,
    currency: currencySelect.value,
    amountSar: parseFloat(amountSarInput.value) || 0,
    advancePercent: advancePercentValue,
    advanceAmount: parseFloat(advanceAmountInput.value) || 0,
    advanceAmountOriginal: (amount * advancePercentValue) / 100,
    notes: notesInput.value,
    status: 'Pending',
    is_sent: false
  };

  try {
    showToast(editMode ? 'Updating entry...' : 'Saving entry...', 'info');
    
    let result;
    if (editMode && currentEditingId) {
      result = await supabaseClient
        .from('entries')
        .update(entryData)
        .eq('id', currentEditingId);
    } else {
      result = await supabaseClient
        .from('entries')
        .insert([entryData]);
    }

    if (result.error) throw result.error;
    
    showToast(editMode ? 'Entry updated successfully!' : 'Entry logged successfully!', 'success');
    cancelEdit(); // Resets mode and form
    await loadEntries();
    updateSupplierDatalist();
  } catch (err) {
    console.error('Database Error:', err);
    showToast('Operation failed', 'error');
  }
}

if (btnExport) btnExport.addEventListener('click', () => {
  if (entries.length === 0) return showToast('No data to export!', 'error');
  const wb = XLSX.utils.book_new();
  const mapData = (e) => ({ 'Date': e.date, 'PR/SO': e.prSo, 'PO': e.po, 'Supplier': e.supplier, 'SAR': e.amountSar, 'Adv%': e.advancePercent, 'Status': e.status });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e => e.type === 'PO Approval').map(mapData)), "PO");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e => e.type === 'Advance Approval').map(mapData)), "Advance");
  XLSX.writeFile(wb, `Approval_System_${new Date().toISOString().split('T')[0]}.xlsx`);
});

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'glass fade-in';
  toast.style.padding = '0.75rem 1.5rem';
  toast.style.borderLeft = `4px solid ${type === 'success' ? 'var(--success)' : 'var(--secondary)'}`;
  toast.innerHTML = `<p>${message}</p>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

init();
