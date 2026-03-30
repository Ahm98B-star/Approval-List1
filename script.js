/**
 * Approval System Management Tool
 * Stable Version (Pre-CC Tag Updates)
 */

// --- STATE MANAGEMENT ---
let entries = [];
let suppliers = JSON.parse(localStorage.getItem('approval_suppliers')) || [];
let currentTheme = localStorage.getItem('approval_theme') || 'dark';

// --- CONFIGURATION ---
const SUPABASE_URL = 'https://gwrkdhhghuynowmqzwxp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5mcdvM_jJDmxncG4Gr2LDw_3Q2ReD4D';
let supabaseClient;
try {
  if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("✅ Supabase Engine Loaded.");
  } else {
    alert("CRITICAL ERROR: Supabase library failed to load! Please check your internet connection and refresh.");
  }
} catch (e) { 
  console.error("❌ Supabase Initialization Error:", e);
}

const EMAILJS_PUBLIC_KEY = 'iOabUF7I4IR2pyt6q';
const EMAILJS_SERVICE_ID = 'service_pz1v6gq';
const EMAILJS_TEMPLATE_ID = 'template_t156fbg';

const exchangeRates = {
  SAR: 1, USD: 3.75, EUR: 4.02, GBP: 4.75, AED: 1.02, QAR: 1.03, KWD: 12.20, BHD: 9.95, OMR: 9.74,
  JPY: 0.025, CNY: 0.52, INR: 0.045, EGP: 0.078, JOD: 5.29, PKR: 0.013, THB: 0.10, TRY: 0.11,
  IDR: 0.00024, MYR: 0.81, VND: 0.00015, PHP: 0.067, KRW: 0.0028, CHF: 4.25, CAD: 2.75,
  AUD: 2.45, NZD: 2.25, SEK: 0.35, NOK: 0.34, DKK: 0.54, SGD: 2.80, HKD: 0.48, MXN: 0.22,
  BRL: 0.75, ZAR: 0.20, RUB: 0.041, ILS: 1.01, TWD: 0.12, CZK: 0.16, HUF: 0.010, PLN: 0.94, LBP: 0.00004
};

// --- UI ELEMENTS ---
const poDateSpan = document.getElementById('po-date');
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
const poNumberInput = document.getElementById('po-number');
const prSoInput = document.getElementById('pr-so-number');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputSendTime = document.getElementById('input-send-time');
const inputManagerEmail = document.getElementById('input-manager-email');
const inputCcEmails = document.getElementById('input-cc-emails');
const displaySendTime = document.getElementById('display-send-time');
const toggleHistory = document.getElementById('toggle-history');
const btnTestSend = document.getElementById('btn-test-send');

// App State
let dailySendTime = '14:00';
let managerEmail = 'a.bazuhair@amco-saudi.com';
let ccEmails = '';
let isSendingNow = false;
let showHistory = false;

// --- INITIALIZE ---
async function init() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons();
  const today = new Date().toISOString().split('T')[0];
  if (poDateSpan) poDateSpan.textContent = today;
  if (typeof emailjs !== 'undefined') emailjs.init(EMAILJS_PUBLIC_KEY);
  await loadSettings();
  await loadEntries();
  updateSupplierDatalist();
  subscribeToChanges();
  setInterval(checkSchedule, 60000);
}

// --- DATABASE LOGIC ---
async function loadEntries() {
  if (!supabaseClient) return;
  let query = supabaseClient.from('entries').select('*');
  if (!showHistory) query = query.eq('is_sent', false);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    console.error("Load Entries Error:", error);
    showToast('Failed to load table', 'error');
  } else {
    entries = data.map(i => ({
      id: i.id, type: i.approval_type, date: i.po_date, prSo: i.pr_so_number, po: i.po_number,
      supplier: i.supplier, amount: i.amount, currency: i.currency, amountSar: i.amount_sar,
      advancePercent: i.advance_percent, advanceAmount: i.advance_amount, 
      status: i.status, is_sent: i.is_sent
    }));
    renderDashboard();
  }
}

