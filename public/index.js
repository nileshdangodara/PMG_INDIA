/**
 * app.js — PMG India Note Entry System
 * All application logic. Reads sensitive values from window.CONFIG
 * which is injected by config.js (generated from .env).
 */

/* ══════════════════════════════════════════════
   GUARD — fail loudly if config is missing
══════════════════════════════════════════════ */
if (!window.CONFIG || !window.CONFIG.GAS_URL || !window.CONFIG.SHEET_ID) {
  document.body.innerHTML =
    '<div style="font-family:monospace;padding:40px;color:#f43f5e;background:#080b10;min-height:100vh">' +
    '<h2>⚠ config.js not loaded</h2>' +
    '<p style="margin-top:12px;color:#94a3c4">Make sure <code>js/config.js</code> exists and is loaded before <code>js/app.js</code>.</p>' +
    '</div>';
  throw new Error('CONFIG not found — js/config.js must be loaded first.');
}

/* ══════════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════════ */
const GAS_URL     = window.CONFIG.GAS_URL;
const SHEET_ID    = window.CONFIG.SHEET_ID;
const SHEET_URL   = window.CONFIG.SHEET_URL;
const STORAGE_KEY = 'noteEntries_v1';
const TWO_WEEKS   = 14 * 24 * 60 * 60 * 1000;

/* ══════════════════════════════════════════════
   STATE
══════════════════════════════════════════════ */
let sessionCount = 0;
let totalCount   = parseInt(localStorage.getItem('totalCount') || '0');
let selected     = new Set();

