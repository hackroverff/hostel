/* Logic-focused jsdom tests: wizard, full-month joining rent, rollover, restore */
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
const pad = (n) => String(n).padStart(2, '0');
const thisMk = () => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1); };
const mkAdd = (mk, d) => { const p = mk.split('-').map(Number); const x = new Date(p[0], p[1] - 1 + d, 1); return x.getFullYear() + '-' + pad(x.getMonth() + 1); };
const dim = (mk) => { const p = mk.split('-').map(Number); return new Date(p[0], p[1], 0).getDate(); };

function makeDom(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      // placeholders in config.js == local-only mode: no network at all
      w.APP_CONFIG = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };
      w.scrollTo = () => {};
      w.print = () => {};
      w.URL.createObjectURL = () => 'blob:x';
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
      if (seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(seed));
    }
  });
  return dom;
}
function helpers(w) {
  const d = w.document;
  const q = (s) => d.querySelector(s);
  const qa = (s) => Array.from(d.querySelectorAll(s));
  const click = (el) => { if (!el) throw new Error('missing element to click'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w })); };
  const act = (a, extra) => { const el = q('[data-act="' + a + '"]' + (extra || '')); if (!el) throw new Error('missing act ' + a); click(el); };
  const tap = (sel) => click(q(sel));
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const db = () => JSON.parse(w.localStorage.getItem('hostelManager.v1'));
  const settle = async (ms) => {
    await new Promise((r) => setTimeout(r, ms || 30));
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
  return { w, d, q, qa, click, act, tap, submit, db, settle };
}
async function unlock(h, opts) {
  opts = opts || {};
  await h.settle(180);
  if (!h.q('#authLayer.open')) return;
  const form = h.q('#authLayer form[data-form="login"]');
  form.elements['username'].value = opts.username || 'owner';
  form.elements['password'].value = opts.password || 'hostel123';
  if (form.elements['confirm']) form.elements['confirm'].value = opts.password || 'hostel123';
  h.submit(form);
  await h.settle(700);
}