async function createEntry(e) {
  e.preventDefault();
  if (!supabaseClient) return;
  const entryData = {
    approval_type: approvalTypeSelect.value, 
    pr_so_number: prSoInput.value, 
    po_number: poNumberInput.value,
    supplier: supplierInput.value, 
    amount: parseFloat(amountInput.value) || 0, 
    currency: currencySelect.value,
    amount_sar: parseFloat(amountSarInput.value) || 0, 
    advance_percent: parseFloat(advancePercentSelect.value) || 0,
    advance_amount: parseFloat(advanceAmountInput.value) || 0,
    po_date: poDateSpan.textContent, 
    is_sent: false, 
    status: 'Pending'
  };
  try {
    const { error } = await supabaseClient.from('entries').insert([entryData]);
    if (error) throw error;
    showToast('Logged Successfully!', 'success');
    entryForm.reset();
    calculate();
    await loadEntries();
  } catch (err) { 
    showToast('Database Error: ' + (err.message || 'Check connection'), 'error'); 
  }
}

async function deleteEntry(id) {
  if (!confirm('Are you sure you want to delete this entry?')) return;
  try {
    const { error } = await supabaseClient.from('entries').delete().eq('id', id);
    if (error) throw error;
    showToast('Deleted', 'warning');
    await loadEntries();
  } catch (e) { showToast('Delete Failed', 'error'); }
}

// --- CALCULATION ENGINE ---
function calculate() {
  const amount = parseFloat(amountInput.value) || 0;
  const rate = exchangeRates[currencySelect.value] || 1;
  const sarAmount = amount * rate;
  if (amountSarInput) amountSarInput.value = sarAmount.toFixed(2);

  if (approvalTypeSelect.value === 'Advance Approval') {
    const p = advancePercentSelect.value === 'custom' ? parseFloat(customPercentInput.value) : parseFloat(advancePercentSelect.value);
    const adv = (sarAmount * (p || 0)) / 100;
    if (advanceAmountInput) advanceAmountInput.value = adv.toFixed(2);
  }
}

// --- SETTINGS LOGIC ---
async function loadSettings() {
  if (!supabaseClient) return;
  const { data } = await supabaseClient.from('settings').select('*');
  if (data) {
    data.forEach(s => {
      if (s.key === 'daily_send_time') {
        dailySendTime = s.value;
        if (inputSendTime) inputSendTime.value = s.value;
        if (displaySendTime) displaySendTime.textContent = format12h(s.value);
      }
      if (s.key === 'manager_email') {
        managerEmail = s.value;
        if (inputManagerEmail) inputManagerEmail.value = s.value;
      }
      if (s.key === 'cc_emails') {
        ccEmails = s.value;
        if (inputCcEmails) inputCcEmails.value = s.value;
      }
    });
  }
}

async function updateSettings() {
  if (!supabaseClient) return;
  const newTime = inputSendTime.value;
  const newEmail = inputManagerEmail.value.trim();
  const newCC = inputCcEmails.value.trim();
  try {
    await supabaseClient.from('settings').upsert([
      { key: 'daily_send_time', value: newTime },
      { key: 'manager_email', value: newEmail },
      { key: 'cc_emails', value: newCC }
    ], { onConflict: 'key' });
    dailySendTime = newTime; managerEmail = newEmail; ccEmails = newCC;
    if (displaySendTime) displaySendTime.textContent = format12h(newTime);
    settingsModal.classList.remove('active');
    showToast('Settings Saved', 'success');
  } catch (e) { showToast('Save Failed', 'error'); }
}

// --- UI HELPERS ---
function renderDashboard() {
  const poData = entries.filter(e => e.type === 'PO Approval');
  const advData = entries.filter(e => e.type === 'Advance Approval');
  
  if (poTbody) poTbody.innerHTML = poData.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
      <td>${e.amountSar.toLocaleString()}</td><td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td style="text-align:right;">
        ${!e.is_sent ? `<button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>` : ''}
      </td>
    </tr>
  `).join('');

  if (advanceTbody) advanceTbody.innerHTML = advData.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td>${e.date}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.advanceAmount.toLocaleString()}</td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td>
      <td style="text-align:right;">
        ${!e.is_sent ? `<button onclick="deleteEntry('${e.id}')" class="btn btn-danger btn-icon" style="padding:4px;"><i data-lucide="trash-2" style="width:14px;"></i></button>` : ''}
      </td>
    </tr>
  `).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function checkSchedule() {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (time === dailySendTime && !isSendingNow && entries.some(e=>!e.is_sent)) await sendEmailToManager(false);
}

