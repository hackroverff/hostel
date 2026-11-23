/* Detail-level tests: receipts, refunds, bed moves, reminder text, CSV quoting */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture } = require('./fixture');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }
const pad = (n) => String(n).padStart(2, '0');
const thisMk = () => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1); };

function boot(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      if (seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(seed));
      w.__downloads = [];
      w.__blobs = new Map();
      let n = 0;
      w.URL.createObjectURL = (b) => { const u = 'blob:' + (++n); w.__blobs.set(u, b); return u; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__downloads.push({ name: this.download, href: this.href }); };
    }
  });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s);
  const qa = (s) => Array.from(d.querySelectorAll(s));
  const click = (el) => { if (!el) throw new Error('missing element'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w })); };
  const act = (a, extra) => { const el = q('[data-act="' + a + '"]' + (extra || '')); if (!el) throw new Error('missing act ' + a + extra); click(el); };
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const db = () => JSON.parse(w.localStorage.getItem('hostelManager.v1'));
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));
  const pinEntry = async (digits) => {
    for (const ch of String(digits)) click(q('.lock-key[data-digit="' + ch + '"]'));
    await settle(240);
  };
  const unlock = async () => {
    await settle(150);
    if (!q('.lock-screen')) return;
    await pinEntry('1234');
    await pinEntry('1234');
    await settle(150);
  };
  return { w, d, q, qa, click, act, submit, db, settle, pinEntry, unlock };
}

