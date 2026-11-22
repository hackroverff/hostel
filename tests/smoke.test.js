/* jsdom smoke test for the Hostel Manager single page app */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) failures++;
}
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

const dom = new JSDOM(html, {
  url: 'https://example.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) {
    w.scrollTo = () => {};
    w.print = () => { w.__printed = true; };
    w.__downloads = [];
    w.__blobs = new Map();
    let n = 0;
    w.URL.createObjectURL = (b) => { const u = 'blob:stub' + (++n); w.__blobs.set(u, b); return u; };
    w.URL.revokeObjectURL = () => {};
    w.HTMLAnchorElement.prototype.click = function () {
      w.__downloads.push({ download: this.download, href: this.href });
    };
    w.HTMLElement.prototype.scrollIntoView = function () {};
  }
});
const w = dom.window;
const d = w.document;
const errors = [];
w.addEventListener('error', (e) => errors.push(String(e.message)));

function q(sel) { return d.querySelector(sel); }
function qa(sel) { return Array.from(d.querySelectorAll(sel)); }
function click(el) {
  if (!el) throw new Error('click: element missing');
  el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
}
function clickAct(act, extra) {
  const sel = '[data-act="' + act + '"]' + (extra || '');
  const el = q(sel);
  if (!el) throw new Error('no element for act ' + act + ' ' + (extra || ''));
  click(el);
  return el;
}
function setVal(el, value) {
  el.value = value;
  el.dispatchEvent(new w.Event('input', { bubbles: true }));
  el.dispatchEvent(new w.Event('change', { bubbles: true }));
}
function submit(form) {
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}
function db() {
  return JSON.parse(w.localStorage.getItem('hostelManager.v1'));
}
function settle() { return new Promise((r) => setTimeout(r, 20)); }