/* ══════════════════════════════════════════════
   APPS SCRIPT TEMPLATE
   (shown inside the collapsible setup panel
    for first-time setup — Sheet ID injected
    from config, never hardcoded in HTML)
══════════════════════════════════════════════ */
const GAS_SCRIPT = `// ══ PASTE THIS ENTIRE SCRIPT — then Deploy as New Version ══
// Execute as: Me  |  Who has access: Anyone

function doPost(e) {
  var sheet = SpreadsheetApp.openById('${SHEET_ID}').getActiveSheet();

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Date Filled','Serial No','Client Name','Place','Contact No','Email',
      'Services','Up to Slab','Fees','Note Serial','Denomination','Governor',
      'Prefix','Insert','Watermark','Year','Reference','Customer Demand',
      'Remark','Submitted At'
    ]);
  }

  var d = {};
  try {
    d = JSON.parse(e.postData.contents);
  } catch(err) {
    try { d = JSON.parse(e.parameter.data || '{}'); } catch(e2) { d = {}; }
  }

  sheet.appendRow([
    d.date||'', d.serial||'', d.client||'', d.place||'', d.contact||'', d.email||'',
    d.services||'', d.slab||'', d.fees||'', d.noteserial||'', d.denom||'', d.governor||'',
    d.prefix||'', d.insert||'', d.watermark||'', d.year||'', d.ref||'', d.demand||'',
    d.remark||'', new Date().toLocaleString('en-IN')
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ status: 'success' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  var rows = SpreadsheetApp.openById('${SHEET_ID}').getActiveSheet().getLastRow();
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', rows: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

/* ══════════════════════════════════════════════
   INIT — runs on DOMContentLoaded
══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // Inject GAS script template into the collapsible setup panel
  const gasCodeEl = document.getElementById('gas-code');
  if (gasCodeEl) gasCodeEl.textContent = GAS_SCRIPT;

  // Wire up the "Open Spreadsheet" nav link
  const sheetLink = document.getElementById('sheet-link');
  if (sheetLink) sheetLink.href = SHEET_URL;

  // Date
  const today = new Date();
  const dateInput = document.getElementById('f-date');
  if (dateInput) dateInput.value = today.toISOString().split('T')[0];

  const liveDateEl = document.getElementById('live-date');
  if (liveDateEl) {
    liveDateEl.textContent = today.toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  // Stats
  document.getElementById('s-total').textContent = totalCount;

  // GAS status indicator — always live since URL comes from config
  const statusEl = document.getElementById('s-status');
  if (GAS_URL && !GAS_URL.includes('YOUR_DEPLOYMENT_ID')) {
    if (statusEl) {
      statusEl.textContent = '✓ Live';
      statusEl.style.color = 'var(--teal)';
    }
    // Collapse the setup panel if GAS is configured
    const banner = document.getElementById('gas-banner');
    if (banner) banner.style.display = 'none';
  } else {
    if (statusEl) {
      statusEl.textContent = '⚠ Not set';
      statusEl.style.color = '#fbbf24';
    }
  }

  renderTable();
});

/* ══════════════════════════════════════════════
   TEST CONNECTION
══════════════════════════════════════════════ */
async function testConnection() {
  const r = document.getElementById('gas-test-result');
  r.style.display = 'block';
  r.innerHTML = '⏳ Step 1: Testing GET connection…';

  try {
    const res  = await fetch(GAS_URL);
    const text = await res.text();
    let p = null;
    try { p = JSON.parse(text); } catch {}

    if (p && p.status === 'ok') {
      const rowsBefore = parseInt(p.rows) || 0;
      r.innerHTML = '✅ GET OK — ' + Math.max(0, rowsBefore - 1) + ' data rows in sheet.<br>⏳ Step 2: Sending test POST…';

      try {
        await fetch(GAS_URL, {
          method:  'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body:    JSON.stringify({ date:'TEST', serial:'TEST-ROW', client:'__TEST__', place:'Test', fees:'0', services:'Test', denom:'Test', governor:'Test' }),
          mode:    'no-cors'
        });
        setTimeout(async () => {
          try {
            const r2 = await fetch(GAS_URL);
            const p2 = JSON.parse(await r2.text());
            if (p2.rows > rowsBefore) {
              r.innerHTML = '<span style="color:var(--teal)">✅ FULLY WORKING! GET + POST confirmed. Test row added (row ' + p2.rows + '). You can delete the TEST row from your sheet.</span>';
            } else {
              r.innerHTML = '<span style="color:#fbbf24">⚠ GET works but POST row did not appear. Re-deploy the Apps Script as a NEW version.</span>';
            }
          } catch (e2) {
            r.innerHTML = '<span style="color:var(--teal)">✅ GET OK. POST sent. If data is missing, re-deploy the script as a new version.</span>';
          }
        }, 2500);
      } catch (pe) {
        r.innerHTML = '<span style="color:var(--red)">✅ GET OK but POST failed: ' + pe.message + '</span>';
      }

    } else {
      r.innerHTML = '<span style="color:#fbbf24">⚠ Wrong format — likely a Google login redirect.<br>'
        + 'Fix: "Who has access" must be <strong>Anyone</strong> (not "Anyone with Google account").<br>'
        + 'Raw: <code>' + text.slice(0, 120) + '</code></span>';
    }
  } catch (e) {
    r.innerHTML = '<span style="color:var(--red)">❌ ' + e.message + '<br>Check: URL ends in <code>/exec</code>, deployed as Web App.</span>';
  }
}

/* ══════════════════════════════════════════════
   LOCAL STORAGE HELPERS
══════════════════════════════════════════════ */
function loadEntries() {
  try {
    const all   = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const fresh = all.filter(e => (Date.now() - e._savedAt) < TWO_WEEKS);
    if (fresh.length !== all.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  } catch { return []; }
}

function saveEntries(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function addEntry(payload) {
  const list  = loadEntries();
  const entry = { ...payload, _savedAt: Date.now(), _id: Date.now() + '_' + Math.random().toString(36).slice(2) };
  list.unshift(entry);
  saveEntries(list);
  renderTable();
}

function deleteEntry(id) {
  selected.delete(id);
  saveEntries(loadEntries().filter(e => e._id !== id));
  updateBillBtn();
  renderTable();
  showToast('Entry removed', 'success');
}

function clearAll() {
  if (!confirm('Remove all local entries? Your Google Sheet data is unaffected.')) return;
  localStorage.removeItem(STORAGE_KEY);
  selected.clear();
  updateBillBtn();
  renderTable();
  showToast('All entries cleared', 'success');
}

/* ══════════════════════════════════════════════
   RENDER TABLE
══════════════════════════════════════════════ */
function renderTable() {
  const all   = loadEntries();
  const q     = (document.getElementById('entry-search')?.value || '').trim().toLowerCase();
  const govF  = document.getElementById('filter-gov')?.value || '';

  let list = all;
  if (q)    list = list.filter(e => [e.client, e.serial, e.denom, e.noteserial, e.governor, e.place].some(v => v && v.toLowerCase().includes(q)));
  if (govF) list = list.filter(e => e.governor === govF);

  const metaEl = document.getElementById('meta-txt');
  if (metaEl) {
    metaEl.textContent = all.length === 0
      ? 'No entries yet'
      : (q || govF)
        ? `${list.length} of ${all.length} entries matched`
        : `${all.length} entr${all.length === 1 ? 'y' : 'ies'} saved locally`;
  }

  const tbody = document.getElementById('ntbl-body');
  const now   = Date.now();

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="tbl-empty">
      <span class="ei">${q || govF ? '🔍' : '📭'}</span>
      <p>${q || govF ? 'No entries match.' : 'No entries yet.'}</p>
      <small>${q || govF ? 'Try a different filter.' : 'Submit your first entry above.'}</small>
    </td></tr>`;
    const sa = document.getElementById('chk-all');
    if (sa) { sa.checked = false; sa.indeterminate = false; }
    return;
  }

  tbody.innerHTML = list.map(e => {
    const elapsed  = now - e._savedAt;
    const daysLeft = Math.ceil((TWO_WEEKS - elapsed) / (1000 * 60 * 60 * 24));
    const dayClass = daysLeft > 7 ? 'day-ok' : daysLeft > 3 ? 'day-warn' : 'day-crit';
    const isChecked = selected.has(e._id);
    const savedFmt  = new Date(e._savedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    return `<tr class="${isChecked ? 'sel' : ''}" id="row-${e._id}">
      <td><input type="checkbox" class="tbl-chk row-chk" data-id="${e._id}" ${isChecked ? 'checked' : ''} onchange="toggleRow(this)"></td>
      <td class="td-serial">${e.serial || '—'}</td>
      <td class="td-mono" style="font-size:11px">${e.date || savedFmt}</td>
      <td class="td-client">${e.client || '—'}</td>
      <td><span class="td-denom">${e.denom || '—'}</span></td>
      <td class="td-gov">${e.governor || '—'}</td>
      <td class="td-mono">${e.noteserial || '—'}</td>
      <td class="td-mono">${[e.prefix, e.insert].filter(Boolean).join(' / ') || '—'}</td>
      <td class="td-mono">${e.year || '—'}</td>
      <td class="td-fees">${e.fees ? '₹' + Number(e.fees).toLocaleString('en-IN') : '—'}</td>
      <td><span class="day-chip ${dayClass}">${daysLeft}d</span></td>
      <td><button class="btn-del" onclick="deleteEntry('${e._id}')" title="Delete">✕</button></td>
    </tr>`;
  }).join('');

  syncSelectAll();
}

