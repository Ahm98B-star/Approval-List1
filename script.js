/**
 * Approval System Management Tool
 * Unified Production Script
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
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
  console.error("Supabase Initialization Error:", e);
}

const EMAILJS_PUBLIC_KEY = 'iOabUF7I4IR2pyt6q';
const EMAILJS_SERVICE_ID = 'service_pz1v6gq';
const EMAILJS_TEMPLATE_ID = 'template_t156fbg';
if (typeof emailjs !== 'undefined') {
  emailjs.init(EMAILJS_PUBLIC_KEY);
}

const exchangeRates = {
  SAR: 1, USD: 3.75, EUR: 4.02, GBP: 4.75, AED: 1.02, QAR: 1.03, KWD: 12.20, BHD: 9.95, OMR: 9.74,
  JPY: 0.025, CNY: 0.52, INR: 0.045, EGP: 0.078, JOD: 5.29, PKR: 0.013, THB: 0.10, TRY: 0.11,
  IDR: 0.00024, MYR: 0.81, VND: 0.00015, PHP: 0.067, KRW: 0.0028, CHF: 4.25, CAD: 2.75,
  AUD: 2.45, NZD: 2.25, SEK: 0.35, NOK: 0.34, DKK: 0.54, SGD: 2.80, HKD: 0.48, MXN: 0.22,
  BRL: 0.75, ZAR: 0.20, RUB: 0.041, ILS: 1.01, TWD: 0.12, CZK: 0.16, HUF: 0.010, PLN: 0.94, LBP: 0.00004
};

// --- UI ELEMENTS ---
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
const poNumberInput = document.getElementById('po-number');
const prSoInput = document.getElementById('pr-so-number');
const notesInput = document.getElementById('notes');

// Dispatch Bar Elements
const inputManagerEmail = document.getElementById('input-manager-email');
const ccTagsContainer = document.getElementById('cc-tags-container');
const newCcInput = document.getElementById('new-cc-input');
const btnAddCc = document.getElementById('btn-add-cc');

// Settings Elements
const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnSaveSettings = document.getElementById('btn-save-settings');
const inputSendTime = document.getElementById('input-send-time');
const displaySendTime = document.getElementById('display-send-time');
const toggleHistory = document.getElementById('toggle-history');
const btnTestSend = document.getElementById('btn-test-send');

// APP STATE
let dailySendTime = '14:00';
let managerEmail = 'a.bazuhair@amco-saudi.com';
let ccEmails = '';
let ccEmailsArray = [];
let isSendingNow = false;
let showHistory = false;
let editMode = false;
let currentEditingId = null;

// --- CORE FUNCTIONS ---

async function init() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons();
  
  const today = new Date().toISOString().split('T')[0];
  if (poDateSpan) poDateSpan.textContent = today;
  if (dateInput) dateInput.value = today;

  await loadSettings();
  await loadEntries();
  updateSupplierDatalist();
  subscribeToChanges();
  
  setInterval(checkSchedule, 60000);
}

async function loadSettings() {
  if (!supabaseClient) return;
  try {
    const { data } = await supabaseClient.from('settings').select('key, value');
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
  
  try {
    await supabaseClient.from('settings').upsert([
      { key: 'daily_send_time', value: newTime },
      { key: 'manager_email', value: newEmail },
      { key: 'cc_emails', value: newCC }
    ], { onConflict: 'key' });
    
    dailySendTime = newTime;
    managerEmail = newEmail;
    ccEmails = newCC;
    
    if (displaySendTime) displaySendTime.textContent = format12h(newTime);
    if (settingsModal && settingsModal.classList.contains('active')) {
       settingsModal.classList.remove('active');
       showToast('Settings saved!', 'success');
    }
  } catch (e) { console.error('Settings Update Error:', e); }
}

// --- CC TAG LOGIC ---
function renderCcTags() {
  if (!ccTagsContainer || !newCcInput) return;
  const currentTags = ccTagsContainer.querySelectorAll('.cc-tag');
  currentTags.forEach(tag => tag.remove());
  ccEmailsArray.forEach((email, index) => {
    const tag = document.createElement('div');
    tag.className = 'cc-tag';
    tag.innerHTML = `<span>${email}</span><span class="remove-btn" onclick="removeCcTag(${index})"><i data-lucide="x" style="width:14px; height:14px;"></i></span>`;
    ccTagsContainer.insertBefore(tag, newCcInput);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function addCcFromInput() {
  const email = newCcInput.value.trim();
  if (email && email.includes('@') && !ccEmailsArray.includes(email)) {
    ccEmailsArray.push(email);
    newCcInput.value = '';
    renderCcTags();
    updateSettings();
  }
}

window.removeCcTag = function(index) {
  ccEmailsArray.splice(index, 1);
  renderCcTags();
  updateSettings();
};

// --- BATCH LOGIC ---
async function checkSchedule() {
  const now = new Date();
  const current24h = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (current24h === dailySendTime && !isSendingNow && entries.length > 0) {
    await sendEmailToManager(false);
  }
}

async function sendEmailToManager(isTest = false) {
  if (entries.length === 0) return isTest && showToast('No entries!', 'warning');
  isSendingNow = true;
  const btn = isTest ? btnTestSend : btnFinalize;
  const originalHtml = btn?.innerHTML;
  try {
    if (btn) { btn.disabled = true; btn.innerHTML = 'Sending...'; }
    const poEntries = entries.filter(e => e.type === 'PO Approval' && !e.is_sent);
    const advEntries = entries.filter(e => e.type === 'Advance Approval' && !e.is_sent);
    
    let poHtml = poEntries.length > 0 ? `<h3 style="color:#1e293b;">📅 PO require approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:11px;">` : "";
    poEntries.forEach(e => poHtml += `<tr><td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.amountSar.toLocaleString()} SAR</td></tr>`);
    if(poEntries.length > 0) poHtml += `</table>`;

    let advHtml = advEntries.length > 0 ? `<h3 style="color:#1e293b;">💰 PO advances require Approval:</h3><table border="1" cellpadding="8" style="border-collapse:collapse;width:100%;font-size:11px;">` : "";
    advEntries.forEach(e => advHtml += `<tr><td>${e.date}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.advanceAmount.toLocaleString()} SAR</td></tr>`);
    if(advEntries.length > 0) advHtml += `</table>`;

    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      to_email: managerEmail,
      cc_email: ccEmails,
      po_table: poHtml,
      advance_table: advHtml,
      summary_count: poEntries.length + advEntries.length,
      total_sar: (poEntries.reduce((a,b)=>a+b.amountSar,0) + advEntries.reduce((a,b)=>a+b.advanceAmount,0)).toLocaleString()
    });

    if(!isTest) {
      const ids = [...poEntries.map(e=>e.id), ...advEntries.map(e=>e.id)];
      await supabaseClient.from('entries').update({ is_sent: true }).in('id', ids);
    }
    showToast(isTest ? 'Test email sent!' : 'Daily summary sent!', 'success');
    await loadEntries();
  } catch (err) {
    console.error(err);
    showToast('Failed to send email', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = originalHtml; }
    isSendingNow = false;
  }
}

// --- DATA ACCESS ---
async function loadEntries() {
  let query = supabaseClient.from('entries').select('*');
  if (!showHistory) query = query.eq('is_sent', false);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (!error) {
    entries = data.map(item => ({
      id: item.id, type: item.approval_type, date: item.po_date, prSo: item.pr_so_number,
      po: item.po_number, supplier: item.supplier, amount: item.amount, currency: item.currency,
      amountSar: item.amount_sar, advancePercent: item.advance_percent,
      advanceAmount: item.advance_amount, advanceAmountOriginal: item.advance_amount_original,
      notes: item.notes, status: item.status, is_sent: item.is_sent
    }));
    renderDashboard();
  }
}

function renderDashboard() {
  const poEntries = entries.filter(e => e.type === 'PO Approval');
  const advEntries = entries.filter(e => e.type === 'Advance Approval');
  
  if (poTbody) poTbody.innerHTML = poEntries.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td>${e.date}</td><td>${e.prSo}</td><td>${e.po}</td><td>${e.supplier}</td>
      <td>${e.amountSar.toLocaleString()}</td><td>● ${e.is_sent ? 'SENT' : 'Pending'}</td><td>${e.notes||''}</td>
      <td style="text-align:right;">${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline btn-icon" style="padding:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}</td>
    </tr>
  `).join('');

  if (advanceTbody) advanceTbody.innerHTML = advEntries.map(e => `
    <tr style="${e.is_sent ? 'opacity:0.6;' : ''}">
      <td>${e.date}</td><td>${e.po}</td><td>${e.supplier}</td><td>${e.advanceAmount.toLocaleString()}</td>
      <td>● ${e.is_sent ? 'SENT' : 'Pending'}</td><td>${e.notes||''}</td>
      <td style="text-align:right;">${!e.is_sent ? `<button onclick="startEdit('${e.id}')" class="btn btn-outline btn-icon" style="padding:4px;"><i data-lucide="edit-3" style="width:14px;"></i></button>` : ''}</td>
    </tr>
  `).join('');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- EDIT LOGIC ---
window.startEdit = function(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  editMode = true; currentEditingId = id;
  if (poDateSpan) poDateSpan.textContent = e.date;
  if (approvalTypeSelect) approvalTypeSelect.value = e.type;
  if (prSoInput) prSoInput.value = e.prSo;
  if (poNumberInput) poNumberInput.value = e.po;
  if (supplierInput) supplierInput.value = e.supplier;
  if (amountInput) amountInput.value = e.amount;
  if (currencySelect) currencySelect.value = e.currency;
  if (notesInput) notesInput.value = e.notes||'';
  if (advanceFields) advanceFields.style.display = e.type === 'Advance Approval' ? 'grid' : 'none';
  const logBtn = document.getElementById('btn-log-entry');
  if (logBtn) logBtn.innerHTML = '<i data-lucide="save"></i> Update Entry';
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

// --- EVENT LISTENERS ---
if (entryForm) entryForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    approval_type: approvalTypeSelect.value, pr_so_number: prSoInput.value, po_number: poNumberInput.value,
    supplier: supplierInput.value, amount: parseFloat(amountInput.value), currency: currencySelect.value,
    amount_sar: parseFloat(amountSarInput.value), notes: notesInput.value,
    advance_percent: parseFloat(advancePercentSelect.value), advance_amount: parseFloat(advanceAmountInput.value),
    po_date: poDateSpan.textContent, is_sent: false, status: 'Pending'
  };
  if (editMode) await supabaseClient.from('entries').update(data).eq('id', currentEditingId);
  else await supabaseClient.from('entries').insert([data]);
  editMode = false; entryForm.reset();
  await loadEntries();
});

if (btnAddCc) btnAddCc.addEventListener('click', addCcFromInput);
if (newCcInput) newCcInput.addEventListener('keydown', e => e.key==='Enter' && (e.preventDefault(), addCcFromInput()));
if (inputManagerEmail) inputManagerEmail.addEventListener('change', updateSettings);
if (btnSettings) btnSettings.addEventListener('click', () => settingsModal.classList.add('active'));
if (btnCloseSettings) btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
if (btnSaveSettings) btnSaveSettings.addEventListener('click', updateSettings);
if (toggleHistory) toggleHistory.addEventListener('change', e => (showHistory=e.target.checked, loadEntries()));
if (btnFinalize) btnFinalize.addEventListener('click', () => sendEmailToManager(false));
if (btnTestSend) btnTestSend.addEventListener('click', () => sendEmailToManager(true));

// --- HELPERS ---
function format12h(time24) {
  const [h, m] = time24.split(':');
  const period = h >= 12 ? 'PM' : 'AM';
  return `${((h % 12) || 12)}:${m} ${period}`;
}
function showToast(m, t) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const div = document.createElement('div');
  div.className = 'glass fade-in';
  div.style = `padding:0.75rem 1.5rem; border-left:4px solid ${t==='success'?'var(--success)':'var(--secondary)'}`;
  div.innerHTML = `<p>${m}</p>`;
  c.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}
function updateSupplierDatalist() {
  if (!supplierDatalist) return;
  const unique = [...new Set(entries.map(e => e.supplier))];
  supplierDatalist.innerHTML = unique.map(s => `<option value="${s}">`).join('');
}
function updateThemeIcons() { /* Logic for icons */ }
function subscribeToChanges() {
  supabaseClient.channel('entries_realtime').on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, loadEntries).subscribe();
}

// --- START ---
init();