(async function () {
  const t = boot(seedFixture());
  await t.unlock();

  // ---------------------------------------------------------- payment options
  t.act('tab', '[data-tab="payments"]');
  await t.settle();
  t.click(t.q('.pay-card'));
  await t.settle();
  ok(!!t.q('#sheetLayer .amount-input'), 'tapping the whole payment card opens the sheet');
  const balance = Number(t.q('#sheetLayer .amount-input').value);
  t.act('fill-amount', '[data-value="' + Math.max(1, Math.round(balance / 2)) + '"]');
  ok(Number(t.q('#sheetLayer .amount-input').value) === Math.round(balance / 2), 'Half chip fills half the balance');
  t.act('fill-amount', '[data-value="' + balance + '"]');
  ok(Number(t.q('#sheetLayer .amount-input').value) === balance, 'Full chip fills the balance');

  // save full payment
  const dueId = t.q('#sheetLayer form[data-form="payment"]').elements['dueId'].value;
  t.act('save-payment');
  await t.settle(80);
  let data = t.db();
  let pay = data.payments.find((p) => p.id === dueId);
  ok(pay.receipts.length === 1, 'receipt saved on full payment');
  ok(pay.receipts[0].amount === balance, 'receipt amount equals balance');

  // reopen and delete the receipt
  t.act('tab', '[data-tab="payments"]');
  await t.settle();
  const cardForDue = t.qa('.pay-card').find((c) => c.getAttribute('data-id') === dueId);
  ok(!!cardForDue, 'paid due still listed in All');
  t.click(cardForDue);
  await t.settle();
  ok(/fully paid/i.test(text(t.q('#sheetLayer'))), 'fully paid state shown');
  t.act('ask-delete-receipt');
  await t.settle();
  ok(/Delete this receipt/.test(text(t.q('#confirmLayer'))), 'receipt delete asks to confirm');
  t.act('confirm-yes');
  await t.settle(80);
  data = t.db();
  pay = data.payments.find((p) => p.id === dueId);
  ok(pay.receipts.length === 0, 'receipt removed after confirm');
  ok(/Record payment|Amount received/.test(text(t.q('#sheetLayer'))), 'payment form returns after receipt deleted');
  t.act('close-sheet');
  await t.settle();

  // ---------------------------------------------------------- reminder text
  t.act('tab', '[data-tab="payments"]');
  await t.settle();
  const wa = t.q('.pay-card a[href^="https://wa.me/91"]');
  ok(!!wa, 'reminder link present');
  const href = wa.getAttribute('href');
  ok(/^https:\/\/wa\.me\/919\d{9}\?text=/.test(href), 'wa.me link has 91 + 10 digits and text: ' + href.slice(0, 30));
  const msg = decodeURIComponent(href.split('?text=')[1] || '');
  ok(!/\{\w+\}/.test(msg), 'no unfilled placeholders in message');
  ok(/Hello /.test(msg) && /hostel rent of ₹/.test(msg), 'message starts with template and amount');
  ok(/pending/.test(msg) && /Thank you/.test(msg), 'message contains pending + thanks');
  ok(/UPI: sathvika@okhdfcbank/.test(msg), 'UPI filled from settings: ' + msg);
  ok(/\d{1,2} [A-Z][a-z]{2} \d{4}/.test(msg), 'date filled in 22 Nov 2026 style');

  // ---------------------------------------------------------- vacate + refund
  t.act('tab', '[data-tab="residents"]');
  await t.settle();
  t.click(t.q('.res-card'));
  await t.settle();
  const profileName = text(t.q('.profile-head .pn'));
  t.act('ask-vacate');
  await t.settle();
  const vf = t.q('#sheetLayer form[data-form="vacate"]');
  ok(!!vf, 'vacate form open');
  const refundDefault = Number(vf.elements['refundAmount'].value);
  ok(refundDefault > 0, 'refund defaults to deposit: ' + refundDefault);
  vf.elements['refundAmount'].value = '4000';
  vf.elements['refundDate'].value = thisMk() + '-20';
  t.submit(vf);
  await t.settle(100);
  data = t.db();
  const vacated = data.residents.find((r) => r.name === profileName);
  ok(vacated.status === 'Vacated', 'resident marked vacated');
  ok(vacated.refundAmount === 4000 && !!vacated.refundDate, 'refund amount + date saved');
  ok(vacated.depositRefunded === true, 'deposit marked refunded');
  ok(data.beds.filter((b) => b.residentId === vacated.id && b.status === 'occupied').length === 0, 'no bed is occupied by the vacated resident');
  ok(data.residents.length > 0, 'history retained');
  ok(!data.payments.some((p) => p.residentId === vacated.id && p.month > (vacated.vacatingDate || '').slice(0, 7)), 'no future dues after vacating');

  // ---------------------------------------------------------- edit bed move
  const activeBefore = data.residents.filter((r) => r.status === 'Active');
  const mover = activeBefore[0];
  const oldBed = mover.bedId;
  t.act('tab', '[data-tab="residents"]');
  await t.settle();
  const card = t.qa('.res-card').find((c) => /Room/.test(text(c)) && text(c).includes(mover.name));
  t.click(card);
  await t.settle();
  t.act('edit-resident');
  await t.settle();
  // step through wizard to step 2
  t.click(t.q('[data-act="wiz-next"]'));
  await t.settle();
  ok(/Step 2 of 3/.test(text(t.q('#sheetLayer'))), 'edit wizard goes to room step');
  const bedSel = t.q('#sheetLayer select[name="bedId"]');
  const other = Array.from(bedSel.options).filter((o) => o.value && o.value !== oldBed)[0];
  if (other) {
    bedSel.value = other.value;
    t.click(t.q('[data-act="wiz-next"]'));
    await t.settle();
    t.submit(t.q('#sheetLayer form[data-form="resident"]'));
    await t.settle(100);
    data = t.db();
    const moved = data.residents.find((r) => r.id === mover.id);
    ok(moved.bedId === other.value, 'resident moved to chosen bed');
    ok(data.beds.find((b) => b.id === oldBed).status === 'vacant', 'old bed freed');
    ok(data.beds.find((b) => b.id === other.value).status === 'occupied', 'new bed occupied');
  } else {
    ok(true, 'no alternate bed to move to (single room)');
  }

  // ---------------------------------------------------------- CSV quoting
  t.act('tab', '[data-tab="reports"]');
  await t.settle();
  t.act('rep-tab', '[data-tab="expenses"]');
  await t.settle();
  t.act('add-expense');
  await t.settle();
  const ef = t.q('#sheetLayer form[data-form="expense"]');
  ef.elements['amount'].value = '777';
  ef.elements['note'].value = 'Cement, bricks and paint';
  t.submit(ef);
  await t.settle();
  t.act('export-csv');
  await t.settle();
  const dl = t.w.__downloads[t.w.__downloads.length - 1];
  const csv = await t.w.__blobs.get(dl.href).text();
  ok(/"Cement, bricks and paint"/.test(csv), 'CSV escapes commas in notes');
  ok(/,777,/.test(csv), 'CSV has the new expense amount');

  // ---------------------------------------------------------- settings due-day effect
  t.act('settings');
  await t.settle();
  const sf = t.q('form[data-form="settings"]');
  sf.elements['dueDay'].value = '28';
  t.submit(sf);
  await t.settle();
  data = t.db();
  ok(data.settings.dueDay === 28, 'due day saved');
  t.act('tab', '[data-tab="home"]');
  await t.settle();
  ok(/Rent pending/.test(text(t.q('.screen'))), 'home still fine after settings change');

  // ---------------------------------------------------------- reminder counts grouping
  t.act('tab', '[data-tab="payments"]');
  await t.settle();
  t.act('remind-all');
  await t.settle();
  const remNames = t.qa('.rem-card .semi').map(text);
  ok(new Set(remNames).size === remNames.length, 'each resident appears once in reminders');
  ok(remNames.length > 0, 'reminder residents listed');

  console.log(failures === 0 ? '\nALL DETAIL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
