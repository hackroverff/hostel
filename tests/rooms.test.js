/* Room form: 1-8 sharing, auto-filled beds and clean bed grids.
   Run with: node tests/rooms.test.js */
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
const pad = (n) => String(n).padStart(2, '0');
const thisMk = () => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1); };

function makeDom(seed) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.HOSTEL_CONFIG = { cloud: false };
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
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const db = () => JSON.parse(w.localStorage.getItem('hostelManager.v1'));
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 40));
  return { w, d, q, qa, click, act, submit, db, settle };
}
async function unlock(h) {
  await h.settle(180);
  if (!h.q('#authLayer.open')) return;
  const form = h.q('#authLayer form[data-form="login"]');
  form.elements['username'].value = 'owner';
  form.elements['password'].value = 'hostel123';
  if (form.elements['confirm']) form.elements['confirm'].value = 'hostel123';
  h.submit(form);
  await h.settle(700);
}

function buildDb() {
  const cur = thisMk();
  const now = new Date().toISOString();
  return {
    version: 1,
    properties: [
      { id: 'prop_ladies', name: 'Sathvika MV Ladies Hostel', rent: 6500, advance: 6500, electricity: { mode: 'split', amount: 0 } },
      { id: 'prop_mens', name: 'Sathvika MV Men\u2019s Hostel', rent: 4000, advance: 4000, electricity: { mode: 'fixed', amount: 250 } }
    ],
    rooms: [],
    beds: [],
    residents: [],
    payments: [],
    expenses: [],
    electricityBills: [],
    settings: {
      dueDay: 5, ownerName: 'Sathvika Reddy', upi: 'sathvika@okhdfcbank',
      waTemplate: 'Hello {name}, your dues for {month} are \u20B9{balance}. Please pay by {date}. UPI: {upi}.',
      propertyNote: '', largeText: false
    },
    meta: { lastRunMonth: cur, lastBackup: now, createdAt: now, firstMonthMode: 'prorate' }
  };
}

function fillRoomForm(h, form, opts) {
  form.elements['number'].value = opts.number;
  if (opts.rent) form.elements['rent'].value = String(opts.rent);
  form.elements['beds'].value = String(opts.beds); // the auto-filled value can be edited
}

