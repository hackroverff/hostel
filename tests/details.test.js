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
      // placeholders in config.js == local-only mode: no network at all
      w.APP_CONFIG = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };
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
  const settle = async (ms) => {
    await new Promise((r) => setTimeout(r, ms || 40));
    // The 4-digit PIN now sits on top of the account: clear it automatically.
    let guard = 0;
    while (q('#lockLayer .lock-screen') && guard < 4) {
      guard += 1;
      const mode = q('#lockLayer .lock-screen').getAttribute('data-mode');
      for (const ch of '1234') {
        const key = q('[data-act="pin-digit"][data-digit="' + ch + '"]');
        if (key) click(key);
      }
      await new Promise((r) => setTimeout(r, 450));
      if (mode === 'locked' && !q('#lockLayer .lock-screen')) break;
    }
  };
  const unlock = async () => {
    await settle(180);
    if (!q('#authLayer.open')) return;
    const form = q('#authLayer form[data-form="login"]');
    form.elements['username'].value = 'owner';
    form.elements['password'].value = 'hostel123';
    if (form.elements['confirm']) form.elements['confirm'].value = 'hostel123';
    submit(form);
    await settle(700);
  };
  return { w, d, q, qa, click, act, submit, db, settle, unlock };
}

/* A hostel holding exactly one resident in one room, for singular wording. */
function oneResidentSeed() {
  const db = JSON.parse(JSON.stringify(seedFixture()));
  const room = db.rooms[0];
  const bed = db.beds.find((b) => b.roomId === room.id);
  const keep = db.residents.find((r) => r.bedId === bed.id) || db.residents[0];
  bed.status = 'occupied';
  bed.residentId = keep.id;
  keep.bedId = bed.id;
  keep.roomId = room.id;
  db.residents = [keep];
  db.rooms = [room];
  db.beds = [bed];
  db.payments = [];
  db.expenses = [];
  return db;
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
  ok(/Hello /.test(msg) && /your dues for/.test(msg) && /₹5,200/.test(msg), 'message starts with template and amount');
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
  ok(/pending/.test(text(t.q('.screen'))), 'home still fine after settings change');

  // ---------------------------------------------------------- reminder counts grouping
  t.act('tab', '[data-tab="payments"]');
  await t.settle();
  t.act('remind-all');
  await t.settle();
  const remNames = t.qa('.rem-card .semi').map(text);
  ok(new Set(remNames).size === remNames.length, 'each resident appears once in reminders');
  ok(remNames.length > 0, 'reminder residents listed');

  // ---------------------------------------------------------- layout details
  const css = (el, prop) => (el ? t.w.getComputedStyle(el)[prop] : '');
  t.act('tab', '[data-tab="home"]');
  await t.settle();
  t.act('settings');
  await t.settle();

  // settings rows stack a bold title over a grey description
  const setRow = t.q('.set-row .grow');
  ok(!!setRow, 'settings rows use a grow column');
  ok(css(setRow, 'flexDirection') === 'column', 'settings title and description stack vertically');
  ok(css(setRow, 'gap') === '2px', 'a 2px gap separates title and description: ' + css(setRow, 'gap'));
  const setTitle = t.q('.set-row .grow .st');
  const setDesc = t.q('.set-row .grow .ss');
  ok(!!setTitle && !!setDesc, 'each row has a title and a description');
  ok(css(setTitle, 'display') === 'block' && css(setDesc, 'display') === 'block', 'title and description are block level (no run-on text)');
  ok(parseInt(css(setTitle, 'fontWeight'), 10) >= 600, 'the title is bold: ' + css(setTitle, 'fontWeight'));
  ok(/On this phone/.test(text(t.q('.screen'))), 'settings has the storage row');

  // singular / plural wording
  const singles = boot(oneResidentSeed());
  await singles.unlock();
  singles.act('settings');
  await singles.settle();
  const storeTxt = text(singles.q('.screen'));
  ok(/1 resident\b/.test(storeTxt), 'a single resident reads "1 resident": ' + (storeTxt.match(/[0-9]+ residents?/) || ['none'])[0]);
  ok(!/1 residents\b/.test(storeTxt), 'never "1 residents"');
  ok(/1 room\b/.test(storeTxt), 'a single room reads "1 room": ' + (storeTxt.match(/[0-9]+ rooms?/) || ['none'])[0]);
  ok(!/1 rooms\b/.test(storeTxt), 'never "1 rooms"');
  singles.act('tab', '[data-tab="rooms"]');
  await singles.settle();
  const roomsTxt = text(singles.q('.screen'));
  ok(/1 room(?!s)/.test(roomsTxt), 'the rooms screen reads "1 room": ' + roomsTxt.slice(0, 120));
  ok(!/1 rooms\b/.test(roomsTxt), 'the rooms screen never says "1 rooms"');

  // the +91 prefix sits in its own box and never overlaps the digits
  const phoneSeed = seedFixture();
  const wizard = boot(phoneSeed);
  await wizard.unlock();
  wizard.act('tab', '[data-tab="residents"]');
  await wizard.settle();
  wizard.act('add-resident');
  await wizard.settle();
  const pre = wizard.q('.inline-input.has-prefix.wide-prefix .prefix');
  ok(!!pre && text(pre) === '+91', 'the phone field shows a +91 prefix box');
  ok(css(pre, 'position') === 'absolute', 'the prefix is positioned out of the text flow');
  const phoneInput = wizard.q('.inline-input.wide-prefix input[name="phone"]');
  ok(!!phoneInput, 'the phone input follows the prefix');
  ok(css(phoneInput, 'paddingLeft') === '56px', 'the phone input is padded past the prefix: ' + css(phoneInput, 'paddingLeft'));
  const preBox = wizard.q('.field .inline-input.wide-prefix');
  ok(!!preBox, 'the phone field is wrapped so the prefix cannot collide');

  // the security deposit "Received" checkbox is vertically centred with its label
  const wizForm = wizard.q('#sheetLayer form[data-form="resident"]');
  wizForm.elements['name'].value = 'Checkbox Person';
  wizForm.elements['phone'].value = '9876500011';
  wizForm.elements['idConsent'].checked = true;
  wizard.act('wiz-next');
  await wizard.settle(150);
  const bedForm = wizard.q('#sheetLayer form[data-form="resident"]');
  const freeRoom = Array.from(bedForm.elements['roomId'].options).find((o) => !o.disabled && o.value);
  bedForm.elements['roomId'].value = freeRoom.value;
  bedForm.elements['roomId'].dispatchEvent(new wizard.w.Event('change', { bubbles: true }));
  await wizard.settle(150);
  const bedForm2 = wizard.q('#sheetLayer form[data-form="resident"]');
  const freeBed = Array.from(bedForm2.elements['bedId'].options).find((o) => o.value);
  ok(!!freeBed, 'a free bed can be chosen');
  bedForm2.elements['bedId'].value = freeBed.value;
  bedForm2.elements['joiningDate'].value = new Date().toISOString().slice(0, 10);
  wizard.act('wiz-next');
  await wizard.settle(150);
  const rentForm = wizard.q('#sheetLayer form[data-form="resident"]');
  ok(!!rentForm && !!rentForm.elements['depositAmount'], 'the wizard rent step has a deposit field');
  const depCheck = wizard.q('.deposit-check');
  ok(!!depCheck, 'the deposit row has a Received checkbox block');
  ok(css(depCheck, 'display') === 'flex', 'the checkbox block is a flex row: ' + css(depCheck, 'display'));
  ok(css(depCheck, 'alignItems') === 'center', 'the checkbox is vertically centred');
  ok(css(depCheck, 'gap') === '10px', 'a 10px gap separates the box from its label');
  const depInput = rentForm.elements['depositAmount'];
  ok(css(depInput, 'paddingLeft') === '38px', 'the rupee sign does not overlap the deposit digits: ' + css(depInput, 'paddingLeft'));

  console.log(failures === 0 ? '\nALL DETAIL TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
