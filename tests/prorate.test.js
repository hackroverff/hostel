/* Mid-month joining and leaving: day-rate basis, joining day, rounding,
   electricity weighting, leaving mid-month, manual edits and recalculation. */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { thisMk, mkAdd } = require('./fixture');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }
function pad2(n) { return String(n).padStart(2, '0'); }
function dim(mk) { const p = String(mk).split('-').map(Number); return new Date(p[0], p[1], 0).getDate(); }
/* the most recent month (this month or earlier) with the given number of days */
function monthWith(days, fromMk) {
  let mk = fromMk || thisMk();
  for (let i = 0; i < 30; i++) {
    if (dim(mk) === days) return mk;
    mk = mkAdd(mk, -1);
  }
  throw new Error('no month with ' + days + ' days');
}
const MID_DEFAULTS = { basis: 'fixed30', countJoinDay: true, rounding: 'nearest', prorateElec: false, chargeFullOnLeave: true };

function makeDb(o) {
  o = o || {};
  const mid = Object.assign({}, MID_DEFAULTS, o.mid || {});
  const rentL = o.rentL == null ? 6500 : o.rentL;
  const now = new Date().toISOString();
  const db = {
    version: 1,
    properties: [
      { id: 'prop_ladies', name: 'Sathvika MV Ladies Hostel', rent: rentL, advance: 0, electricity: { mode: 'split', amount: 0 }, midMonth: mid },
      { id: 'prop_mens', name: 'Sathvika MV Men\u2019s Hostel', rent: o.rentM == null ? 4000 : o.rentM, advance: 0, electricity: { mode: 'fixed', amount: o.fixed == null ? 250 : o.fixed }, midMonth: mid }
    ],
    rooms: [
      { id: 'room_l', propertyId: 'prop_ladies', number: '101', floor: 0, sharing: 4, beds: 4, rent: rentL, ac: 'Non-AC' },
      { id: 'room_m', propertyId: 'prop_mens', number: '201', floor: 0, sharing: 4, beds: 4, rent: o.rentM == null ? 4000 : o.rentM, ac: 'Non-AC' }
    ],
    beds: [],
    residents: [],
    payments: [],
    expenses: [],
    electricityBills: o.bills || [],
    settings: { dueDay: 5, ownerName: '', upi: '', waTemplate: 'Hello {name}, {month} dues \u20B9{balance}. Rent \u20B9{rent} ({days} at {perday}/day). UPI {upi}.', propertyNote: '', largeText: false },
    meta: { lastRunMonth: o.lastRun || thisMk(), lastBackup: '2026-01-01', createdAt: now, syncedAt: null, updatedAt: null }
  };
  ['room_l', 'room_m'].forEach((roomId) => {
    for (let i = 1; i <= 4; i++) db.beds.push({ id: 'bed_' + roomId + '_' + i, roomId, label: 'Bed ' + i, status: 'vacant', residentId: null });
  });
  (o.residents || []).forEach((spec, i) => {
    const prop = spec.propertyId || 'prop_ladies';
    const roomId = prop === 'prop_ladies' ? 'room_l' : 'room_m';
    const bed = db.beds.filter((b) => b.roomId === roomId && b.status === 'vacant')[0];
    const r = {
      id: 'res_' + (i + 1), name: spec.name, phone: spec.phone || '98765432' + pad2(i + 10),
      propertyId: prop, roomId, bedId: bed ? bed.id : '',
      joiningDate: spec.joiningDate, rent: spec.rent == null ? (prop === 'prop_ladies' ? rentL : (o.rentM == null ? 4000 : o.rentM)) : spec.rent,
      status: spec.status || 'Active', vacatingDate: spec.vacatingDate || '',
      depositAmount: 0, depositReceived: false, refundAmount: 0, refundDate: '', notes: '', photo: '',
      guardianName: '', guardianPhone: '', college: '', idType: 'Aadhaar', idNumber: ''
    };
    if (bed) { bed.status = 'occupied'; bed.residentId = r.id; }
    if (spec.firstMonth) r.firstMonth = spec.firstMonth;
    db.residents.push(r);
  });
  db.residents.forEach((r) => {
    if (r.status !== 'Active') return;
    // keep beds consistent with the residents list
  });
  return db;
}