/* ── Checkbox helpers ── */
function toggleRow(cb) {
  const id  = cb.getAttribute('data-id');
  const row = document.getElementById('row-' + id);
  if (cb.checked) {
    selected.add(id);
    row?.classList.add('sel');
  } else {
    selected.delete(id);
    row?.classList.remove('sel');
  }
  syncSelectAll();
  updateBillBtn();
}

function toggleAll(cb) {
  document.querySelectorAll('.row-chk').forEach(b => {
    b.checked = cb.checked;
    const id  = b.getAttribute('data-id');
    const row = document.getElementById('row-' + id);
    if (cb.checked) { selected.add(id); row?.classList.add('sel'); }
    else            { selected.delete(id); row?.classList.remove('sel'); }
  });
  updateBillBtn();
}

function syncSelectAll() {
  const sa    = document.getElementById('chk-all');
  const boxes = document.querySelectorAll('.row-chk');
  if (!sa || !boxes.length) return;
  const total   = boxes.length;
  const checked = Array.from(boxes).filter(b => b.checked).length;
  sa.checked       = checked === total;
  sa.indeterminate = checked > 0 && checked < total;
}

function updateBillBtn() {
  const btn = document.getElementById('bill-btn');
  const cnt = document.getElementById('bill-cnt');
  if (selected.size > 0) {
    btn?.classList.add('show');
    if (cnt) cnt.textContent = selected.size;
  } else {
    btn?.classList.remove('show');
  }
}

