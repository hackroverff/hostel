/* jsdom smoke test for the Hostel Manager single page app */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture } = require('./fixture');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + label);
  if (!cond) failures++;
}
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

let w = null;
let d = null;
let errors = [];

function open(seed) {
  errors = [];
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.HOSTEL_CONFIG = { cloud: false };
      win.scrollTo = () => {};
      win.print = () => { win.__printed = true; };
      win.__downloads = [];
      win.__blobs = new Map();
      let n = 0;
      win.URL.createObjectURL = (b) => { const u = 'blob:stub' + (++n); win.__blobs.set(u, b); return u; };
      win.URL.revokeObjectURL = () => {};
      win.HTMLAnchorElement.prototype.click = function () {
        win.__downloads.push({ download: this.download, href: this.href });
      };
      win.HTMLElement.prototype.scrollIntoView = function () {};
      if (seed) win.localStorage.setItem('hostelManager.v1', JSON.stringify(seed));
    }
  });
  w = dom.window;
  d = w.document;
  w.addEventListener('error', (e) => errors.push(String(e.message)));
}

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
function settle(ms) { return new Promise((r) => setTimeout(r, ms || 20)); }

async function unlock(opts) {
  opts = opts || {};
  await settle(180);
  if (!q('#authLayer.open')) return;
  const form = q('#authLayer form[data-form="login"]');
  form.elements['username'].value = opts.username || 'owner';
  form.elements['password'].value = opts.password || 'hostel123';
  if (form.elements['confirm']) form.elements['confirm'].value = opts.password || 'hostel123';
  submit(form);
  await settle(700);
}

