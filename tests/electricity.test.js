/* Electricity (fixed / split), manual shares and Quick setup.
   Run with: node tests/electricity.test.js */
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
const mkAdd = (mk, d) => { const p = mk.split('-').map(Number); const x = new Date(p[0], p[1] - 1 + d, 1); return x.getFullYear() + '-' + pad(x.getMonth() + 1); };
const rupees = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');

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
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const change = (el, value) => {
    el.value = value;
    el.dispatchEvent(new w.Event('change', { bubbles: true }));
  };
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
  return { w, d, q, qa, click, act, submit, change, db, settle };
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

/* A small hostel: one room per distinct room label, each person on their own bed. */
function buildDb(opts) {
  const cur = thisMk();
  const now = new Date().toISOString();
  const ladiesCfg = Object.assign({ rent: 5200, advance: 5200, mode: 'split', amount: 0 }, opts.ladies || {});
  const mensCfg = Object.assign({ rent: 4500, advance: 4500, mode: 'fixed', amount: 0 }, opts.mens || {});
  const rooms = [], beds = [], residents = [];
  const roomIds = {};
  (opts.people || []).forEach((p, i) => {
    const key = p.prop + ':' + p.room;
    if (!roomIds[key]) {
      roomIds[key] = 'room_' + Object.keys(roomIds).length;
      rooms.push({
        id: roomIds[key], propertyId: p.prop, number: String(p.room), floor: p.floor || 1,
        sharing: 8, beds: 8, rent: p.rent, ac: 'Non-AC'
      });
    }
    const roomId = roomIds[key];
    const bedId = 'bed_' + p.id;
    beds.push({ id: bedId, roomId: roomId, label: 'Bed ' + (i + 1), status: 'occupied', residentId: p.id });
    residents.push({
      id: p.id, name: p.name, phone: '98400000' + pad(10 + i), guardianName: 'Guardian',
      guardianPhone: '98400111' + pad(10 + i), college: 'College', idType: 'Aadhaar',
      idNumber: '1111 2222 333' + (i % 10), photo: '', status: 'Active', vacatingDate: '',
      notes: '', refundAmount: 0, refundDate: '', depositRefunded: false,
      propertyId: p.prop, roomId: roomId, bedId: bedId,
      joiningDate: mkAdd(cur, -2) + '-01', rent: p.rent, proRate: false,
      depositAmount: 0, depositReceived: false
    });
  });
  return {
    version: 1,
    properties: [
      { id: 'prop_ladies', name: 'Sathvika MV Ladies Hostel', rent: ladiesCfg.rent, advance: ladiesCfg.advance, electricity: { mode: ladiesCfg.mode, amount: ladiesCfg.amount } },
      { id: 'prop_mens', name: 'Sathvika MV Men\u2019s Hostel', rent: mensCfg.rent, advance: mensCfg.advance, electricity: { mode: mensCfg.mode, amount: mensCfg.amount } }
    ],
    rooms: rooms,
    beds: beds,
    residents: residents,
    payments: [],
    expenses: [],
    electricityBills: [],
    settings: {
      dueDay: 5, ownerName: 'Sathvika Reddy', upi: 'sathvika@okhdfcbank',
      waTemplate: 'Hello {name}, your dues for {month} are \u20B9{balance}. Rent \u20B9{rent} + Electricity {electricity}. Please pay by {date}. UPI: {upi}. Thank you.',
      propertyNote: '', largeText: false
    },
    meta: { lastRunMonth: cur, lastBackup: new Date().toISOString(), createdAt: now, firstMonthMode: 'prorate' }
  };
}
function ladies(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'res_l' + (i + 1), name: 'Lady ' + (i + 1), prop: 'prop_ladies', rent: 5200, room: 101 + i
  }));
}
function dueOf(db, residentId, month) {
  return db.payments.filter((p) => p.residentId === residentId && p.month === month)[0];
}
async function addBill(h, amount, month) {
  h.act('tab', '[data-tab="payments"]');
  await h.settle();
  h.act('elec-bill');
  await h.settle();
  let form = h.q('#sheetLayer form[data-form="elecBill"]');
  ok(!!form, 'electricity bill sheet opens');
  if (month) form.elements['month'].value = month;
  form.elements['amount'].value = String(amount);
  h.submit(form);
  await h.settle();
}
async function addResident(h, opts) {
  h.act('tab', '[data-tab="residents"]');
  await h.settle();
  h.act('add-resident');
  await h.settle();
  let form = h.q('#sheetLayer form[data-form="resident"]');
  form.elements['name'].value = opts.name;
  form.elements['phone'].value = '9876500011';
  form.elements['guardianPhone'].value = '9876500022';
  h.act('wiz-next');
  await h.settle();
  form = h.q('#sheetLayer form[data-form="resident"]');
  const roomSel = form.elements['roomId'];
  roomSel.value = opts.roomId;
  h.change(roomSel, opts.roomId);
  await h.settle();
  form = h.q('#sheetLayer form[data-form="resident"]');
  const bedSel = form.elements['bedId'];
  const bedOpt = Array.from(bedSel.options).filter((o) => o.value)[0];
  bedSel.value = bedOpt.value;
  form.elements['joiningDate'].value = thisMk() + '-01';
  h.act('wiz-next');
  await h.settle();
  form = h.q('#sheetLayer form[data-form="resident"]');
  if (opts.rent) form.elements['rent'].value = String(opts.rent);
  h.submit(form);
  await h.settle(120);
}