(async function () {
  /* ------------------------------------------------- 1..8 sharing in the room form */
  {
    const h = helpers(makeDom(buildDb()).window);
    await unlock(h);

    h.act('tab', '[data-tab="rooms"]');
    await h.settle();
    ok(/No rooms yet/.test(text(h.q('.screen'))), 'empty rooms screen is shown');

    h.act('add-room');
    await h.settle();
    let form = h.q('#sheetLayer form[data-form="room"]');
    ok(!!form, 'Add room form opens');

    let chips = h.qa('#sheetLayer [data-group="sharing"] [data-act="pick"]');
    ok(chips.length === 8, 'the sharing picker has 8 options: ' + chips.length);
    const values = chips.map((c) => c.getAttribute('data-value')).join(',');
    ok(values === '1,2,3,4,5,6,7,8', 'sharing options are 1 to 8: ' + values);
    const labels = chips.map((c) => text(c)).join('|');
    ok(labels === 'Single|2 sharing|3 sharing|4 sharing|5 sharing|6 sharing|7 sharing|8 sharing', 'sharing labels read well: ' + labels);

    // picking a sharing type fills the beds field
    h.click(chips[7]); // 8 sharing
    ok(form.elements['beds'].value === '8', 'picking 8 sharing fills 8 beds');
    form.elements['beds'].value = '6';
    ok(form.elements['beds'].value === '6', 'the beds field stays editable');
    h.click(chips[7]);
    ok(form.elements['beds'].value === '8', 'picking 8 sharing again re-fills 8 beds');
    h.click(chips[2]);
    ok(form.elements['beds'].value === '3', 'picking 3 sharing fills 3 beds');

    // save an 8-sharing room
    h.click(chips[7]);
    fillRoomForm(h, form, { number: 'G1', rent: 4000, beds: 8 });
    h.submit(form);
    await h.settle(80);
    let db = h.db();
    ok(db.rooms.length === 1, 'the room is saved');
    const big = db.rooms[0];
    ok(big.sharing === 8, 'the room keeps 8 sharing: ' + big.sharing);
    ok(big.beds === 8, 'the room keeps 8 beds: ' + big.beds);
    const bigBeds = db.beds.filter((b) => b.roomId === big.id);
    ok(bigBeds.length === 8, '8 bed records are created: ' + bigBeds.length);
    ok(bigBeds.map((b) => b.label).join(',') === 'Bed 1,Bed 2,Bed 3,Bed 4,Bed 5,Bed 6,Bed 7,Bed 8', 'beds are named Bed 1 to Bed 8');

    // the rooms screen draws the 8 tiles in even rows
    ok(/8 sharing/.test(text(h.q('.room-meta'))), 'the room card says "8 sharing"');
    const grid = h.q('.room-card .beds');
    ok(!!grid, 'the room card has a bed grid');
    ok(grid.className.indexOf('cols-4') >= 0, 'eight beds use a four-column grid: ' + grid.className);
    ok(h.qa('.room-card .bed').length === 8, 'all 8 bed tiles are drawn');

    // editing does not reset the sharing back to 4
    h.act('edit-room');
    await h.settle();
    form = h.q('#sheetLayer form[data-form="room"]');
    ok(!!form, 'Edit room form opens');
    chips = h.qa('#sheetLayer [data-group="sharing"] [data-act="pick"]');
    ok(chips.length === 8, 'the edit form also offers 1 to 8 sharing');
    const pressed = chips.filter((c) => c.getAttribute('aria-pressed') === 'true').map((c) => c.getAttribute('data-value')).join(',');
    ok(pressed === '8', 'the 8 sharing option is selected when editing');
    ok(form.elements['sharing'].value === '8', 'the form carries 8 sharing');
    ok(form.elements['beds'].value === '8', 'the form carries 8 beds');
    h.submit(form);
    await h.settle(80);
    db = h.db();
    ok(db.rooms[0].sharing === 8 && db.rooms[0].beds === 8, 'saving an untouched 8-sharing room keeps 8 sharing');
    ok(db.beds.filter((b) => b.roomId === db.rooms[0].id).length === 8, 'the room still has 8 beds after saving');

    // single sharing still works and makes one bed
    h.act('add-room');
    await h.settle();
    form = h.q('#sheetLayer form[data-form="room"]');
    chips = h.qa('#sheetLayer [data-group="sharing"] [data-act="pick"]');
    h.click(chips[0]); // Single
    ok(form.elements['beds'].value === '1', 'picking Single fills 1 bed');
    fillRoomForm(h, form, { number: '101', rent: 6500, beds: 1 });
    h.submit(form);
    await h.settle(80);
    db = h.db();
    const single = db.rooms.filter((r) => r.number === '101')[0];
    ok(!!single && single.sharing === 1, 'a single room keeps 1 sharing');
    ok(db.beds.filter((b) => b.roomId === single.id).length === 1, 'a single room has one bed');
    ok(!/cols-/.test(h.q('.room-card .beds').className), 'small rooms keep the normal bed grid');
  }

  /* ------------------------------------------------- quick setup keeps 8 sharing */
  {
    const h = helpers(makeDom(buildDb()).window);
    await unlock(h);
    h.act('tab', '[data-tab="rooms"]');
    await h.settle();
    h.act('quick-setup');
    await h.settle();
    h.click(h.q('#confirmLayer [data-act="confirm-yes"]'));
    await h.settle(120);
    const db = h.db();
    const mens = db.rooms.filter((r) => r.propertyId === 'prop_mens');
    ok(mens.length === 4 && mens.every((r) => r.sharing === 8 && r.beds === 8), 'quick setup men\u2019s rooms are 8 sharing with 8 beds');
    ok(mens.every((r) => db.beds.filter((b) => b.roomId === r.id).length === 8), 'each men\u2019s room got 8 beds');
    ok(/8 sharing/.test(text(h.q('.screen'))), 'the rooms screen shows 8 sharing');

    // open the first men's room and save it untouched
    const firstMens = h.qa('.room-card').map((c) => c).filter((c) => /8 sharing/.test(text(c)))[0];
    ok(!!firstMens, 'a men\u2019s 8-sharing room card is on screen');
    h.click(firstMens.querySelector('[data-act="edit-room"]'));
    await h.settle();
    const form = h.q('#sheetLayer form[data-form="room"]');
    ok(form.elements['sharing'].value === '8', 'editing a quick-setup room starts at 8 sharing');
    ok(form.elements['beds'].value === '8', 'editing a quick-setup room starts at 8 beds');
    h.submit(form);
    await h.settle(80);
    const after = h.db();
    ok(after.rooms.filter((r) => r.propertyId === 'prop_mens').every((r) => r.sharing === 8 && r.beds === 8), 'quick-setup rooms stay 8 sharing after editing');
    ok(after.beds.length === 42, 'all 42 beds are still there: ' + after.beds.length);
  }

  console.log(failures ? '\n' + failures + ' TEST(S) FAILED' : '\nALL ROOM TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