function boot(db, opts) {
  opts = opts || {};
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e && e.message)));
  vc.on('error', (...a) => errors.push(String(a[0])));
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      // placeholders in config.js == local-only mode: no network at all
      w.APP_CONFIG = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };
      w.scrollTo = () => {};
      w.print = () => {};
      w.URL.createObjectURL = () => 'blob:1';
      w.HTMLAnchorElement.prototype.click = function () {};
      w.localStorage.setItem('hostelManager.v1', JSON.stringify(db));
      w.localStorage.setItem('hostelManager.session', JSON.stringify({ v: 1, cloud: false, stay: true, user: { id: 'local', username: 'owner' } }));
    }
  });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s);
  const qa = (s) => Array.from(d.querySelectorAll(s));
  const click = (el) => { if (!el) throw new Error('missing element'); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w })); };
  const act = (a, extra) => { const el = q('[data-act="' + a + '"]' + (extra || '')); if (!el) throw new Error('missing act ' + a + extra); click(el); };
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const change = (el) => el.dispatchEvent(new w.Event('change', { bubbles: true }));
  const dbNow = () => JSON.parse(w.localStorage.getItem('hostelManager.v1'));
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
  return { w, d, q, qa, click, act, submit, change, db: dbNow, settle, errors };
}

function dueOf(h, name, mk) {
  const data = h.db();
  const r = data.residents.filter((x) => x.name === name)[0];
  if (!r) return null;
  return data.payments.filter((p) => p.residentId === r.id && p.month === mk)[0] || null;
}