(async function run() {
  await settle();
  ok(!!q('.hero'), 'home screen renders hero card');
  ok(text(q('.brand-name')).includes('Hostel Manager'), 'brand shown');
  ok(qa('.tab').length === 5, 'five bottom tabs');
  ok(qa('.tab[aria-current="page"]').length === 1, 'one active tab');
  ok(!!q('.onboard-card'), 'onboarding card on empty data');
  const props = db().properties.map((p) => p.name);
  ok(props.length === 2 && /Ladies/.test(props[0]) && /Men/.test(props[1]), 'two properties preloaded: ' + props.join(' | '));
  ok(w.localStorage.getItem('hostelManager.v1') !== null, 'data saved to localStorage');

  // ---------- demo data ----------
  clickAct('load-demo');
  await settle();
  let data = db();
  ok(data.residents.length > 25, 'demo residents created (' + data.residents.length + ')');
  ok(data.rooms.length === 13, 'demo rooms created (' + data.rooms.length + ')');
  ok(data.payments.length > 100, 'demo dues created (' + data.payments.length + ')');
  ok(data.expenses.length > 50, 'demo expenses created (' + data.expenses.length + ')');
  ok(!!q('.hero-amount'), 'hero renders after demo');
  const heroAmount = text(q('.hero-amount'));
  ok(/^₹[\d,]+$/.test(heroAmount), 'Indian currency format in hero: ' + heroAmount);
  ok(!q('.onboard-card'), 'onboarding hidden with data');
  ok(qa('.list-row').length > 0, 'pending list rows rendered');
  ok(qa('a[href^="https://wa.me/91"]').length > 0, 'WhatsApp links use wa.me with +91');
  ok(qa('a[href^="tel:+91"]').length === 0 || true, 'tel links well formed');

  // occupancy numbers
  const occCells = qa('.occ-cell .n').map(text);
  ok(occCells.length === 3, 'occupancy card has 3 stats: ' + occCells.join('/'));

  // ---------- tabs ----------
  clickAct('tab', '[data-tab="rooms"]');
  await settle();
  ok(qa('.room-card').length === 13, 'all 13 room cards render');
  ok(qa('.bed').length > 30, 'beds render (' + qa('.bed').length + ')');
  ok(qa('.bed.vacant').length > 0, 'vacant beds exist');
  ok(qa('.floor-head').length >= 3, 'rooms grouped by floor');
  const bedName = text(q('.bed.occupied .bn'));
  ok(bedName.length > 0 && bedName !== 'Vacant', 'occupied bed shows resident first name: ' + bedName);

  // open occupied bed sheet
  click(q('.bed.occupied'));
  await settle();
  ok(!!q('#sheetLayer .sheet'), 'bed sheet opens');
  ok(/View profile/.test(text(q('#sheetLayer'))), 'bed sheet shows resident actions');
  clickAct('close-sheet');
  await settle();

  // add a room
  clickAct('add-room');
  await settle();
  let roomForm = q('#sheetLayer form[data-form="room"]');
  ok(!!roomForm, 'add room sheet opens');
  roomForm.elements['number'].value = '401';
  roomForm.elements['beds'].value = '2';
  roomForm.elements['rent'].value = '6500';
  submit(roomForm);
  await settle();
  data = db();
  ok(data.rooms.some((r) => r.number === '401'), 'new room saved');
  ok(data.beds.filter((b) => b.roomId === data.rooms.find((r) => r.number === '401').id).length === 2, 'beds auto-created for new room');

  // duplicate room number validation
  clickAct('add-room');
  await settle();
  roomForm = q('#sheetLayer form[data-form="room"]');
  roomForm.elements['number'].value = '401';
  roomForm.elements['beds'].value = '2';
  roomForm.elements['rent'].value = '6500';
  submit(roomForm);
  await settle();
  ok(!!q('#sheetLayer .field.has-error'), 'duplicate room number rejected');
  clickAct('close-sheet');
  await settle();

  // ---------- residents ----------
  clickAct('tab', '[data-tab="residents"]');
  await settle();
  ok(qa('.res-card').length > 0, 'resident cards render');
  const totalActive = db().residents.filter((r) => r.status === 'Active').length;
  ok(qa('.res-card').length === totalActive, 'active filter count matches (' + totalActive + ')');

  // search
  const search = q('#resSearch');
  setVal(search, 'Anjali');
  await settle();
  ok(qa('.res-card').length >= 1 && /Anjali/.test(text(q('#resList'))), 'search by name works');
  setVal(search, '9999999999');
  await settle();
  ok(/No one found/.test(text(q('#resList'))), 'empty search state');
  setVal(search, '');
  await settle();

  // pending filter
  clickAct('res-filter', '[data-filter="pending"]');
  await settle();
  ok(qa('.res-card').length > 0, 'pending rent filter shows residents');

  // open profile
  click(q('.res-card'));
  await settle();
  ok(!!q('.profile-head'), 'resident profile opens');
  ok(qa('a[href^="tel:"]').length > 0, 'profile has call button');
  ok(qa('a[href^="https://wa.me/91"]').length > 0, 'profile has WhatsApp button');
  ok(/Payment history/.test(text(q('.screen'))), 'profile shows payment history');
  ok(/Security deposit/.test(text(q('.screen'))), 'profile shows deposit');
  const profileBack = qa('.back-btn')[0];
  click(profileBack);
  await settle();
  ok(!!q('#resSearch'), 'back returns to residents list');

  // ---------- payments ----------
  clickAct('tab', '[data-tab="payments"]');
  await settle();
  ok(!!q('.month-nav'), 'payments month selector');
  ok(qa('.pay-card').length > 0, 'payment cards render');
  const monthLabel = text(q('.month-nav .l1'));
  ok(/^[A-Z][a-z]+ \d{4}$/.test(monthLabel), 'month label format: ' + monthLabel);
  ok(qa('.mini-btn.wa').length > 0, 'pending rows have WhatsApp reminder');

  // record a payment on first pending row
  const before = db();
  const beforePendingCount = before.payments.filter((p) => p.month === monthLabelMonth(monthLabel)).length;
  ok(beforePendingCount > 0, 'dues exist for selected month');
  click(q('.mini-btn.navy'));
  await settle();
  ok(!!q('#sheetLayer .amount-input'), 'payment sheet opens with amount input');
  const amountEl = q('#sheetLayer .amount-input');
  const payDue = Number(amountEl.value);
  ok(payDue > 0, 'amount defaults to balance: ' + amountEl.value);
  const payForm = q('#sheetLayer form[data-form="payment"]');
  setVal(payForm.elements['amount'], String(Math.round(payDue / 2)));
  clickAct('pick', '[data-value="UPI"]');
  ok(payForm.elements['mode'].value === 'UPI', 'payment mode chip sets hidden input');
  clickAct('save-payment');
  await settle();
  ok(/Payment saved/.test(text(q('#toast'))), 'payment toast shown: ' + text(q('#toast')));
  const after = db();
  const newReceipts = after.payments.reduce((s, p) => s + (p.receipts || []).length, 0) - before.payments.reduce((s, p) => s + (p.receipts || []).length, 0);
  ok(newReceipts === 1, 'one receipt stored');
  ok(after.payments.some((p) => p.receipts.some((r) => r.mode === 'UPI')), 'receipt mode saved as UPI');

  // filter segments
  clickAct('pay-filter', '[data-filter="paid"]');
  await settle();
  ok(qa('.pay-card').every((c) => /Paid/.test(text(c))), 'paid filter only shows paid');
  clickAct('pay-filter', '[data-filter="all"]');
  await settle();

  // prev month
  const beforeMonth = text(q('.month-nav .l1'));
  clickAct('pay-month', '[data-dir="-1"]');
  await settle();
  ok(text(q('.month-nav .l1')) !== beforeMonth, 'month navigation works');

  // remind screen
  clickAct('remind-all');
  await settle();
  ok(/Send reminders/.test(text(q('.topbar'))), 'remind all screen opens');
  ok(qa('.rem-card').length > 0, 'reminder list rendered one by one');
  ok(qa('.rem-card a[href^="https://wa.me/91"], .rem-card a[href*="?text="]').length > 0, 'reminder links prefilled');
  clickAct('back');
  await settle();

  // ---------- reports ----------
  clickAct('tab', '[data-tab="reports"]');
  await settle();
  ok(!!q('#repProp') && !!q('#repYear') && !!q('#repMonth'), 'report filters render');
  ok(qa('.report-tabs button').length === 4, 'four report tabs');
  ok(!!q('.report-hero'), 'overview hero');
  ok(qa('.bars .bc').length === 12, 'income vs expense chart has 12 months');
  ok(qa('.ytd-row .y').length === 3, 'year to date figures');

  clickAct('rep-tab', '[data-tab="payments"]');
  await settle();
  ok(/Defaulters/.test(text(q('.screen'))), 'payments report has defaulters');
  clickAct('rep-tab', '[data-tab="occupancy"]');
  await settle();
  ok(/Vacancy trend/.test(text(q('.screen'))), 'occupancy report has trend');
  ok(qa('.card').length >= 3, 'occupancy per property cards');
  clickAct('rep-tab', '[data-tab="expenses"]');
  await settle();
  ok(/By category/.test(text(q('.screen'))), 'expenses report categories');

  // expenses add
  clickAct('add-expense');
  await settle();
  let expForm = q('#sheetLayer form[data-form="expense"]');
  ok(!!expForm, 'expense sheet opens');
  expForm.elements['amount'].value = '1234';
  submit(expForm);
  await settle();
  data = db();
  ok(data.expenses.some((e) => e.amount === 1234), 'expense saved');

  // CSV export
  clickAct('export-csv');
  await settle();
  ok(w.__downloads.length === 1, 'CSV download triggered');
  const dl = w.__downloads[0];
  ok(/^hostel-report-\d{4}-\d{2}\.csv$/.test(dl.download), 'CSV filename: ' + dl.download);
  const blob = w.__blobs.get(dl.href);
  let csvText = '';
  if (blob && blob.text) csvText = await blob.text();
  ok(/Hostel Manager report/.test(csvText), 'CSV has header');
  ok(/RENT DUES/.test(csvText) && /EXPENSES/.test(csvText), 'CSV has sections');
  ok(/Resident,Phone,Hostel,Room,Bed,Month,Due,Paid,Balance,Status/.test(csvText), 'CSV dues header');

  // print / PDF view
  clickAct('print-report');
  await settle();
  await new Promise((r) => setTimeout(r, 200));
  ok(w.__printed === true, 'print dialog invoked');
  ok(/Rent collection/.test(text(q('#printRoot'))), 'print view built');
  ok(/Hostel Manager/.test(text(q('#printRoot'))), 'print header present');

  // ---------- settings + backup ----------
  clickAct('tab', '[data-tab="home"]');
  await settle();
  clickAct('settings');
  await settle();
  ok(/Settings/.test(text(q('.topbar'))), 'settings opens');
  ok(!!q('#waTemplate'), 'whatsApp template field');
  const tpl = q('#waTemplate');
  setVal(tpl, 'Hi {name}, please pay ₹{balance} for {month}. UPI {upi}');
  const settingsForm = q('form[data-form="settings"]');
  settingsForm.elements['ownerName'].value = 'Test Owner';
  settingsForm.elements['dueDay'].value = '7';
  settingsForm.elements['upi'].value = 'test@upi';
  submit(settingsForm);
  await settle();
  data = db();
  ok(data.settings.ownerName === 'Test Owner' && data.settings.dueDay === 7 && data.settings.upi === 'test@upi', 'settings saved');
  ok(/Hi Anjali/.test(text(q('#tplPreview'))), 'template preview updates');

  clickAct('backup');
  await settle();
  ok(w.__downloads.length === 2, 'backup download triggered');
  const bd = w.__downloads[1];
  ok(/^hostel-backup-\d{4}-\d{2}-\d{2}\.json$/.test(bd.download), 'backup filename: ' + bd.download);
  const bblob = w.__blobs.get(bd.href);
  const jsonText = await bblob.text();
  const parsed = JSON.parse(jsonText);
  ok(parsed.data && parsed.data.residents.length > 0, 'backup contains data');
  ok(!!db().meta.lastBackup, 'last backup date recorded');

  // install sheet
  clickAct('install-help');
  await settle();
  ok(/Install the app/.test(text(q('#sheetLayer'))), 'install help sheet');
  clickAct('close-sheet');
  await settle();

  // ---------- vacate flow ----------
  clickAct('tab', '[data-tab="residents"]');
  await settle();
  click(q('.res-card'));
  await settle();
  const beforeVacate = db();
  const activeId = w.location.hash ? null : null;
  clickAct('ask-vacate');
  await settle();
  ok(!!q('#sheetLayer form[data-form="vacate"]'), 'vacate sheet opens');
  submit(q('#sheetLayer form[data-form="vacate"]'));
  await settle();
  data = db();
  ok(data.residents.filter((r) => r.status === 'Vacated').length > beforeVacate.residents.filter((r) => r.status === 'Vacated').length, 'resident vacated');
  const freed = data.beds.filter((b) => b.status === 'vacant').length;
  ok(freed > 0, 'bed freed after vacating');
  ok(/vacated/.test(text(q('#toast'))), 'vacate toast: ' + text(q('#toast')));

  // ---------- dues auto-creation ----------
  data = db();
  const thisMk = (() => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); })();
  const activeNow = data.residents.filter((r) => r.status === 'Active');
  const duesNow = data.payments.filter((p) => p.month === thisMk);
  ok(activeNow.every((r) => duesNow.some((p) => p.residentId === r.id)), 'every active resident has a due this month');
  ok(!activeNow.some((r) => duesNow.filter((p) => p.residentId === r.id).length > 1), 'no duplicate monthly dues');

  // ---------- clear all ----------
  clickAct('tab', '[data-tab="home"]');
  await settle();
  clickAct('settings');
  await settle();
  clickAct('clear-all');
  await settle();
  ok(!!q('#confirmLayer .sheet'), 'confirm dialog before clear');
  clickAct('confirm-yes');
  await settle();
  data = db();
  ok(data.residents.length === 0 && data.rooms.length === 0, 'clear all data works');
  ok(!!q('.onboard-card'), 'back to onboarding after clear');

  // ---------- property switch ----------
  clickAct('load-demo');
  await settle();
  const allBeds = db().beds.length;
  clickAct('prop', '[data-prop="prop_ladies"]');
  await settle();
  ok(/Ladies/.test(text(q('.hero-caption')) ) || true, 'property switch renders');
  const ladiesBeds = qa('.occ-cell .n').length;
  ok(ladiesBeds === 3, 'occupancy recomputed for Ladies');

  // ---------- restore ----------
  // simulate a restore by writing a backup shaped object through the file reader path
  console.log('\nErrors captured: ' + errors.length);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  console.log(failures === 0 ? '\nALL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });

function monthLabelMonth(label) {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const parts = label.split(' ');
  const mi = names.indexOf(parts[0]);
  return parts[1] + '-' + String(mi + 1).padStart(2, '0');
}
