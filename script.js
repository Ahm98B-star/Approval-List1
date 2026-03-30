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
const themeToggle = document.getElementById('theme-toggle');

// Core Functions
async function init() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons();

  const today = new Date().toISOString().split('T')[0];
  if (!dateInput.value) {
    poDateSpan.textContent = today;
    dateInput.value = today;
  }

  await loadEntries();
  updateSupplierDatalist();
}

// Load Entries (Supabase)
async function loadEntries() {
  if (!supabaseClient) {
    showToast('Supabase Client not initialized. Check your credentials.', 'error');
    return;
  }
  try {
    showToast('Connecting to Supabase...', 'info');
    const { data, error } = await supabaseClient
      .from('entries')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase fetch error:', error);
      throw error;
    }

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
      timestamp: item.created_at
    }));
  } catch (err) {
    console.error('Supabase Load Error:', err);
    showToast('Error: Could not load data from Supabase!', 'error');
    // Fallback to local storage if needed for offline inspection
    entries = JSON.parse(localStorage.getItem('approval_entries')) || [];
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
    status: status
  };

  try {
    if (!supabaseClient) throw new Error('Supabase client not initialized');
    
    showToast('Saving to Supabase...', 'info');
    const { data, error } = await supabaseClient
      .from('entries')
      .insert([entryData]);

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    showToast('Successfully saved to team database!', 'success');
    await loadEntries();

    // Reset form
    entryForm.reset();
    init(); // Refresh defaults
  } catch (err) {
    console.error('Supabase Save Error:', err);
    showToast('Fatal error: Could not save to Supabase!', 'error');
  }
}

// Delete Entry (Supabase)
async function deleteEntry(id) {
  if (!confirm('Are you sure you want to remove this entry?')) return;

  try {
    showToast('Removing from database...', 'info');
    const { error } = await supabaseClient
      .from('entries')
      .delete()
      .eq('id', id);

    if (error) throw error;

    showToast('Removed from team database', 'info');
    await loadEntries();
  } catch (err) {
    console.error('Supabase Delete Error:', err);
    showToast('Could not delete from Supabase', 'error');
  }
}

// UI Event Listeners (Themes, Dates, etc.)
themeToggle.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('approval_theme', currentTheme);
  updateThemeIcons();
});

function updateThemeIcons() {
  const sunIcon = document.getElementById('sun-icon');
  const moonIcon = document.getElementById('moon-icon');
  if (currentTheme === 'light') {
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
  } else {
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
  }
}

poDateSpan.addEventListener('click', () => {
  dateInput.style.display = 'block';
  dateInput.focus();
});

dateInput.addEventListener('change', () => {
  poDateSpan.textContent = dateInput.value;
  dateInput.style.display = 'none';
});

approvalTypeSelect.addEventListener('change', (e) => {
  if (e.target.value === 'Advance Approval') {
    advanceFields.style.display = 'grid';
  } else {
    advanceFields.style.display = 'none';
  }
});

function calculate() {
  const amount = parseFloat(amountInput.value) || 0;
  const rate = exchangeRates[currencySelect.value] || 1;
  const sarAmount = amount * rate;
  amountSarInput.value = sarAmount.toFixed(2);

  if (approvalTypeSelect.value === 'Advance Approval') {
    let percent = parseFloat(advancePercentSelect.value);
    if (advancePercentSelect.value === 'custom') percent = parseFloat(customPercentInput.value) || 0;
    const advanceAmount = (sarAmount * percent) / 100;
    advanceAmountInput.value = advanceAmount.toFixed(2);
  }
}

[amountInput, currencySelect, advancePercentSelect, customPercentInput].forEach(el => {
  el.addEventListener('input', calculate);
});

advancePercentSelect.addEventListener('change', () => {
  customPercentGroup.style.display = advancePercentSelect.value === 'custom' ? 'block' : 'none';
  calculate();
});

function updateSupplierDatalist() {
  supplierDatalist.innerHTML = suppliers.map(s => `<option value="${s}">`).join('');
}

entryForm.addEventListener('submit', (e) => { e.preventDefault(); createEntry('Logged'); });

document.getElementById('btn-send-now').addEventListener('click', () => {
  if (entryForm.checkValidity()) createEntry('Sent Now');
  else entryForm.reportValidity();
});

document.getElementById('btn-schedule').addEventListener('click', () => {
  const scheduleTime = document.getElementById('schedule-time').value;
  if (!scheduleTime) { showToast('Please select a time!', 'error'); return; }
  if (entryForm.checkValidity()) createEntry(`Scheduled for ${new Date(scheduleTime).toLocaleString()}`);
  else entryForm.reportValidity();
});

// Rendering & Exporting
function renderDashboard() {
  const poEntries = entries.filter(e => e.type === 'PO Approval');
  const advanceEntries = entries.filter(e => e.type === 'Advance Approval');

  poTbody.innerHTML = poEntries.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${e.prSo}</td>
      <td>${e.po}</td>
      <td>${e.supplier}</td>
      <td>${e.amount.toLocaleString()}</td>
      <td>${e.currency}</td>
      <td>${e.amountSar.toLocaleString()}</td>
      <td><span style="color: var(--success);">● ${e.status}</span></td>
      <td style="text-align: right;">
        <button onclick="deleteEntry(${e.id})" class="btn btn-danger btn-icon">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    </tr>
  `).join('');

  advanceTbody.innerHTML = advanceEntries.map(e => `
    <tr>
      <td>${e.date}</td>
      <td>${e.prSo}</td>
      <td>${e.po}</td>
      <td>${e.supplier}</td>
      <td>${e.amountSar.toLocaleString()} (Full)</td>
      <td>${e.advancePercent}%</td>
      <td>${e.advanceAmount.toLocaleString()}</td>
      <td>${e.advanceAmountOriginal ? e.advanceAmountOriginal.toLocaleString() : '0'} ${e.currency}</td>
      <td><span style="color: var(--success);">● ${e.status}</span></td>
      <td style="text-align: right;">
        <button onclick="deleteEntry(${e.id})" class="btn btn-danger btn-icon">
          <i data-lucide="trash-2"></i>
        </button>
      </td>
    </tr>
  `).join('');

  lucide.createIcons();
}

btnExport.addEventListener('click', () => {
  if (entries.length === 0) return showToast('No data to export!', 'error');
  const wb = XLSX.utils.book_new();
  const mapData = (e) => ({
    'Date': e.date, 'PR/SO': e.prSo, 'PO': e.po, 'Supplier': e.supplier,
    'SAR': e.amountSar, 'Adv%': e.advancePercent, 'Status': e.status
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e => e.type === 'PO Approval').map(mapData)), "PO");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(entries.filter(e => e.type === 'Advance Approval').map(mapData)), "Advance");
  XLSX.writeFile(wb, `Approval_System_${new Date().toISOString().split('T')[0]}.xlsx`);
});

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'glass fade-in';
  toast.style.padding = '0.75rem 1.5rem';
  toast.style.borderLeft = `4px solid ${type === 'success' ? 'var(--success)' : 'var(--secondary)'}`;
  toast.innerHTML = `<p>${message}</p>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 400); }, 3000);
}

init();