(async function () {
  const cur = thisMk();
  const curDays = dim(cur);

  /* ---------------------------------------------------- 1. joining on the 1st */
  {
    const h = boot(makeDb({ residents: [{ name: 'First Day', joiningDate: cur + '-01', rent: 6000 }] }));
    await h.settle(220);
    const p = dueOf(h, 'First Day', cur);
    ok(!!p, 'a due is created for the joining month');
    ok(p && p.rent === 6000, 'joining on the 1st charges the full rent: ' + (p && p.rent));
    ok(p && !p.pro, 'no pro-rate note when the whole month is charged');
    ok(!h.db().residents[0].firstMonth, 'nothing to remember when the month starts on the 1st');
    ok(h.errors.length === 0, 'no script errors: ' + h.errors.slice(0, 2).join(' | '));
  }

  /* ------------------------------------- 2. fixed 30-day basis, joining on the 20th */
  {
    const h = boot(makeDb({ residents: [{ name: 'Mid Month', joiningDate: cur + '-20', rent: 6500, phone: '9876500020' }] }));
    await h.settle(220);
    const p = dueOf(h, 'Mid Month', cur);
    const days = curDays - 20 + 1;
    const expected = Math.min(6500, Math.round(Math.round(6500 * 100 / 30) * days / 100));
    ok(!!p, 'a due exists for the mid-month joiner');
    ok(p && p.rent === expected, 'fixed 30 days, 20th: ' + (p && p.rent) + ' (expected ' + expected + ')');
    ok(p && p.pro && p.pro.days === days && p.pro.basisDays === 30, 'the due records ' + days + ' of 30 days');
    ok(p && p.pro && p.pro.perDay === 21667, 'the per-day rate is kept to the paisa: ' + (p && p.pro && p.pro.perDay));
    if (curDays === 30) ok(p && p.rent === 2383, 'the example in the brief (6500 / 30 x 11 = 2383) holds');
    ok(p && p.rent < 6500, 'a part month is never more than the full rent');
    ok(p && p.pro && p.pro.reason === 'join', 'the due knows it is a joining month');
  }

  /* --------------------------- 3. actual days in the month: 30-day and 31-day months */
  for (const n of [30, 31]) {
    const mk = monthWith(n);
    const label = n + '-day month (' + mk + ')';
    const h = boot(makeDb({
      mid: { basis: 'actual' }, lastRun: mkAdd(mk, -1),
      residents: [{ name: 'Actual ' + n, joiningDate: mk + '-20', rent: 6500 }]
    }));
    await h.settle(260);
    const p = dueOf(h, 'Actual ' + n, mk);
    const days = n - 20 + 1;
    const perDay = Math.round(6500 * 100 / n);
    const expected = Math.min(6500, Math.round(perDay * days / 100));
    ok(!!p, label + ': a due exists');
    ok(p && p.pro && p.pro.basisDays === n, label + ': the basis is all ' + n + ' days');
    ok(p && p.pro && p.pro.days === days, label + ': ' + days + ' days are charged');
    ok(p && p.rent === expected, label + ': 6500 / ' + n + ' x ' + days + ' = ' + expected + ' (got ' + (p && p.rent) + ')');
  }

  /* ------------------------------------------- 4. counting the joining day or not */
  for (const count of [true, false]) {
    const label = count ? 'counted' : 'not counted';
    const h = boot(makeDb({
      mid: { countJoinDay: count },
      residents: [{ name: 'Join ' + label, joiningDate: cur + '-20', rent: 6000 }]
    }));
    await h.settle(220);
    const p = dueOf(h, 'Join ' + label, cur);
    const days = curDays - 20 + (count ? 1 : 0);
    ok(p && p.pro && p.pro.days === days, 'joining day ' + label + ': ' + (p && p.pro && p.pro.days) + ' days (expected ' + days + ')');
    ok(p && p.rent === Math.round(200 * days), 'joining day ' + label + ': rent ' + (p && p.rent) + ' (expected ' + Math.round(200 * days) + ')');
  }
  {
    const h = boot(makeDb({
      mid: { countJoinDay: false },
      residents: [{ name: 'First Not Counted', joiningDate: cur + '-01', rent: 6000 }]
    }));
    await h.settle(220);
    const p = dueOf(h, 'First Not Counted', cur);
    ok(p && p.rent === 6000 && !p.pro, 'joining on the 1st stays a full month even when the joining day is not counted');
  }

  /* ------------------------------------------------------------- 5. rounding */
  for (const [mode, days, expected] of [['nearest', 7, 233], ['up', 7, 234], ['down', 8, 266], ['nearest', 8, 267]]) {
    const joinDay = curDays - days + 1;
    const h = boot(makeDb({
      rentL: 1000, mid: { rounding: mode },
      residents: [{ name: 'Round ' + mode + days, joiningDate: cur + '-' + pad2(joinDay), rent: 1000 }]
    }));
    await h.settle(220);
    const p = dueOf(h, 'Round ' + mode + days, cur);
    ok(p && p.rent === expected, 'rounding ' + mode + ' with ' + days + ' days -> ' + (p && p.rent) + ' (expected ' + expected + ')');
  }

  /* --------------------------------------------------------- 6. electricity */
  for (const prorate of [false, true]) {
    const h = boot(makeDb({
      mid: { prorateElec: prorate },
      bills: [{ id: 'bill1', propertyId: 'prop_ladies', month: cur, amount: 6000 }],
      residents: [
        { name: 'Full Stay', joiningDate: cur + '-01', rent: 6500 },
        { name: 'Late Join', joiningDate: cur + '-20', rent: 6500 }
      ]
    }));
    await h.settle(260);
    const a = dueOf(h, 'Full Stay', cur);
    const b = dueOf(h, 'Late Join', cur);
    const lateDays = curDays - 20 + 1;
    if (!prorate) {
      ok(a.electricity === 3000 && b.electricity === 3000, 'split bill, no pro-rate: everyone pays 3000 (' + a.electricity + '/' + b.electricity + ')');
    } else {
      const totalDays = curDays + lateDays;
      const expectedLate = Math.round(6000 * lateDays / totalDays);
      const expectedFull = Math.round(6000 * curDays / totalDays);
      ok(b.electricity === expectedLate, 'split bill pro-rated by days: late joiner pays ' + b.electricity + ' (expected ' + expectedLate + ')');
      ok(a.electricity === expectedFull, 'split bill pro-rated by days: full month pays ' + a.electricity + ' (expected ' + expectedFull + ')');
      ok(Math.abs((a.electricity + b.electricity) - 6000) <= 1, 'the weighted shares still add up to the bill');
    }
  }
  for (const prorate of [false, true]) {
    const h = boot(makeDb({
      mid: { prorateElec: prorate },
      residents: [
        { name: 'M Full', propertyId: 'prop_mens', joiningDate: cur + '-01', rent: 4000 },
        { name: 'M Late', propertyId: 'prop_mens', joiningDate: cur + '-20', rent: 4000 }
      ]
    }));
    await h.settle(260);
    const a = dueOf(h, 'M Full', cur);
    const b = dueOf(h, 'M Late', cur);
    const lateDays = curDays - 20 + 1;
    if (!prorate) {
      ok(a.electricity === 250 && b.electricity === 250, 'fixed per person, no pro-rate: 250 each (' + a.electricity + '/' + b.electricity + ')');
    } else {
      const expectedLate = Math.round(250 * lateDays / 30);
      ok(b.electricity === expectedLate, 'fixed per person pro-rated: late joiner pays ' + b.electricity + ' (expected ' + expectedLate + ')');
      ok(a.electricity === 250, 'fixed per person pro-rated: a full month still pays the whole amount');
    }
  }

  /* ------------------------------------------- 7. leaving mid-month: Yes and No */
  for (const full of [true, false]) {
    const h = boot(makeDb({ mid: { chargeFullOnLeave: full }, residents: [{ name: 'Leaver', joiningDate: cur + '-01', rent: 6000 }] }));
    await h.settle(220);
    const before = dueOf(h, 'Leaver', cur);
    ok(before && before.rent === 6000, 'the month starts as a full month');
    h.act('tab', '[data-tab="residents"]');
    await h.settle();
    h.click(h.q('.res-card'));
    await h.settle();
    h.act('ask-vacate');
    await h.settle();
    const f = h.q('#sheetLayer form[data-form="vacate"]');
    const today = new Date().getDate();
    f.elements['vacatingDate'].value = cur + '-' + pad2(today);
    h.submit(f);
    await h.settle(200);
    const after = dueOf(h, 'Leaver', cur);
    const stayed = Math.min(today, curDays);
    const prorated = Math.min(6000, Math.round(200 * stayed));
    if (full) {
      ok(after.rent === 6000, 'charge the full month: leaving mid-month keeps the full rent');
      ok(!after.pro, 'charge the full month: no part-month note');
    } else {
      ok(after.rent === prorated, 'pro-rated last month: ' + after.rent + ' for ' + stayed + ' days (expected ' + prorated + ')');
      if (stayed < curDays) ok(after.pro && after.pro.reason === 'leave', 'the due is marked as a leaving month');
    }
    ok(h.db().residents[0].status === 'Vacated', 'the resident is marked vacated');
    ok(h.db().residents[0].depositRefunded === false, 'the deposit flow is untouched');
  }

  /* ------------------------------------ 8. the card, a manual edit, and the records */
  {
    const h = boot(makeDb({ residents: [] }));
    await h.settle(220);
    h.act('tab', '[data-tab="residents"]');
    await h.settle();
    h.act('add-resident');
    await h.settle();
    let f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['name'].value = 'Hand Edited';
    f.elements['phone'].value = '9876500031';
    f.elements['idConsent'].checked = true;
    h.act('wiz-next');
    await h.settle(120);
    f = h.q('#sheetLayer form[data-form="resident"]');
    const roomSel = f.elements['roomId'];
    const roomOpt = Array.from(roomSel.options).filter((o) => o.value && !o.disabled)[0];
    roomSel.value = roomOpt.value;
    roomSel.dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(120);
    f = h.q('#sheetLayer form[data-form="resident"]');
    const bedOpt = Array.from(f.elements['bedId'].options).filter((o) => o.value)[0];
    f.elements['bedId'].value = bedOpt.value;
    f.elements['joiningDate'].value = cur + '-20';
    h.act('wiz-next');
    await h.settle(150);

    const card = text(h.q('.pro-card'));
    const days = curDays - 19;
    ok(/Rent \u20B96,500 . 30 days = \u20B9216\.67 per day/.test(card), 'the card shows rent / days = per-day rate: ' + card.slice(0, 80));
    ok(card.indexOf('Joined 20 ') !== -1 && card.indexOf(days + ' days (counting joining day)') !== -1, 'the card shows the joining date and days');
    ok(card.indexOf('\u20B9' + Math.round(216.67 * days).toLocaleString('en-IN')) !== -1 || /First month rent\u20B9[\d,]+/.test(card), 'the card shows the first-month rent');
    ok(!!h.q('#sheetLayer [data-group="firstMode"]'), 'Pro-rate / Full month buttons are offered');
    ok(!!h.q('#sheetLayer button[data-value="prorated"][aria-pressed="true"]'), 'Pro-rate is selected by default');
    ok(!!h.q('input[name="firstDays"]') && !!h.q('input[name="firstRent"]'), 'the days and the amount can be edited');

    // choose Full month and back
    h.click(h.q('#sheetLayer [data-group="firstMode"] button[data-value="full"]'));
    await h.settle(120);
    ok(/Full month/.test(text(h.q('.pro-card'))) && /Full monthly rent/.test(text(h.q('.pro-card'))), 'Full month shows the whole month');
    ok(!h.q('input[name="firstDays"]'), 'no day editor in full-month mode');
    h.click(h.q('#sheetLayer [data-group="firstMode"] button[data-value="prorated"]'));
    await h.settle(120);

    // edit the amount by hand
    f = h.q('#sheetLayer form[data-form="resident"]');
    const rentInput = f.elements['firstRent'];
    rentInput.value = '1500';
    rentInput.dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(150);
    ok(/edited/.test(text(h.q('.pro-card'))), 'the card marks a hand-edited amount');
    ok(!!h.q('[data-act="wiz-first-reset"]'), 'a reset-to-calculated button is offered');
    f = h.q('#sheetLayer form[data-form="resident"]');
    h.submit(f);
    await h.settle(220);

    const saved = h.db().residents.filter((r) => r.name === 'Hand Edited')[0];
    ok(!!saved, 'the resident is saved');
    ok(saved.firstMonth && saved.firstMonth.edited === true, 'the resident keeps the edited flag');
    const p = h.db().payments.filter((x) => x.residentId === saved.id && x.month === cur)[0];
    ok(p && p.rent === 1500, 'the edited amount is what the due charges: ' + (p && p.rent));
    ok(p && p.pro && p.pro.edited === true, 'the due remembers it was edited');

    // the due sheet, the WhatsApp message and the receipt all show the breakdown
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    h.act('open-due');
    await h.settle();
    const sheet = text(h.q('#sheetLayer'));
    ok(new RegExp(days + ' of 30 days @ \u20B9216\\.67').test(sheet), 'the due sheet shows the day breakdown');
    ok(/edited/.test(sheet), 'the due sheet marks the edited amount');
    const wa = h.q('#sheetLayer a[href^="https://wa.me/"]');
    ok(!!wa, 'the due sheet has a WhatsApp button');
    const link = decodeURIComponent((wa && wa.getAttribute('href')) || '');
    ok(link.indexOf(days + ' of 30 days') !== -1, 'the WhatsApp message fills {days}');
    ok(link.indexOf('\u20B9216.67') !== -1, 'the WhatsApp message fills {perday}');
    const payForm = h.q('#sheetLayer form[data-form="payment"]');
    payForm.elements['amount'].value = '500';
    payForm.elements['date'].value = cur + '-25';
    h.act('save-payment');
    await h.settle(250);
    const receipt = text(h.q('#sheetLayer'));
    ok(receipt.indexOf(days + ' of 30 days') !== -1, 'the receipt shows the day breakdown');
    ok(/balance|Balance left/i.test(receipt), 'the receipt still shows the balance');
  }

  /* ---------------------- 8b. Full month, an edited day count, and reset */
  async function wizardToRentStep(h) {
    h.act('tab', '[data-tab="residents"]');
    await h.settle();
    h.act('add-resident');
    await h.settle();
    let f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['name'].value = 'Wizard Person';
    f.elements['phone'].value = '9876500044';
    f.elements['idConsent'].checked = true;
    h.act('wiz-next');
    await h.settle(120);
    f = h.q('#sheetLayer form[data-form="resident"]');
    const roomSel = f.elements['roomId'];
    const roomOpt = Array.from(roomSel.options).filter((o) => o.value && !o.disabled)[0];
    roomSel.value = roomOpt.value;
    roomSel.dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(120);
    f = h.q('#sheetLayer form[data-form="resident"]');
    const bedOpt = Array.from(f.elements['bedId'].options).filter((o) => o.value)[0];
    f.elements['bedId'].value = bedOpt.value;
    f.elements['joiningDate'].value = cur + '-20';
    h.act('wiz-next');
    await h.settle(150);
    return h.q('#sheetLayer form[data-form="resident"]');
  }
  {
    const h = boot(makeDb({ residents: [] }));
    await h.settle(220);
    let f = await wizardToRentStep(h);
    h.click(h.q('#sheetLayer [data-group="firstMode"] button[data-value="full"]'));
    await h.settle(120);
    f = h.q('#sheetLayer form[data-form="resident"]');
    h.submit(f);
    await h.settle(220);
    const saved = h.db().residents.filter((r) => r.name === 'Wizard Person')[0];
    ok(saved && saved.firstMonth && saved.firstMonth.mode === 'full', 'Full month is remembered on the resident');
    const p = h.db().payments.filter((x) => x.residentId === saved.id && x.month === cur)[0];
    ok(p && p.rent === 6500, 'Full month charges the whole rent: ' + (p && p.rent));
    ok(p && !p.pro, 'Full month leaves no part-month note');
  }
  {
    const h = boot(makeDb({ residents: [] }));
    await h.settle(220);
    let f = await wizardToRentStep(h);
    const daysEl = f.elements['firstDays'];
    daysEl.value = '5';
    daysEl.dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(150);
    ok(/edited/.test(text(h.q('.pro-card'))), 'editing the days marks the card as edited');
    f = h.q('#sheetLayer form[data-form="resident"]');
    ok(Number(f.elements['firstRent'].value) === Math.round(216.67 * 5), 'the amount follows the edited days: ' + f.elements['firstRent'].value);
    h.click(h.q('[data-act="wiz-first-reset"]'));
    await h.settle(150);
    ok(!/edited/.test(text(h.q('.pro-card'))), 'the reset button clears the edit');
    f = h.q('#sheetLayer form[data-form="resident"]');
    ok(Number(f.elements['firstDays'].value) === curDays - 19, 'the reset restores all the days');
    daysEl.value = '5';
    const daysEl2 = h.q('#sheetLayer form[data-form="resident"]').elements['firstDays'];
    daysEl2.value = '5';
    daysEl2.dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(150);
    h.submit(h.q('#sheetLayer form[data-form="resident"]'));
    await h.settle(220);
    const saved = h.db().residents.filter((r) => r.name === 'Wizard Person')[0];
    const p = h.db().payments.filter((x) => x.residentId === saved.id && x.month === cur)[0];
    ok(saved.firstMonth && saved.firstMonth.days === 5 && saved.firstMonth.edited === true, 'the edited day count is saved');
    ok(p && p.rent === Math.round(216.67 * 5), 'the due charges the edited days: ' + (p && p.rent));
  }

  /* --------------------------- 9. settings recalculate dues, but never paid ones */
  {
    const h = boot(makeDb({ residents: [{ name: 'Setting Change', joiningDate: cur + '-20', rent: 6500 }] }));
    await h.settle(220);
    const before = dueOf(h, 'Setting Change', cur);
    ok(before.pro.days === curDays - 19, 'starts on ' + (curDays - 19) + ' days');
    h.act('tab', '[data-tab="home"]');
    await h.settle();
    h.act('settings');
    await h.settle();
    ok(!!h.q('input[name="basis_prop_ladies"]') && !!h.q('input[name="joinDay_prop_ladies"]') && !!h.q('input[name="rounding_prop_ladies"]') &&
      !!h.q('input[name="prorateElec_prop_ladies"]') && !!h.q('input[name="fullOnLeave_prop_ladies"]'), 'hostel settings hold all five choices');
    ok(h.q('input[name="basis_prop_ladies"]').value === 'fixed30', 'day-rate basis defaults to Fixed 30 days');
    ok(h.q('input[name="joinDay_prop_ladies"]').value === 'yes', 'joining day is counted by default');
    ok(h.q('input[name="rounding_prop_ladies"]').value === 'nearest', 'rounding defaults to nearest rupee');
    ok(h.q('input[name="prorateElec_prop_ladies"]').value === 'no', 'electricity is not pro-rated by default');
    ok(h.q('input[name="fullOnLeave_prop_ladies"]').value === 'yes', 'a mid-month leave charges the full month by default');

    h.click(h.q('[data-group="joinDay_prop_ladies"] button[data-value="no"]'));
    await h.settle(60);
    ok(h.q('input[name="joinDay_prop_ladies"]').value === 'no', 'the chip updates the choice');
    h.submit(h.q('form[data-form="hostelSettings"]'));
    await h.settle(250);
    const after = dueOf(h, 'Setting Change', cur);
    ok(after.pro.days === curDays - 20, 'the due is recalculated to ' + (curDays - 20) + ' days');
    ok(after.rent === Math.round(216.67 * (curDays - 20)), 'the recalculated rent follows the new days: ' + after.rent);
    ok(/updated/.test(text(h.q('#toast'))), 'the save reports what changed: ' + text(h.q('#toast')));

    // a due with money against it must not move
    h.act('tab', '[data-tab="payments"]');
    await h.settle();
    h.act('open-due');
    await h.settle();
    const pf = h.q('#sheetLayer form[data-form="payment"]');
    pf.elements['amount'].value = '100';
    pf.elements['date'].value = cur + '-' + pad2(Math.min(new Date().getDate(), curDays));
    h.act('save-payment');
    await h.settle(250);
    h.act('receipt-done');
    await h.settle(120);
    const paidDue = dueOf(h, 'Setting Change', cur);
    const paidRent = paidDue.rent;
    ok(paidRent > 0 && paidDue.paid === 100, 'the payment is recorded: ' + paidDue.paid);

    h.act('tab', '[data-tab="home"]');
    await h.settle();
    h.act('settings');
    await h.settle();
    h.click(h.q('[data-group="joinDay_prop_ladies"] button[data-value="yes"]'));
    await h.settle(60);
    h.submit(h.q('form[data-form="hostelSettings"]'));
    await h.settle(250);
    const still = dueOf(h, 'Setting Change', cur);
    ok(still.rent === paidRent, 'a due with a payment is left unchanged: ' + still.rent + ' vs ' + paidRent);
    ok(/already have payments|left unchanged/i.test(text(h.q('.screen'))), 'a warning is shown for the dues that were kept');
    ok(/left as they were/.test(text(h.q('#toast'))), 'the toast warns too: ' + text(h.q('#toast')));
    h.act('dismiss-mid-warn');
    await h.settle(120);
    ok(!/already have payments/i.test(text(h.q('.screen'))), 'the warning can be dismissed');
  }

  console.log(failures === 0 ? '\nALL PRORATE TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
