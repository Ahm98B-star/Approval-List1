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
let isSendingNow = false;
let showHistory = false;

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
      });
    }
  } catch (e) { console.error('Settings load error:', e); }
}

async function updateSettings() {
  const newTime = inputSendTime ? inputSendTime.value : dailySendTime;
  const newEmail = inputManagerEmail ? inputManagerEmail.value.trim() : managerEmail;
  
  if (!newTime || !newEmail) return;
  
  try {
    showToast('Saving settings...', 'info');
    await supabaseClient
      .from('settings')
      .upsert([
        { key: 'daily_send_time', value: newTime },
        { key: 'manager_email', value: newEmail }
      ], { onConflict: 'key' });
    
    dailySendTime = newTime;
    managerEmail = newEmail;
    if (displaySendTime) displaySendTime.textContent = format12h(newTime);
    if (settingsModal) settingsModal.classList.remove('active');
    showToast('Settings saved successfully!', 'success');
  } catch (e) { 
    console.error('Settings Update Error:', e);
    showToast('Failed to save settings', 'error'); 
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
  const ccEmail = document.getElementById('cc-email').value.trim();
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

    const totalAdvance = advanceEntries.reduce((acc, curr) => acc + curr.advanceAmount, 0);

    const templateParams = {
      to_name: "General Manager",
      to_email: currentRecipient,
      cc_email: ccEmail || "", 
      message: isTest ? "[TEST SEND] Current summary sample below:" : "Please find the procurement summary for GM review:",
      po_table: poHtml,
      advance_table: advHtml,
      summary_count: entries.length,
      total_sar: totalAdvance.toLocaleString()
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
      <td style="text-align: right;">${!e.is_sent ? `<button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon"><i data-lucide="trash-2"></i></button>` : ''}</td>
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
      <td style="text-align: right;">${!e.is_sent ? `<button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon"><i data-lucide="trash-2"></i></button>` : ''}</td>
    </tr>
  `).join('');
  lucide.createIcons();
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