async function sendEmailToManager(isTest = false) {
  const pending = entries.filter(e => !e.is_sent);
  if (pending.length === 0) return isTest && showToast('No pending entries', 'warning');
  isSendingNow = true;
  const btn = isTest ? btnTestSend : btnFinalize;
  const original = btn ? btn.innerHTML : "";
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = 'Sending...'; }
    const pos = pending.filter(e => e.type === 'PO Approval');
    const advs = pending.filter(e => e.type === 'Advance Approval');
    
    let poH = pos.length ? `<h3>📅 PO require approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:11px;">` : "";
    pos.forEach(e => poH += `<tr><td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.amountSar.toLocaleString()} SAR</td></tr>`);
    if(pos.length) poH += `</table>`;

    let advH = advs.length ? `<h3>💰 PO advances require Approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:11px;">` : "";
    advs.forEach(e => advH += `<tr><td>${e.date}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.advanceAmount.toLocaleString()} SAR</td></tr>`);
    if(advs.length) advH += `</table>`;

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: managerEmail,
      cc_email: ccEmails,
      po_table: poH,
      advance_table: advH,
      summary_count: pending.length,
      total_sar: (pending.reduce((a,b)=>a+(b.type==='PO Approval'?b.amountSar:b.advanceAmount),0)).toLocaleString()
    });

    if (!isTest) {
      await supabaseClient.from('entries').update({ is_sent: true }).in('id', pending.map(e=>e.id));
      await loadEntries();
    }
    showToast('Email Sent Successfully!', 'success');
  } catch (e) { showToast('Email Failed', 'error'); }
  finally { if(btn) { btn.disabled = false; btn.innerHTML = original; } isSendingNow = false; }
}

function format12h(t) {
  const [h, m] = t.split(':');
  return `${((h%12)||12)}:${m} ${h>=12?'PM':'AM'}`;
}
function showToast(m, t) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'glass fade-in';
  div.style = `padding:0.75rem 1.5rem; border-left:4px solid ${t==='success'?'var(--success)':'var(--secondary)'}`;
  div.innerHTML = `<p>${m}</p>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
function updateSupplierDatalist() {
  if (!supplierDatalist) return;
  const unique = [...new Set(entries.map(e => e.supplier))];
  supplierDatalist.innerHTML = unique.map(s => `<option value="${s}">`).join('');
}
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('approval_theme', currentTheme);
  updateThemeIcons();
}
function updateThemeIcons() {
  const icon = themeToggle ? themeToggle.querySelector('i') : null;
  if (icon) {
    icon.setAttribute('data-lucide', currentTheme === 'dark' ? 'sun' : 'moon');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}
function subscribeToChanges() {
  if (supabaseClient) supabaseClient.channel('entries_realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, loadEntries).subscribe();
}

// --- LISTENERS ---
if (entryForm) entryForm.addEventListener('submit', createEntry);
if (amountInput) amountInput.addEventListener('input', calculate);
if (currencySelect) currencySelect.addEventListener('change', calculate);
if (approvalTypeSelect) approvalTypeSelect.addEventListener('change', () => {
  advanceFields.style.display = approvalTypeSelect.value === 'Advance Approval' ? 'grid' : 'none';
  calculate();
});
if (advancePercentSelect) advancePercentSelect.addEventListener('change', () => {
  customPercentGroup.style.display = advancePercentSelect.value === 'custom' ? 'block' : 'none';
  calculate();
});
if (btnSettings) btnSettings.addEventListener('click', () => settingsModal.classList.add('active'));
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
if (btnSaveSettings) btnSaveSettings.addEventListener('click', updateSettings);
if (toggleHistory) toggleHistory.addEventListener('change', e => { showHistory = e.target.checked; loadEntries(); });
if (themeToggle) themeToggle.addEventListener('click', toggleTheme);
if (btnFinalize) btnFinalize.addEventListener('click', () => sendEmailToManager(false));
if (btnExport) btnExport.addEventListener('click', () => {
  if (entries.length === 0) return showToast('No table data', 'error');
  const wb = XLSX.utils.book_new();
  const mapD = (e) => ({ Date: e.date, 'PR/SO': e.prSo, PO: e.po, Supplier: e.supplier, SAR: e.amountSar });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e=>e.type==='PO Approval').map(mapD)), "PO");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e=>e.type==='Advance Approval').map(mapD)), "Advance");
  XLSX.writeFile(wb, `Approvals_${new Date().toISOString().split('T')[0]}.xlsx`);
});

init();