(async function () {
  const cur = thisMk();

  /* ---------------------------------------------------------------- split among 3 */
  {
    const h = helpers(makeDom(buildDb({ people: ladies(3) })).window);
    await unlock(h);
    ok(!!h.q('.hero, .screen'), 'app opened with the seeded hostels');

    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    const before = h.db();
    const beforeDue = dueOf(before, 'res_l1', cur);
    ok(beforeDue && beforeDue.electricity === null, 'before the bill the electricity line is empty');
    ok(/Electricity pending/.test(text(h.q('.pay-card'))), 'dues say "Electricity pending" until the bill is added');

    await addBill(h, 3000);
    const after = h.db();
    ok(after.electricityBills.length === 1, 'one bill is stored for the month');
    const p1 = dueOf(after, 'res_l1', cur);
    const p2 = dueOf(after, 'res_l2', cur);
    const p3 = dueOf(after, 'res_l3', cur);
    ok(p1.electricity === 1000 && p2.electricity === 1000 && p3.electricity === 1000, 'bill of 3000 splits into 1000 each for 3 residents');
    ok(p1.due === 6200, 'due = rent 5200 + electricity 1000');
    ok(p1.rent === 5200, 'rent stays a separate line on the due');
    ok(/Electricity \u20B91,000/.test(text(h.q('.pay-card'))), 'pay card shows the electricity line');

    // rent can still be paid while electricity is pending (second hostel month)
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
  }

  /* ---------------------------------------------------------------- split among 7, spread over rooms */
  {
    const people = [];
    // 4 in room 101, 2 in room 102, 1 in room 201
    [101, 101, 101, 101, 102, 102, 201].forEach((room, i) => {
      people.push({ id: 'res_s' + (i + 1), name: 'Split ' + (i + 1), prop: 'prop_ladies', rent: 5200, room: room });
    });
    const h = helpers(makeDom(buildDb({ people: people })).window);
    await unlock(h);
    await h.settle();
    await addBill(h, 7700);
    const db = h.db();
    ok(db.rooms.length === 3, 'seven residents share three rooms');
    const shares = Object.keys(db.payments.reduce((a, p) => { a[p.residentId] = true; return a; }, {}))
      .filter((id) => id.indexOf('res_s') === 0)
      .map((id) => dueOf(db, id, cur).electricity);
    ok(shares.length === 7, 'seven dues got an electricity line');
    ok(shares.every((s) => s === 1100), 'bill of 7700 splits into 1100 each for 7 residents across rooms');

    // rounding to the nearest rupee
    await addBill(h, 1000);
    const rounded = h.db().payments.filter((p) => p.month === cur && p.residentId.indexOf('res_s') === 0);
    ok(rounded.every((p) => p.electricity === 143), '1000 split 7 ways rounds to 143 each: ' + rounded[0].electricity);
    ok(rounded.every((p) => p.due === 5343), 'due follows the rounded share');
  }

  /* ---------------------------------------------------------------- fixed per person */
  {
    const people = [{ id: 'res_m1', name: 'Manish', prop: 'prop_mens', rent: 4500, room: 201 }];
    const h = helpers(makeDom(buildDb({ people: people, mens: { mode: 'fixed', amount: 0 }, ladies: { mode: 'fixed', amount: 0 } })).window);
    await unlock(h);
    // both hostels are on fixed with 0, so the bill button is not offered
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    ok(!h.q('[data-act="elec-bill"]'), 'no bill button when every hostel is on fixed electricity');

    h.act('tab', '[data-tab="home"]');
    await h.settle();
    h.act('settings');
    await h.settle();
    let form = h.q('#screenRoot form[data-form="hostelSettings"]');
    ok(!!form, 'Hostel settings section exists');
    ok(!!form.elements['elecMode_prop_ladies'] && !!form.elements['elecMode_prop_mens'], 'each hostel has an electricity type');
    const opts = Array.from(form.elements['elecMode_prop_mens'].options).map((o) => o.textContent);
    ok(opts.join('|') === 'Fixed per person|Split hostel bill', 'the two electricity options are offered: ' + opts.join(' / '));
    h.change(form.elements['elecMode_prop_mens'], 'fixed');
    await h.settle();
    form = h.q('#screenRoot form[data-form="hostelSettings"]');
    form.elements['elecAmount_prop_mens'].value = '250';
    h.submit(form);
    await h.settle();
    const saved = h.db().properties.filter((p) => p.id === 'prop_mens')[0];
    ok(saved.electricity.mode === 'fixed' && saved.electricity.amount === 250, 'fixed 250 is saved for the men\u2019s hostel');

    const due = dueOf(h.db(), 'res_m1', cur);
    ok(due.rent === 4500 && due.electricity === 250 && due.due === 4750, 'fixed electricity is added to every due');

    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    const card = h.q('.pay-card[data-id="' + due.id + '"]');
    ok(!!card, 'the due card is on screen');
    h.click(card);
    await h.settle();
    const sheet = text(h.q('#sheetLayer'));
    ok(/Rent/.test(sheet) && /Electricity/.test(sheet), 'payment sheet splits rent and electricity');
    ok(sheet.indexOf('\u20B94,500') >= 0 && sheet.indexOf('\u20B9250') >= 0, 'payment sheet shows 4500 rent and 250 electricity');
    const waHref = h.q('#sheetLayer a[href^="https://wa.me/91"]');
    const msg = waHref ? decodeURIComponent(waHref.getAttribute('href').split('?text=')[1] || '') : '';
    ok(/Electricity \u20B9250/.test(msg), 'WhatsApp reminder mentions the electricity amount: ' + msg.slice(0, 120));
    h.act('close-sheet');
    await h.settle();
  }

  /* ---------------------------------------------------------------- manual edit of one share */
  {
    const h = helpers(makeDom(buildDb({ people: ladies(3) })).window);
    await unlock(h);
    await addBill(h, 3000);
    let db = h.db();
    const target = dueOf(db, 'res_l2', cur);
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    h.click(h.q('.pay-card[data-id="' + target.id + '"]'));
    await h.settle();
    h.act('edit-electricity');
    await h.settle();
    const form = h.q('#sheetLayer form[data-form="electricity"]');
    ok(!!form, 'one person\u2019s electricity can be edited');
    form.elements['amount'].value = '500';
    h.submit(form);
    await h.settle();
    db = h.db();
    ok(dueOf(db, 'res_l2', cur).electricity === 500, 'the edited share is saved');
    ok(dueOf(db, 'res_l2', cur).due === 5700, 'the due follows the edited share');
    ok(dueOf(db, 'res_l1', cur).electricity === 1000 && dueOf(db, 'res_l3', cur).electricity === 1000, 'other residents keep their equal share');
    ok(dueOf(db, 'res_l2', cur).electricityManual === true, 'the edit is marked as manual');
    h.act('close-sheet');
    await h.settle();

    // a fourth resident joins: the automatic shares recalculate, the manual one stays
    const roomId = db.rooms.filter((r) => r.propertyId === 'prop_ladies')[0].id;
    await addResident(h, { name: 'New Lady', roomId: roomId, rent: 5200 });
    db = h.db();
    const joined = db.residents.filter((r) => r.name === 'New Lady')[0];
    ok(!!joined, 'a new resident can join the ladies hostel');
    const joinedDue = dueOf(db, joined.id, cur);
    ok(joinedDue && joinedDue.electricity === 750, '3000 divided between 4 residents gives 750: ' + (joinedDue || {}).electricity);
    ok(dueOf(db, 'res_l1', cur).electricity === 750, 'existing shares recalculate when someone joins');
    ok(dueOf(db, 'res_l2', cur).electricity === 500, 'the manual share is not overwritten');
  }

  /* ---------------------------------------------------------------- pending does not block rent */
  {
    const h = helpers(makeDom(buildDb({ people: ladies(2) })).window);
    await unlock(h);
    let db = h.db();
    const due = dueOf(db, 'res_l1', cur);
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    h.click(h.q('.pay-card[data-id="' + due.id + '"]'));
    await h.settle();
    ok(/Pending/.test(text(h.q('#sheetLayer'))), 'the due sheet shows electricity pending');
    const form = h.q('#sheetLayer form[data-form="payment"]');
    ok(!!form, 'rent can be recorded while electricity is pending');
    form.elements['amount'].value = '5200';
    h.act('save-payment');
    await h.settle();
    db = h.db();
    ok(dueOf(db, 'res_l1', cur).receipts.length === 1, 'the rent payment is saved');
    ok(/Rent/.test(text(h.q('#sheetLayer'))) && /Electricity/.test(text(h.q('#sheetLayer'))), 'the receipt shows rent and electricity');
    ok(/Electricity/.test(text(h.q('#sheetLayer'))) && /Pending/.test(text(h.q('#sheetLayer'))), 'the receipt says electricity is still pending');
    h.act('receipt-done');
    await h.settle();

    // the bill lands later and the due grows
    await addBill(h, 2000);
    db = h.db();
    ok(dueOf(db, 'res_l1', cur).electricity === 1000, 'the bill added later fills the pending line');
    ok(dueOf(db, 'res_l1', cur).due === 6200, 'the total due grows by the electricity share');
    ok(dueOf(db, 'res_l1', cur).status !== 'Paid', 'a partially paid month is not marked paid');
  }

  /* ---------------------------------------------------------------- reports */
  {
    const h = helpers(makeDom(buildDb({ people: ladies(2) })).window);
    await unlock(h);
    await addBill(h, 2000);
    h.act('tab', '[data-tab="reports"]');
    await h.settle();
    const grid = text(h.q('.report-grid'));
    ok(/Rent/.test(grid) && /Electricity/.test(grid), 'reports list rent and electricity separately: ' + grid);
    ok(/Income/.test(grid), 'income is still shown');
  }

  /* ---------------------------------------------------------------- quick setup */
  {
    const h = helpers(makeDom(null).window);
    await unlock(h);
    h.act('tab', '[data-tab="rooms"]');
    await h.settle();
    ok(/No rooms yet/.test(text(h.q('.screen'))), 'empty rooms screen shows the empty state');
    ok(!!h.q('[data-act="quick-setup"]'), 'quick setup button is on the empty rooms screen');
    h.act('quick-setup');
    await h.settle();
    ok(!!h.q('#confirmLayer [data-act="confirm-yes"]'), 'quick setup asks for confirmation first');
    ok(h.db().rooms.length === 0, 'nothing is created before the owner confirms');
    h.click(h.q('#confirmLayer [data-act="confirm-yes"]'));
    await h.settle(120);
    const db = h.db();
    ok(db.rooms.length === 9, 'quick setup made 9 rooms: ' + db.rooms.length);
    const mensRooms = db.rooms.filter((r) => r.propertyId === 'prop_mens');
    const ladiesRooms = db.rooms.filter((r) => r.propertyId === 'prop_ladies');
    ok(mensRooms.length === 4 && mensRooms.every((r) => r.sharing === 8 && r.rent === 4000), 'men\u2019s hostel: 4 rooms of 8 sharing at 4000');
    ok(mensRooms.map((r) => r.floor).sort().join(',') === '0,1,2,3', 'men\u2019s rooms on ground to third floor');
    ok(mensRooms.reduce((n, r) => n + r.beds, 0) === 32, 'men\u2019s hostel has 32 beds');
    ok(ladiesRooms.length === 5 && ladiesRooms.every((r) => r.floor === 1), 'ladies hostel: 5 rooms, all on the 1st floor');
    ok(ladiesRooms.map((r) => r.sharing).sort().join(',') === '1,2,2,2,3', 'ladies sharing is 2, 2, 2, 3 and 1');
    ok(ladiesRooms.every((r) => r.rent === 6500), 'ladies rooms are 6500 per bed');
    ok(ladiesRooms.reduce((n, r) => n + r.beds, 0) === 10, 'ladies hostel has 10 beds');
    const mensBeds = db.beds.filter((b) => mensRooms.some((r) => r.id === b.roomId)).length;
    const ladiesBeds = db.beds.filter((b) => ladiesRooms.some((r) => r.id === b.roomId)).length;
    ok(mensBeds === 32 && ladiesBeds === 10, 'beds are created: ' + mensBeds + ' men\u2019s and ' + ladiesBeds + ' ladies');
    // rooms stay editable
    h.act('edit-room');
    await h.settle();
    const roomForm = h.q('#sheetLayer form[data-form="room"]');
    ok(!!roomForm, 'a quick-setup room can be opened and edited');
    ok(roomForm && roomForm.elements['sharing'].value === '8', 'the room keeps its 8 sharing');
    h.act('close-sheet');
    await h.settle();

    // the hostel rent and advance prefill a new resident
    const openWizard = async (propId) => {
      h.act('tab', '[data-tab="residents"]');
      await h.settle();
      h.act('add-resident');
      await h.settle();
      let f = h.q('#sheetLayer form[data-form="resident"]');
      f.elements['name'].value = 'Prefill ' + propId;
      f.elements['phone'].value = '9876500077';
      f.elements['guardianPhone'].value = '9876500088';
      h.act('wiz-next');
      await h.settle();
      f = h.q('#sheetLayer form[data-form="resident"]');
      const propSel = f.elements['propertyId'];
      h.change(propSel, propId);
      await h.settle();
      f = h.q('#sheetLayer form[data-form="resident"]');
      const room = db.rooms.filter((r) => r.propertyId === propId)[0];
      h.change(f.elements['roomId'], room.id);
      await h.settle();
      f = h.q('#sheetLayer form[data-form="resident"]');
      const bedOpt = Array.from(f.elements['bedId'].options).filter((o) => o.value)[0];
      f.elements['bedId'].value = bedOpt.value;
      h.act('wiz-next');
      await h.settle();
      f = h.q('#sheetLayer form[data-form="resident"]');
      return { rent: Number(f.elements['rent'].value), deposit: Number(f.elements['depositAmount'].value) };
    };
    const ladiesWizard = await openWizard('prop_ladies');
    ok(ladiesWizard.rent === 6500 && ladiesWizard.deposit === 6500, 'ladies defaults: rent 6500 and advance 6500');
    h.act('close-sheet');
    await h.settle();
    const mensWizard = await openWizard('prop_mens');
    ok(mensWizard.rent === 4000 && mensWizard.deposit === 4000, 'men\u2019s defaults: rent 4000 and advance 4000');
    h.act('close-sheet');
    await h.settle();
  }

  console.log(failures ? '\n' + failures + ' TEST(S) FAILED' : '\nALL ELECTRICITY TESTS PASSED');
  process.exitCode = failures ? 1 : 0;
})().catch((e) => { console.error('TEST CRASH', e); process.exit(1); });