(async function () {
  // ---------------------------------------------------------------- setup
  let h = helpers(makeDom(seedFixture()).window);
  await unlock(h);
  let base = h.db();
  const fixtureBackup = JSON.parse(JSON.stringify(base));

  // ---------------------------------------------------------------- wizard
  h.act('tab', '[data-tab="residents"]');
  await h.settle();
  h.act('add-resident');
  await h.settle();
  let form = h.q('#sheetLayer form[data-form="resident"]');
  ok(!!form, 'wizard step 1 opens');

  // invalid phone kept on step 1
  form.elements['name'].value = 'New Resident';
  form.elements['phone'].value = '98765';
  h.act('wiz-next');
  await h.settle();
  ok(/phone/i.test(text(h.q('#sheetLayer .field.has-error'))), 'short phone number blocked');
  ok(/Step 1 of 3/.test(text(h.q('#sheetLayer'))), 'still on step 1 after invalid phone');

  // guardian phone validation
  form = h.q('#sheetLayer form[data-form="resident"]');
  form.elements['phone'].value = '9876543210';
  form.elements['guardianPhone'].value = '12345';
  h.act('wiz-next');
  await h.settle();
  ok(/10 digit/.test(text(h.q('#sheetLayer'))), 'invalid guardian phone blocked');

  form = h.q('#sheetLayer form[data-form="resident"]');
  form.elements['guardianPhone'].value = '9876512345';
  h.act('wiz-next');
  await h.settle();
  ok(/Step 2 of 3/.test(text(h.q('#sheetLayer'))), 'moved to room step');
  ok(/Room and bed/.test(text(h.q('#sheetLayer'))), 'room step title');
  ok(!!h.q('#sheetLayer select[name="roomId"]'), 'room select present');
  ok(!!h.q('#sheetLayer select[name="bedId"]'), 'bed select present');

  // join on the 10th of this month: the full monthly rent is always charged
  const today = new Date();
  const joinDay = Math.min(10, today.getDate());
  const joinIso = thisMk() + '-' + pad(joinDay);
  form = h.q('#sheetLayer form[data-form="resident"]');
  const roomSel = form.elements['roomId'];
  const firstRoomEl = Array.from(roomSel.options).filter((o) => o.value && !o.disabled)[0];
  ok(!!firstRoomEl, 'at least one room with a free bed is offered');
  roomSel.value = firstRoomEl.value;
  roomSel.dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await h.settle();
  form = h.q('#sheetLayer form[data-form="resident"]');
  const bedSel = form.elements['bedId'];
  const bedOpt = Array.from(bedSel.options).filter((o) => o.value)[0];
  ok(!!bedOpt, 'vacant bed option offered');
  bedSel.value = bedOpt.value;
  form.elements['joiningDate'].value = joinIso;
  h.act('wiz-next');
  await h.settle();
  ok(/Step 3 of 3/.test(text(h.q('#sheetLayer'))), 'moved to rent step');

  form = h.q('#sheetLayer form[data-form="resident"]');
  ok(Number(form.elements['rent'].value) > 0, 'rent prefilled from room: ' + form.elements['rent'].value);
  const rentVal = Number(form.elements['rent'].value);
  // mid-month breakdown card + Pro-rate (default) / Full month
  const step3 = text(h.q('#sheetLayer'));
  ok(!!h.q('#sheetLayer [data-group="firstMode"]'), 'the wizard offers Pro-rate and Full month');
  ok(!!h.q('#sheetLayer button[data-value="prorated"][aria-pressed="true"]'), 'Pro-rate is the default');
  ok(/per day/.test(step3), 'the wizard shows the per-day rate');
  ok(/First month rent/.test(step3), 'the wizard shows the first-month rent');
  const autoDays = Math.min(dim(thisMk()), 30) && (dim(thisMk()) - joinDay + 1);
  const autoRent = Math.min(rentVal, Math.round(Math.round(rentVal * 100 / 30) * autoDays / 100));
  ok(step3.indexOf('\u20B9' + autoRent.toLocaleString('en-IN')) !== -1, 'the card shows the calculated first-month rent ' + autoRent);
  h.submit(form);
  await h.settle(80);

  let data = h.db();
  const created = data.residents.filter((r) => r.name === 'New Resident')[0];
  ok(!!created, 'new resident saved');
  ok(created && created.status === 'Active', 'new resident is active');
  ok(created && created.phone === '9876543210', 'phone cleaned/saved');
  ok(created && created.bedId === bedOpt.value, 'resident placed on chosen bed');
  const bed = data.beds.filter((b) => b.id === bedOpt.value)[0];
  ok(bed && bed.status === 'occupied' && bed.residentId === created.id, 'bed marked occupied');
  const due = data.payments.filter((p) => p.residentId === created.id && p.month === thisMk())[0];
  ok(!!due, 'due auto-created for joining month');
  ok(due.rent === autoRent, 'the first month is pro-rated by days stayed: ' + due.rent + ' vs ' + autoRent);
  ok(!!due.pro && due.pro.days === autoDays, 'the due remembers the days charged: ' + (due.pro && due.pro.days) + ' vs ' + autoDays);
  ok(due.pro && due.pro.basisDays === 30, 'the default 30-day basis is used');
  ok(!('proRate' in created), 'the resident is saved without a legacy proRate flag');
  ok(!!created.firstMonth && created.firstMonth.month === thisMk(), 'the first-month choice is stored on the resident');
  ok(created.firstMonth.mode === 'prorated' && created.firstMonth.edited === false, 'the stored choice is an unedited pro-rate');

  // profile shown after add
  ok(/New Resident/.test(text(h.q('.profile-head'))), 'lands on new resident profile');

  // occupied bed sheet should not offer assignment
  h.act('tab', '[data-tab="rooms"]');
  await h.settle();
  const occBed = h.q('.bed.occupied');
  h.click(occBed);
  await h.settle();
  ok(!h.q('#sheetLayer [data-act="assign-bed"]'), 'occupied bed sheet has no assign action');
  h.act('close-sheet');
  await h.settle();

  // vacant bed assignment of the new resident should be blocked by not listing
  const freeBed = h.q('.bed.vacant');
  h.click(freeBed);
  await h.settle();
  ok(/Assign someone already in your list/.test(text(h.q('#sheetLayer'))) || /Add new resident here/.test(text(h.q('#sheetLayer'))), 'vacant bed sheet offers assignment');
  h.act('close-sheet');
  await h.settle();

  // ---------------------------------------------------------------- rollover
  const stale = JSON.parse(JSON.stringify(fixtureBackup));
  const prev2 = mkAdd(thisMk(), -2);
  stale.meta.lastRunMonth = prev2;
  // remove any dues for last month + this month so the gap fill is visible
  const keep = stale.residents.filter((r) => r.status === 'Active')[0];
  stale.payments = stale.payments.filter((p) => !(p.residentId === keep.id && p.month >= mkAdd(thisMk(), -1)));
  const beforeCount = stale.payments.length;
  const h2 = helpers(makeDom(stale).window);
  await unlock(h2);
  const data2 = h2.db();
  const newDues = data2.payments.filter((p) => p.month >= mkAdd(thisMk(), -1));
  ok(newDues.length > 0, 'gap months filled on open (' + newDues.length + ' new dues)');
  ok(data2.payments.length > beforeCount, 'dues created after reopen');
  ok(data2.payments.some((p) => p.month === mkAdd(thisMk(), -1)), 'previous month due created');
  ok(data2.payments.some((p) => p.month === thisMk()), 'current month due created');
  ok(data2.meta.lastRunMonth === thisMk(), 'last run month updated');

  // ---------------------------------------------------------------- overdue
  const od = JSON.parse(JSON.stringify(fixtureBackup));
  od.settings.dueDay = 1; // everything unpaid is overdue now
  const h3 = helpers(makeDom(od).window);
  await unlock(h3);
  ok(/Overdue/.test(text(h3.q('.screen'))) || /Overdue/.test(text(h3.q('.hero'))), 'overdue label appears after due day');
  h3.act('tab', '[data-tab="payments"]');
  await h3.settle();
  ok(/Overdue/.test(text(h3.q('.screen'))), 'payments screen marks overdue dues');

  // ---------------------------------------------------------------- restore
  const restorable = JSON.parse(JSON.stringify(fixtureBackup));
  restorable.residents[0].name = 'Restored Person';
  restorable.residents = restorable.residents.slice(0, 2);
  restorable.rooms = restorable.rooms.slice(0, 2);
  restorable.payments = restorable.payments.filter((p) => restorable.residents.some((r) => r.id === p.residentId));
  restorable.beds = restorable.beds.filter((b) => restorable.rooms.some((r) => r.id === b.roomId));
  restorable.residents.forEach((r) => {
    if (!restorable.beds.some((b) => b.id === r.bedId)) { r.bedId = ''; r.roomId = ''; }
  });

  const h4 = helpers(makeDom(seedFixture()).window);
  await unlock(h4);
  h4.act('settings');
  await h4.settle();
  const file = new h4.w.File([JSON.stringify({ app: 'Hostel Manager', data: restorable })], 'backup.json', { type: 'application/json' });
  const input = h4.q('#restoreFile');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new h4.w.Event('change', { bubbles: true }));
  await h4.settle(200);
  ok(!!h4.q('#confirmLayer .sheet'), 'restore asks for confirmation');
  ok(/2 residents/.test(text(h4.q('#confirmLayer'))), 'restore summary shows counts');
  h4.act('confirm-yes');
  await h4.settle(150);
  const restored = h4.db();
  ok(restored.residents.length === 2, 'backup restored resident count');
  ok(restored.residents.some((r) => r.name === 'Restored Person'), 'restored content matches backup');
  ok(restored.rooms.length === 2, 'restored room count');
  ok(!!h4.q('.hero') && !!h4.q('.occ-grid'), 'restored data renders home dashboard');

  // ---------------------------------------------------------------- empty-state validation
  const h5 = helpers(makeDom(null).window);
  await unlock(h5);
  h5.act('add-room');
  await h5.settle();
  const rf = h5.q('#sheetLayer form[data-form="room"]');
  rf.elements['rent'].value = '';
  rf.elements['beds'].value = '';
  h5.submit(rf);
  await h5.settle();
  ok(h5.qa('#sheetLayer .field.has-error').length >= 2, 'empty room form blocked with field errors');
  ok(!!h5.q('#sheetLayer form[data-form="room"]'), 'room sheet stays open after error');

  console.log(failures === 0 ? '\nALL LOGIC TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