(async function run() {
  // ---------- fresh phone: account first, then onboarding ----------
  open(null);
  await settle(140);
  ok(!!q('#authLayer.open'), 'fresh phone opens on the sign-in screen');
  ok(/Create your account/.test(text(q('.auth-title'))), 'first open asks to create an account');
  ok(d.body.classList.contains('is-locked'), 'the app is blocked while the sign-in screen is up');
  ok(!q('.lock-screen') && !q('.lock-key'), 'no PIN pad is rendered');
  ok(!/PIN/i.test(text(q('#authLayer'))), 'no PIN wording on the sign-in screen');
  clickAct('add-resident');
  await settle(60);
  ok(!q('#sheetLayer .sheet'), 'home actions cannot be used until you sign in');

  // validation
  let loginForm = q('#authLayer form[data-form="login"]');
  ok(!!loginForm.elements['mode'] && loginForm.elements['mode'].value === 'signup', 'sign-up mode on first open');
  ok(!!loginForm.elements['confirm'], 'sign-up asks to confirm the password');
  ok(!!loginForm.elements['stay'] && loginForm.elements['stay'].checked, '"Stay signed in" is on by default');
  setVal(loginForm.elements['username'], 'owner');
  setVal(loginForm.elements['password'], '123');
  setVal(loginForm.elements['confirm'], '123');
  submit(loginForm);
  await settle(80);
  ok(/at least 6 characters/i.test(text(q('#authLayer'))), 'short password rejected');
  ok(!!q('#authLayer.open'), 'still locked after a bad password');
  loginForm.elements['password'].value = 'hostel123';
  loginForm.elements['confirm'].value = 'hostel124';
  submit(loginForm);
  await settle(80);
  ok(/do not match/i.test(text(q('#authLayer'))), 'mismatched confirmation rejected');

  loginForm.elements['confirm'].value = 'hostel123';
  submit(loginForm);
  await settle(800);
  ok(!q('#authLayer.open'), 'sign-in screen goes away once the account is created');
  ok(/Signed in/.test(text(q('#toast'))), 'toast confirms the sign-in: ' + text(q('#toast')));
  ok(!!w.localStorage.getItem('hostelManager.session'), 'session stored for "stay signed in"');
  const acct = JSON.parse(w.localStorage.getItem('hostelManager.account') || '{}');
  ok(acct.username === 'owner', 'account saved: ' + JSON.stringify(acct && acct.username));
  ok(!acct.password && !acct.secret, 'the password is never stored in plain text');

  ok(!!q('.hero'), 'home screen renders hero card');
  ok(text(q('.brand-name')).includes('Hostel Manager'), 'brand shown');
  ok(qa('.tab').length === 5, 'five bottom tabs');
  ok(qa('.tab[aria-current="page"]').length === 1, 'one active tab');
  ok(!!q('.onboard-card'), 'onboarding card on empty data');
  ok(!q('[data-act="load-demo"]'), 'no demo button on the empty Home screen');
  ok(!!q('[data-act="add-room"]'), 'Add a room stays on the empty Home screen');
  const props = db().properties.map((p) => p.name);
  ok(props.length === 2 && /Ladies/.test(props[0]) && /Men/.test(props[1]), 'two properties preloaded: ' + props.join(' | '));
  ok(w.localStorage.getItem('hostelManager.v1') !== null, 'data saved to localStorage');

  // add a room on the empty app
  clickAct('add-room');
  await settle();
  let roomForm = q('#sheetLayer form[data-form="room"]');
  ok(!!roomForm, 'add room sheet opens');
  roomForm.elements['number'].value = '401';
  roomForm.elements['beds'].value = '2';
  roomForm.elements['rent'].value = '6500';
  submit(roomForm);
  await settle();
  let data = db();
  ok(data.rooms.some((r) => r.number === '401'), 'new room saved');
  ok(data.beds.filter((b) => b.roomId === data.rooms.find((r) => r.number === '401').id).length === 2, 'beds auto-created for new room');

  // duplicate room number validation
  clickAct('tab', '[data-tab="rooms"]');
  await settle();
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

  // ---------- seeded app ----------
  open(seedFixture());
  await unlock();
  ok(!q('#authLayer.open'), 'seeded phone signs in');
  ok(!q('[data-act="load-demo"]'), 'demo action is gone everywhere');
  ok(!!q('.hero-amount'), 'hero renders with data');
  const heroAmount = text(q('.hero-amount'));
  ok(/^₹[\d,]+$/.test(heroAmount), 'Indian currency format in hero: ' + heroAmount);
  ok(!q('.onboard-card'), 'onboarding hidden with data');
  ok(qa('.list-row').length > 0, 'pending list rows rendered');
  ok(qa('a[href^="https://wa.me/91"]').length > 0, 'WhatsApp links use wa.me with +91');

  // occupancy numbers
  const occCells = qa('.occ-cell .n').map(text);
  ok(occCells.length === 3, 'occupancy card has 3 stats: ' + occCells.join('/'));

  // ---------- tabs: rooms ----------
  clickAct('tab', '[data-tab="rooms"]');
  await settle();
  ok(qa('.room-card').length === 4, 'all 4 room cards render');
  ok(qa('.bed').length === 11, 'beds render (' + qa('.bed').length + ')');
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
  clickAct('res-filter', '[data-filter="active"]');
  await settle();

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
  ok(!!q('#sheetLayer .receipt-hero'), 'receipt sheet shown after saving');
  ok(/\u20B9/.test(text(q('#sheetLayer .receipt-hero .ra'))), 'receipt shows the amount: ' + text(q('#sheetLayer .receipt-hero .ra')));
  ok(/Send receipt on WhatsApp/.test(text(q('#sheetLayer'))), 'receipt offers WhatsApp send');
  clickAct('receipt-done');
  await settle();
  ok(!!q('.month-nav'), 'back on payments list after receipt');
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
  const expForm = q('#sheetLayer form[data-form="expense"]');
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
  ok(!/Load demo data/.test(text(q('.screen'))), 'settings has no Load demo data row');
  ok(/Erase everything/.test(text(q('.screen'))), 'settings offers Erase everything');
  ok(!/Clear all data/.test(text(q('.screen'))), 'old Clear all data label is gone');
  ok(!/PIN/.test(text(q('.screen'))), 'settings has no PIN rows left');
  ok(/Account/.test(text(q('.screen'))), 'settings has an Account section');
  ok(/Local account/.test(text(q('.screen'))), 'settings says this is a local account');
  ok(!!q('#syncStatus'), 'settings shows a sync status row');
  ok(/Cloud sync off/.test(text(q('#syncStatus'))), 'sync status explains cloud sync is off: ' + text(q('#syncStatus')));
  ok(!!q('[data-act="logout"]'), 'settings offers Log out');
  ok(!!q('[data-act="logout"] .st') && /Log out/.test(text(q('[data-act="logout"] .st'))), 'the log out row has a title');
  ok(!!q('[data-act="logout"] .ss'), 'the log out row has a description line');
  ok(!q('[data-act="change-pin"]'), 'no Change PIN action');
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

  // ---------- property switch ----------
  clickAct('tab', '[data-tab="home"]');
  await settle();
  clickAct('prop', '[data-prop="prop_ladies"]');
  await settle();
  ok(/Sathvika MV Ladies Hostel/.test(text(q('.screen'))), 'property switch renders Ladies');
  ok(qa('.occ-cell .n').length === 3, 'occupancy recomputed for Ladies');
  clickAct('prop', '[data-prop="all"]');
  await settle();

  // ---------- vacate flow ----------
  clickAct('tab', '[data-tab="residents"]');
  await settle();
  click(q('.res-card'));
  await settle();
  const beforeVacate = db();
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

  // ---------- erase everything ----------
  clickAct('tab', '[data-tab="home"]');
  await settle();
  clickAct('settings');
  await settle();
  clickAct('clear-all');
  await settle(120);
  ok(!!q('#confirmLayer .sheet'), 'erase asks for confirmation right away (no PIN)');
  ok(/This deletes all residents, rooms and payments/.test(text(q('#confirmLayer'))), 'confirmation warns about the delete');
  clickAct('confirm-yes');
  await settle();
  data = db();
  ok(data.residents.length === 0 && data.rooms.length === 0 && data.payments.length === 0, 'erase everything works');
  ok(!!q('.onboard-card'), 'back to onboarding after erasing');
  ok(/Everything erased/.test(text(q('#toast'))), 'erase toast shown');

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