/* ══════════════════════════════════════════════
   BILL MODAL
══════════════════════════════════════════════ */
function openBillModal() {
  if (selected.size === 0) { showToast('Select at least one note first', 'error'); return; }

  const entries = loadEntries().filter(e => selected.has(e._id));
  const first   = entries[0] || {};

  document.getElementById('b-date').value     = new Date().toISOString().split('T')[0];
  document.getElementById('b-customer').value = first.client  || '';
  document.getElementById('b-address').value  = first.place   || '';
  document.getElementById('b-mobile').value   = first.contact || '';
  document.getElementById('b-email').value    = first.email   || '';

  const cntEl  = document.getElementById('modal-cnt');
  const infoEl = document.getElementById('modal-info');
  if (cntEl)  cntEl.textContent = selected.size;
  if (infoEl) infoEl.innerHTML  = `Selected <strong>${selected.size}</strong> note${selected.size !== 1 ? 's' : ''} for bill generation`;

  document.getElementById('bill-modal')?.classList.add('open');
}

function closeBillModal() {
  document.getElementById('bill-modal')?.classList.remove('open');
}

// Close on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bill-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeBillModal();
  });
});

/* ══════════════════════════════════════════════
   PRINT BILL  (PMG India Submission Form)
══════════════════════════════════════════════ */
function printBill() {
  const required = [
    { id: 'b-date',     label: 'Date' },
    { id: 'b-customer', label: 'Customer Name' },
    { id: 'b-address',  label: 'Address' },
    { id: 'b-mobile',   label: 'Mobile' },
    { id: 'b-email',    label: 'Email' },
  ];
  for (const f of required) {
    if (!document.getElementById(f.id)?.value.trim()) {
      showToast('Please fill: ' + f.label, 'error');
      document.getElementById(f.id)?.focus();
      return;
    }
  }

  const g = id => document.getElementById(id)?.value.trim() || '';
  const bill = {
    subno:    g('b-subno'),
    date:     g('b-date'),
    customer: g('b-customer'),
    address:  g('b-address'),
    nearopp:  g('b-nearopp'),
    city:     g('b-city'),
    pin:      g('b-pin'),
    mobile:   g('b-mobile'),
    email:    g('b-email'),
  };

  const notes = loadEntries().filter(e => selected.has(e._id));
  let totalFees = 0, totalDecl = 0;

  const fmtDate = s => { const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString('en-GB'); };
  const svcs       = notes.map(n => (n.services || '').toLowerCase());
  const hasGrading = svcs.some(s => s.includes('grading'));
  const hasPreserv = svcs.some(s => s.includes('preserv'));
  const ck = on => `<span style="width:11px;height:11px;border:1px solid #000;display:inline-block;position:relative;vertical-align:middle">${on ? '<span style="position:absolute;top:-2px;left:1px;font-size:11px;font-weight:bold">✓</span>' : ''}</span>`;

  const rows = notes.map((n, i) => {
    const fees = parseFloat(n.fees) || 0;
    const decl = parseFloat(n.declared_value) || 0;
    totalFees += fees;
    totalDecl += decl;
    return `<tr>
      <td style="text-align:center;padding:5px 3px;border:1px solid #000;font-size:9px">${i + 1}</td>
      <td style="padding:5px 3px;border:1px solid #000;font-size:9px">${n.denom || ''}</td>
      <td style="padding:5px 3px;border:1px solid #000;font-size:9px">${[n.prefix, n.insert, n.noteserial, n.year].filter(Boolean).join(', ')}</td>
      <td style="padding:5px 3px;border:1px solid #000;font-size:9px">${n.governor || ''}</td>
      <td style="padding:5px 3px;border:1px solid #000;font-size:9px">${n.services || ''}</td>
      <td style="padding:5px 3px;border:1px solid #000;font-size:9px">${n.category || ''}</td>
      <td style="text-align:right;padding:5px 3px;border:1px solid #000;font-size:9px">${decl > 0 ? decl.toFixed(0) : ''}</td>
      <td style="text-align:right;padding:5px 3px;border:1px solid #000;font-size:9px">${fees > 0 ? fees.toFixed(0) : ''}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PMG India Submission Form</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;padding:15px;background:#fff;color:#000;font-size:10px;line-height:1.3}
@page{size:A4;margin:8mm}
@media print{body{margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.container{width:194mm;min-height:281mm;margin:0 auto;border:1px solid #000;padding:10px}}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;padding-bottom:8px;border-bottom:2px solid #000}
.logo-section{display:flex;align-items:center;gap:10px}
.logo{width:100px;height:70px;display:flex;align-items:center;justify-content:center}
.company-info h1{font-size:16px;font-weight:bold;margin:0}
.company-info h2{font-size:11px;margin:2px 0;font-weight:bold}
.company-info p{font-size:9px;margin:0}
.header-right{text-align:right;font-size:8px;line-height:1.5}
.form-title{text-align:center;font-size:13px;font-weight:bold;margin:6px 0;text-decoration:underline}
.reg-section{background:#f0f0f0;padding:4px 6px;margin-bottom:8px;font-size:9px;border:1px solid #000}
.form-row{display:flex;margin-bottom:5px;font-size:9px;align-items:center}
.form-row label{min-width:120px}
.form-row .value{flex:1;border-bottom:1px solid #000;padding:0 3px;min-height:16px}
.form-row-split{display:flex;gap:10px;margin-bottom:5px;font-size:9px}
.form-row-split>div{flex:1;display:flex;align-items:center}
.form-row-split label{min-width:60px}
.form-row-split .value{flex:1;border-bottom:1px solid #000;padding:0 3px;min-height:16px}
.services-section{margin:6px 0;font-size:9px;display:flex;gap:12px;flex-wrap:wrap}
.details-section{margin:8px 0}
.details-section h3{background:#e0e0e0;padding:4px 6px;font-size:10px;font-weight:bold;margin-bottom:4px;border:1px solid #000}
table.details{width:100%;border-collapse:collapse;font-size:9px}
table.details th{background:#f0f0f0;border:1px solid #000;padding:5px 3px;text-align:center;font-weight:bold;font-size:8px;line-height:1.2}
table.details td{border:1px solid #000;padding:5px 3px;font-size:9px}
.totals-row{display:flex;justify-content:space-between;margin:8px 0;padding:6px;background:#f9f9f9;border:1px solid #000;font-weight:bold;font-size:9px}
table.charges{border-collapse:collapse;font-size:8px;margin-bottom:6px;width:70%}
table.charges th,table.charges td{border:1px solid #000;padding:3px 4px;text-align:center}
table.charges th{background:#f0f0f0;font-weight:bold}
table.charges tbody tr:nth-child(odd){background:#d9d9d9}
table.charges tbody tr:nth-child(even){background:#fff}
.signatures{display:flex;justify-content:space-between;margin-top:20px;font-size:9px}
.signature-box{text-align:center;width:45%}
.signature-line{margin-top:25px;border-top:1px solid #000;padding-top:3px}
.footer-note{margin-top:10px;font-size:7px;text-align:center;line-height:1.4}
</style></head><body>
<div class="container">
  <div class="header">
    <div class="logo-section">
      <img src="images/PMG_LOGO.png" class="logo" alt="PMG Logo">
      <div class="company-info">
        <h1>PMG India</h1>
        <h2>GRADE FOR NEXT GENERATION</h2>
        <p>Paper Money Grading &amp; Preservation Service</p>
      </div>
    </div>
    <div class="header-right">
      <div>Website – www.pmgindia.org</div>
      <div>Email – arihantgroup9999@gmail.com</div>
      <div>Phone – 9967374750</div>
    </div>
  </div>

  <div class="form-title">Submission Form</div>
  <div class="reg-section"><strong>Regd. Office</strong> - Shop No 23 Koyna CHS, Shantivan, Borivali (E), Mumbai- 400066</div>

  <div class="form-row">
    <label>Submission Form No:</label>
    <div class="value" style="flex:0.6">${bill.subno}</div>
    <label style="margin-left:30px;min-width:50px">Date:</label>
    <div class="value" style="flex:0.4">${fmtDate(bill.date)}</div>
  </div>
  <div class="form-row"><label>Customer/Dealer Name -</label><div class="value">${bill.customer}</div></div>
  <div class="form-row"><label>Address-</label><div class="value">${bill.address}</div></div>
  <div class="form-row-split">
    <div><label>Near/Opp</label><div class="value">${bill.nearopp}</div></div>
    <div><label>City</label><div class="value">${bill.city}</div></div>
    <div style="flex:0.5"><label>Pin</label><div class="value">${bill.pin}</div></div>
  </div>
  <div class="form-row-split">
    <div><label>Mobile-</label><div class="value">${bill.mobile}</div></div>
    <div><label>Email -</label><div class="value">${bill.email}</div></div>
  </div>

  <div style="font-size:9px;margin:6px 0">
    <strong>Types of Services from PMGIndia –</strong>
    <div class="services-section" style="margin-top:3px">
      <span>${ck(hasGrading)} Grading</span>
      <span>${ck(hasPreserv)} Preservation</span>
      <span>${ck(false)} Re Grading</span>
      <span>${ck(false)} Cross over</span>
      <span>${ck(false)} Other</span>
    </div>
  </div>

  <div class="details-section">
    <h3>Submission Details</h3>
    <table class="details">
      <thead>
        <tr>
          <th rowspan="2">Sr.No</th>
          <th rowspan="2">Denomination<br><span style="font-size:7px">Example:(Rs.5)</span></th>
          <th rowspan="2">Prefix,Inset,Number,Year<br><span style="font-size:7px">Example:(11A 111111)</span></th>
          <th rowspan="2">Governor<br><span style="font-size:7px">Example:(Y.V.Reddy)</span></th>
          <th rowspan="2">Services<br><span style="font-size:7px">Example:(Grading)</span></th>
          <th rowspan="2">Category<br><span style="font-size:7px">Example:(Normal)</span></th>
          <th>Declared<br>Value</th>
          <th>Fees</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>

  <div class="totals-row">
    <div>Total Items - ${notes.length}</div>
    <div>Total Declared Value - ${totalDecl.toFixed(0)}</div>
    <div>Total - ${totalFees.toFixed(0)}</div>
  </div>

  <div style="margin:10px 0">
    <div style="font-size:9px;font-weight:bold;margin-bottom:4px">
      Charges for Standard Slabs <span style="color:#666">Up to 210 mm X 130mm</span>
    </div>
    <table class="charges">
  <thead>
    <tr>
      <th>Up To Slab</th>
      <th>Grading / Note</th>
      <th>205 × 128 mm</th>
      <th>225 × 185 mm</th>
      <th>210 × 297 mm</th>
    </tr>
  </thead>

  <tbody>

    <!-- GRADING -->
    <tr>
      <td>5,000</td>
      <td>300 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <tr>
      <td>10,000</td>
      <td>500 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <tr>
      <td>25,000</td>
      <td>700 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <tr>
      <td>50,000</td>
      <td>950 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <tr>
      <td>1,00,000</td>
      <td>1200 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <!-- PRESERVATION -->
    <tr>
      <td colspan="5"><strong>Preservation</strong></td>
    </tr>

    <tr>
      <td>&lt; 50,000</td>
      <td>-</td>
      <td>400</td>
      <td>1000</td>
      <td>1500</td>
    </tr>

    <tr>
      <td>&gt; 50,000</td>
      <td>-</td>
      <td>800</td>
      <td>1500</td>
      <td>2100</td>
    </tr>

    <!-- GENUINITY -->
    <tr>
      <td colspan="5"><strong>Genuinity</strong></td>
    </tr>

    <tr>
      <td>≤ 50,000</td>
      <td>200 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

    <tr>
      <td>&gt; 50,000</td>
      <td>700 +</td>
      <td>300</td>
      <td>900</td>
      <td>1300</td>
    </tr>

  </tbody>
</table>
    <div style="font-size:7px">*Charges for Customized Slabs will be as per order and Declared Value decided by PMGIndia Authorities</div>
  </div>

  <div class="signatures">
    <div class="signature-box"><div class="signature-line">Sign of Customer</div></div>
    <div class="signature-box"><div class="signature-line">Sign of PMG India Authority</div></div>
  </div>

  <div class="footer-note">
    By submitting this form, I confirm that I have read and accepted the PMGIndia Grading Terms, Conditions and Standards.<br>
    *All Submissions and Deliveries done from Mumbai Office and I accept all terms and condition of PMG India
  </div>
</div>
<script>window.onload = function(){ setTimeout(function(){ window.print(); }, 500); }<\/script>
</body></html>`;

  const pw = window.open('', '_blank', 'width=900,height=800');
  if (!pw) { showToast('Pop-up blocked! Allow pop-ups to print.', 'error'); return; }
  pw.document.write(html);
  pw.document.close();
  closeBillModal();
}

/* ══════════════════════════════════════════════
   SUBMIT FORM
══════════════════════════════════════════════ */
async function submitForm() {
  const get = id => (document.getElementById(id)?.value || '').trim();

  const required = [
    { id: 'f-serial',   label: 'Serial No' },
    { id: 'f-client',   label: 'Client Name' },
    { id: 'f-place',    label: 'Place' },
    { id: 'f-fees',     label: 'Fees' },
    { id: 'f-services', label: 'Services' },
    { id: 'f-denom',    label: 'Denomination' },
    { id: 'f-governor', label: 'Governor' },
  ];

  for (const f of required) {
    if (!get(f.id)) {
      showToast('⚠ Please fill: ' + f.label, 'error');
      document.getElementById(f.id)?.focus();
      return;
    }
  }

  if (!GAS_URL || GAS_URL.includes('YOUR_DEPLOYMENT_ID')) {
    showToast('⚠ GAS_URL not set in config.js', 'error');
    return;
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 38 38" stroke="currentColor">
    <g fill="none" stroke-width="2">
      <circle stroke-opacity=".3" cx="19" cy="19" r="15"/>
      <path d="M19 4a15 15 0 0 1 15 15">
        <animateTransform attributeName="transform" type="rotate" from="0 19 19" to="360 19 19" dur="0.8s" repeatCount="indefinite"/>
      </path>
    </g></svg> Saving…`;

  const payload = {
    date:       get('f-date'),
    serial:     get('f-serial'),
    client:     get('f-client'),
    place:      get('f-place'),
    contact:    get('f-contact'),
    email:      get('f-email'),
    services:   get('f-services'),
    slab:       get('f-slab'),
    fees:       get('f-fees'),
    noteserial: get('f-noteserial'),
    denom:      get('f-denom'),
    governor:   get('f-governor'),
    prefix:     get('f-prefix'),
    insert:     get('f-insert'),
    watermark:  get('f-watermark'),
    year:       get('f-year'),
    ref:        get('f-ref'),
    demand:     get('f-demand'),
    remark:     get('f-remark'),
  };

  // Step 1 — Save locally immediately (never fails)
  addEntry(payload);
  sessionCount++;
  totalCount++;
  document.getElementById('s-session').textContent = sessionCount;
  document.getElementById('s-total').textContent   = totalCount;
  localStorage.setItem('totalCount', totalCount);

  const keepDate = get('f-date');
  resetForm();
  document.getElementById('f-date').value = keepDate;

  setTimeout(() => {
    document.querySelector('.notes-hdr')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 400);

  // Step 2 — Send to Google Sheets
  // Content-Type: text/plain avoids CORS preflight (simple request).
  // mode: no-cors never throws unless genuine network failure.
  try {
    await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body:    JSON.stringify(payload),
      mode:    'no-cors',
    });
    showToast('✅ Saved locally & sent to Google Sheets!', 'success');
  } catch (err) {
    showToast('💾 Saved locally. Network error: ' + err.message, 'error');
    console.error('GAS POST error:', err);
  }

  btn.disabled = false;
  btn.innerHTML = `<svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
  </svg> Save Entry to Sheets`;
}

/* ══════════════════════════════════════════════
   RESET FORM
══════════════════════════════════════════════ */
function resetForm() {
  [
    'f-serial', 'f-client', 'f-place', 'f-contact', 'f-email',
    'f-services', 'f-slab', 'f-fees', 'f-noteserial', 'f-denom',
    'f-governor', 'f-prefix', 'f-insert', 'f-watermark',
    'f-year', 'f-ref', 'f-demand', 'f-remark',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/* ══════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════ */
function showToast(msg, type) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.className = 'toast ' + (type || '') + ' show';
  setTimeout(() => t.classList.remove('show'), 3800);
}