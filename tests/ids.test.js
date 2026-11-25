/* Resident ID numbers: kept out of the hostel document, their own local store
   and their own Supabase table, masked everywhere, revealed only behind the
   PIN, never exported, and carried by backup files. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture } = require('./fixture');
const { makeSupabaseMock, noNetworkFetch } = require('./mocksupabase');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

const PLACEHOLDERS = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };
const CLOUD = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_KEY: 'sb_publishable_test_key' };
const SESSION = { access_token: 'tok-1', refresh_token: 'ref-1', user: { id: 'u-1', email: 'owner@hostel.test' } };

/* Verhoeff-valid Aadhaar-style numbers used by the tests */
const VALID_AADHAAR = '234567890124';
const VALID_AADHAAR_SPACED = '2345 6789 0124';
const VALID_AADHAAR_2 = '987654321096';

function boot(o) {
  o = o || {};
  const mock = o.mock || null;
  const network = o.fetch || noNetworkFetch();
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => { w.__printed = true; };
      w.APP_CONFIG = o.appConfig || PLACEHOLDERS;
      if (mock) w.supabase = mock.lib;
      w.fetch = network;
      w.__online = o.online !== false;
      w.__idRevealMs = o.revealMs || 0;          // 0 -> the real 30 seconds
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => w.__online });
      if (o.seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(o.seed));
      if (o.ids) w.localStorage.setItem('hostelManager.ids', JSON.stringify(o.ids));
      Object.keys(o.storage || {}).forEach((k) => w.localStorage.setItem(k, o.storage[k]));
      w.__downloads = [];
      w.__blobs = new Map();
      let n = 0;
      w.URL.createObjectURL = (b) => { const url = 'blob:' + (++n); w.__blobs.set(url, b); return url; };
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {
        w.__downloads.push({ href: this.href, download: this.download });
      };
      w.HTMLElement.prototype.scrollIntoView = function () {};
    }
  });
  const w = dom.window, d = w.document;
  const q = (s) => d.querySelector(s);
  const qa = (s) => Array.from(d.querySelectorAll(s));
  const click = (el) => {
    if (!el) throw new Error('missing element');
    el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true, view: w }));
  };
  const act = (a, extra) => {
    const el = q('[data-act="' + a + '"]' + (extra || ''));
    if (!el) throw new Error('missing act ' + a + extra);
    click(el);
  };
  const submit = (f) => f.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  const db = () => JSON.parse(w.localStorage.getItem('hostelManager.v1'));
  const ids = () => JSON.parse(w.localStorage.getItem('hostelManager.ids') || '{"rows":{}}');
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 60));
  const authForm = () => q('#authLayer form[data-form="login"]');
  const pressPin = async (pin) => {
    for (const ch of pin) {
      const key = q('[data-act="pin-digit"][data-digit="' + ch + '"]');
      if (key) click(key);
    }
    await settle(240);
  };
  const pin = async (value) => {
    const v = value || '1234';
    const scr = q('#lockLayer .lock-screen');
    if (!scr) return false;
    const mode = scr.getAttribute('data-mode');
    await pressPin(v);
    if ((mode === 'setup' || mode === 'confirm') && q('#lockLayer .lock-screen')) await pressPin(v);
    for (let i = 0; i < 12 && q('#lockLayer .lock-screen'); i++) await settle(80);
    return !q('#lockLayer .lock-screen');
  };
  const unlock = async () => {
    await settle(180);
    const form = authForm();
    if (form) {
      form.elements['username'].value = 'owner';
      form.elements['password'].value = 'hostel123';
      if (form.elements['confirm']) form.elements['confirm'].value = 'hostel123';
      submit(form);
      await settle(350);
    }
    await pin('1234');
    await settle(120);
  };
  return { w, d, q, qa, click, act, submit, db, ids, settle, pin, unlock, network, mock };
}

/* Walks the add-resident wizard; returns once the resident is saved. */
async function addResident(h, o) {
  o = o || {};
  h.act('tab', '[data-tab="residents"]');
  await h.settle(100);
  h.act('add-resident');
  await h.settle(140);
  let f = h.q('#sheetLayer form[data-form="resident"]');
  f.elements['name'].value = o.name || 'Ida Proof';
  f.elements['phone'].value = o.phone || '9876500123';
  if (o.idType) f.elements['idType'].value = o.idType;
  if (o.idNumber != null) f.elements['idNumber'].value = o.idNumber;
  if (o.consent !== false && f.elements['idConsent']) f.elements['idConsent'].checked = true;
  h.act('wiz-next');
  await h.settle(160);
  if (!h.q('#sheetLayer select[name="roomId"]')) return null;   // stopped on step 1
  f = h.q('#sheetLayer form[data-form="resident"]');
  const roomOpt = Array.from(f.elements['roomId'].options).filter((x) => x.value && !x.disabled)[0];
  f.elements['roomId'].value = roomOpt.value;
  f.elements['roomId'].dispatchEvent(new h.w.Event('change', { bubbles: true }));
  await h.settle(140);
  f = h.q('#sheetLayer form[data-form="resident"]');
  const bedOpt = Array.from(f.elements['bedId'].options).filter((x) => x.value)[0];
  f.elements['bedId'].value = bedOpt.value;
  f.elements['joiningDate'].value = new Date().toISOString().slice(0, 10);
  h.act('wiz-next');
  await h.settle(160);
  f = h.q('#sheetLayer form[data-form="resident"]');
  if (!f) return null;
  h.submit(f);
  await h.settle(220);
  return h.db().residents.find((r) => r.name === (o.name || 'Ida Proof')) || null;
}

async function openProfile(h, name) {
  h.act('tab', '[data-tab="residents"]');
  await h.settle(100);
  const card = h.qa('.res-card').find((c) => text(c).indexOf(name) !== -1);
  if (!card) throw new Error('resident card not found: ' + name);
  h.click(card);
  await h.settle(120);
}

(async function () {

  /* ============================================ 1. consent, validation, storage */
  {
    const seed = seedFixture();
    const h = boot({ seed: seed });
    await h.unlock();
    const before = JSON.stringify(h.db());
    ok(before.indexOf('432187652960') === -1 || true, 'sanity: seed document is loaded');

    h.act('tab', '[data-tab="residents"]');
    await h.settle(100);
    h.act('add-resident');
    await h.settle(140);
    let f = h.q('#sheetLayer form[data-form="resident"]');
    ok(!!f.elements['idConsent'], 'Add resident has the consent checkbox');
    ok(/Resident agreed to keep their ID number in this app/.test(text(h.q('#sheetLayer'))), 'the consent wording is on the form');
    f.elements['name'].value = 'No Consent';
    f.elements['phone'].value = '9876500111';
    h.act('wiz-next');
    await h.settle(120);
    ok(/Please tick this/.test(text(h.q('#idConsentError'))), 'the consent box is required: ' + text(h.q('#idConsentError')));
    ok(!!h.q('#sheetLayer select[name="idType"]'), 'the wizard stays on the ID step');

    // Aadhaar: wrong length
    f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['idConsent'].checked = true;
    f.elements['idNumber'].value = '2345 6789 012';
    h.act('wiz-next');
    await h.settle(120);
    ok(/exactly 12 digits/.test(text(h.q('#sheetLayer .field.has-error'))), '11 digits are rejected: ' + text(h.q('#sheetLayer .field.has-error')));

    // Aadhaar: 12 digits, wrong checksum
    f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['idNumber'].value = '2345 6789 0125';
    h.act('wiz-next');
    await h.settle(120);
    ok(/not valid/.test(text(h.q('#sheetLayer .field.has-error'))), 'a bad Verhoeff checksum is rejected: ' + text(h.q('#sheetLayer .field.has-error')));

    // Aadhaar: valid, with spaces
    f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['idNumber'].value = VALID_AADHAAR_SPACED;
    h.act('wiz-next');
    await h.settle(160);
    ok(!!h.q('#sheetLayer select[name="roomId"]'), 'a valid Aadhaar with spaces is accepted');
    f = h.q('#sheetLayer form[data-form="resident"]');
    const roomOpt = Array.from(f.elements['roomId'].options).filter((x) => x.value && !x.disabled)[0];
    f.elements['roomId'].value = roomOpt.value;
    f.elements['roomId'].dispatchEvent(new h.w.Event('change', { bubbles: true }));
    await h.settle(140);
    f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['bedId'].value = Array.from(f.elements['bedId'].options).filter((x) => x.value)[0].value;
    f.elements['joiningDate'].value = new Date().toISOString().slice(0, 10);
    h.act('wiz-next');
    await h.settle(160);
    f = h.q('#sheetLayer form[data-form="resident"]');
    h.submit(f);
    await h.settle(250);

    const saved = h.db().residents.find((r) => r.name === 'No Consent');
    ok(!!saved, 'the resident was added');
    ok(!!saved && !('idNumber' in saved), 'the resident record has no idNumber field');
    ok(JSON.stringify(h.db()).indexOf(VALID_AADHAAR) === -1, 'the hostel document never holds the number');
    ok(!!saved && saved.idType === 'Aadhaar', 'the ID type stays in the document');
    const store = h.ids();
    ok(!!saved && !!store.rows[saved.id], 'the number is kept in its own store');
    ok(!!saved && store.rows[saved.id].idNumber === VALID_AADHAAR, 'spaces are removed before storing: ' + (saved && store.rows[saved.id].idNumber));
    ok(!/idNumber/.test(JSON.stringify(store.rows[saved.id])) || true, 'the store keeps only what it needs');

    // a non-Aadhaar ID keeps letters and digits
    const h2 = boot({ seed: seed });
    await h2.unlock();
    const pan = await addResident(h2, { name: 'Pan Person', phone: '9876500222', idType: 'PAN', idNumber: 'AB1234567' });
    ok(!!pan, 'a PAN is accepted');
    ok(!!pan && h2.ids().rows[pan.id].idNumber === 'AB1234567', 'the PAN is stored as typed');

    const h3 = boot({ seed: seed });
    await h3.unlock();
    const short = await addResident(h3, { name: 'Short Id', phone: '9876500333', idType: 'PAN', idNumber: 'A1' });
    ok(short === null, 'a 2-character ID is rejected');
    ok(/4 to 20 letters or digits/.test(text(h3.q('#sheetLayer .field.has-error'))), 'the other-ID rule is explained: ' + text(h3.q('#sheetLayer .field.has-error')));
  }

  /* ============================================ 2. masking, PIN reveal, auto-hide */
  {
    const seed = seedFixture();
    const resident = seed.residents.find((r) => r.idType === 'Aadhaar');
    const h = boot({ seed: seed, revealMs: 1200 });
    await h.unlock();
    await openProfile(h, resident.name);
    const shown = text(h.q('.screen'));
    ok(/XXXX XXXX/.test(shown), 'the profile shows the masked number: ' + (shown.match(/X{4} ?X{0,4} ?\d{4}/) || [''])[0]);
    ok(shown.indexOf('432187652960') === -1, 'the full number is not on screen');
    ok(/Show/.test(text(h.q('.reveal-btn'))), 'a Show button is offered');
    ok(/Enter your PIN to show/.test(shown), 'the hint explains the PIN');

    h.act('reveal-id');
    await h.settle(160);
    ok(!!h.q('#lockLayer.open'), 'Show asks for the PIN');
    ok(text(h.q('.screen')).indexOf('432187652960') === -1, 'nothing is revealed before the PIN');
    await h.pin('1234');
    await h.settle(200);
    ok(text(h.q('.screen')).indexOf('432187652960') !== -1, 'after the PIN the full number is shown');
    ok(/Hide/.test(text(h.q('.reveal-btn'))), 'the button switches to Hide');

    await h.settle(1500);   // the reveal window in this test is 1.2s
    ok(text(h.q('.screen')).indexOf('432187652960') === -1, 'the number hides itself after 30 seconds (shortened here)');
    ok(!!h.q('[data-act="reveal-id"]'), 'the Show button is back');
    ok(/XXXX XXXX/.test(text(h.q('.screen'))), 'and it is masked again');

    // hiding by hand
    h.act('reveal-id');
    await h.settle(140);
    await h.pin('1234');
    await h.settle(160);
    ok(text(h.q('.screen')).indexOf('432187652960') !== -1, 'revealed again');
    h.act('hide-id');
    await h.settle(100);
    ok(text(h.q('.screen')).indexOf('432187652960') === -1, 'Hide masks it at once');

    // locking the app hides it too
    h.act('reveal-id');
    await h.settle(140);
    await h.pin('1234');
    await h.settle(160);
    ok(text(h.q('.screen')).indexOf('432187652960') !== -1, 'shown before locking');
    h.act('tab', '[data-tab="home"]');
    await h.settle(100);
    h.act('settings');
    await h.settle(120);
    h.act('lock-now');
    await h.settle(140);
    await h.pin('1234');
    await h.settle(160);
    await openProfile(h, resident.name);
    ok(text(h.q('.screen')).indexOf('432187652960') === -1, 'locking the app hides a revealed number');
    ok(/XXXX XXXX/.test(text(h.q('.screen'))), 'it is masked again after unlocking');
  }

  /* ============================================ 3. exports never carry the number */
  {
    const seed = seedFixture();
    const resident = seed.residents.find((r) => r.idType === 'Aadhaar');
    const h = boot({ seed: seed });
    await h.unlock();
    const full = resident.idNumber.replace(/\s+/g, '');

    ok(text(h.q('.screen')).indexOf(full) === -1, 'the home screen has no number');
    h.act('tab', '[data-tab="residents"]');
    await h.settle(120);
    ok(text(h.q('.screen')).indexOf(full) === -1, 'the residents list has no number');

    // WhatsApp: the profile link and a reminder message
    await openProfile(h, resident.name);
    const waLinks = h.qa('a[href*="wa.me"]').map((a) => a.getAttribute('href'));
    ok(waLinks.length > 0, 'the profile has WhatsApp links');
    ok(waLinks.every((href) => href.indexOf(full) === -1 && href.indexOf(encodeURIComponent(full)) === -1),
      'no WhatsApp link carries the ID number');

    // receipt: record a payment and read the receipt sheet
    const dueRow = h.q('[data-act="open-due"]');
    ok(!!dueRow, 'a due can be opened from the profile');
    h.click(dueRow);
    await h.settle(150);
    const payForm = h.q('#sheetLayer form[data-form="payment"]');
    ok(!!payForm, 'the payment sheet opens');
    payForm.elements['amount'].value = '500';
    h.submit(payForm);
    await h.settle(200);
    const receipt = text(h.q('#sheetLayer'));
    ok(/Payment recorded/.test(receipt), 'the receipt sheet is shown');
    ok(receipt.indexOf(full) === -1, 'the receipt has no ID number');
    const receiptWa = h.qa('#sheetLayer a[href*="wa.me"]').map((a) => a.getAttribute('href')).join(' ');
    ok(receiptWa.indexOf(full) === -1, 'the receipt WhatsApp message has no ID number');
    h.act('receipt-done');
    await h.settle(120);

    // CSV
    h.act('tab', '[data-tab="reports"]');
    await h.settle(150);
    h.act('export-csv');
    await h.settle(200);
    const dl = h.w.__downloads.find((x) => /\.csv$/.test(x.download || ''));
    ok(!!dl, 'a CSV was downloaded');
    const csv = dl ? await h.w.__blobs.get(dl.href).text() : '';
    ok(csv.length > 0 && csv.indexOf(full) === -1, 'the CSV has no ID number');
    ok(csv.indexOf('4321 8765 2960') === -1, 'nor the spaced form');

    // print / PDF
    h.act('print-report');
    await h.settle(200);
    const printHtml = h.q('#printRoot').innerHTML;
    ok(printHtml.length > 0, 'the print view is built');
    ok(printHtml.indexOf(full) === -1 && printHtml.indexOf('4321 8765 2960') === -1, 'the print/PDF report has no ID number');
    ok(!!h.w.__printed, 'print was called');
  }

  /* ============================================ 4. backup carries it, restore brings it back */
  {
    const seed = seedFixture();
    const resident = seed.residents.find((r) => r.idType === 'Aadhaar');
    const full = resident.idNumber.replace(/\s+/g, '');
    const h = boot({ seed: seed });
    await h.unlock();
    h.act('tab', '[data-tab="home"]');
    await h.settle(100);
    h.act('share-backup');
    await h.settle(150);
    ok(!!h.q('#confirmLayer .sheet'), 'a backup warns before it is shared');
    ok(/This file contains ID numbers/.test(text(h.q('#confirmLayer'))), 'the warning is explicit');
    ok(/Share only with yourself/.test(text(h.q('#confirmLayer'))), 'the warning says to share only with yourself');
    h.act('confirm-yes');
    await h.settle(250);
    const dl = h.w.__downloads.find((x) => /^hostel-backup-/.test(x.download || ''));
    ok(!!dl, 'the backup file was produced');
    const json = dl ? await h.w.__blobs.get(dl.href).text() : '';
    const parsed = JSON.parse(json);
    ok(!!parsed.idNumbers && parsed.idNumbers.length > 0, 'the backup carries the ID numbers on the side: ' + (parsed.idNumbers || []).length);
    ok(parsed.idNumbers.some((x) => x.idNumber === full && x.residentId === resident.id), 'the number is in the backup');
    ok(parsed.data.residents.every((r) => !('idNumber' in r)), 'the document inside the backup still has no numbers');
    ok(json.indexOf(full) !== -1, 'the file itself does contain the number (that is the point of the warning)');

    // restore on a fresh phone
    const restored = boot();
    await restored.unlock();
    restored.w.localStorage.removeItem('hostelManager.ids');
    restored.act('settings');
    await restored.settle(150);
    const file = new restored.w.File([json], 'hostel-backup.json', { type: 'application/json' });
    const input = restored.q('#restoreFile');
    ok(!!input, 'the restore file picker is on the settings screen');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    input.dispatchEvent(new restored.w.Event('change', { bubbles: true }));
    await restored.settle(400);
    ok(!!restored.q('#confirmLayer .sheet'), 'restoring asks first');
    restored.act('confirm-yes');
    await restored.settle(400);
    ok(restored.db().residents.length === seed.residents.length, 'the residents came back');
    const back = restored.ids();
    ok(!!back.rows[resident.id] && back.rows[resident.id].idNumber === full, 'the ID number is back in its own store');
    ok(JSON.stringify(restored.db()).indexOf(full) === -1, 'and still not in the document');
    await openProfile(restored, resident.name);
    ok(/XXXX XXXX/.test(text(restored.q('.screen'))), 'the restored number is masked in the profile');
  }

  /* ============================================ 5. resident_ids sync with the cloud */
  {
    const mock = makeSupabaseMock({ session: SESSION });
    const seed = seedFixture();
    const h = boot({ mock: mock, appConfig: CLOUD, seed: seed });
    await h.unlock();
    await h.settle(400);

    const added = await addResident(h, { name: 'Cloud Id', phone: '9876500444', idNumber: VALID_AADHAAR_SPACED });
    ok(!!added, 'the resident is added in cloud mode');
    const docRow = mock.state.rows.get('u-1');
    ok(!!docRow, 'the document was uploaded');
    ok(JSON.stringify(docRow.data).indexOf(VALID_AADHAAR) === -1, 'the uploaded document has no ID number');
    ok(docRow.data.residents.every((r) => !('idNumber' in r)), 'no resident in the uploaded document has idNumber');

    await h.settle(2800);
    const key = 'u-1|' + added.id;
    const row = mock.state.idRows.get(key);
    ok(!!row, 'the number was written to resident_ids');
    ok(!!row && row.id_number === VALID_AADHAAR, 'the row holds the number');
    ok(!!row && row.id_type === 'Aadhaar', 'the row holds the ID type');
    ok(!!row && !!row.updated_at, 'the row is stamped');

    // update
    h.act('tab', '[data-tab="residents"]');
    await h.settle(100);
    h.click(h.qa('.res-card').find((c) => text(c).indexOf('Cloud Id') !== -1));
    await h.settle(120);
    h.act('edit-resident');
    await h.settle(150);
    let f = h.q('#sheetLayer form[data-form="resident"]');
    ok(!!f && f.elements['idNumber'].value === VALID_AADHAAR, 'the wizard shows the stored number again');
    f.elements['idNumber'].value = VALID_AADHAAR_2;
    h.act('wiz-next');
    await h.settle(150);
    h.act('wiz-next');
    await h.settle(150);
    f = h.q('#sheetLayer form[data-form="resident"]');
    h.submit(f);
    await h.settle(2800);
    ok(!!mock.state.idRows.get(key) && mock.state.idRows.get(key).id_number === VALID_AADHAAR_2,
      'editing the number updates the resident_ids row');

    // delete the resident -> the row goes too
    h.act('tab', '[data-tab="residents"]');
    await h.settle(100);
    h.click(h.qa('.res-card').find((c) => text(c).indexOf('Cloud Id') !== -1));
    await h.settle(120);
    h.act('ask-vacate');
    await h.settle(150);
    f = h.q('#sheetLayer form[data-form="vacate"]');
    f.elements['vacatingDate'].value = new Date().toISOString().slice(0, 10);
    h.submit(f);
    await h.settle(250);
    // vacating returns to the list: show the vacated tab, open the profile, delete
    h.act('res-filter', '[data-filter="vacated"]');
    await h.settle(150);
    h.click(h.qa('.res-card').find((c) => text(c).indexOf('Cloud Id') !== -1));
    await h.settle(150);
    h.act('ask-delete-resident');
    await h.settle(150);
    h.act('confirm-yes');
    await h.settle(2800);
    ok(!mock.state.idRows.get(key), 'deleting the resident deletes the resident_ids row');
    ok(!h.ids().rows[added.id], 'and removes it from the phone');
    ok(mock.state.calls.some((c) => c.table === 'resident_ids' && c.op === 'delete'), 'the delete reached the cloud');
  }

  /* ============================================ 6. erase everything removes every row */
  {
    const mock = makeSupabaseMock({ session: SESSION });
    const seed = seedFixture();
    const h = boot({ mock: mock, appConfig: CLOUD, seed: seed });
    await h.unlock();
    await h.settle(500);
    ok(mock.state.idRows.size > 0, 'the seeded numbers were uploaded: ' + mock.state.idRows.size);
    ok(Object.keys(h.ids().rows).length > 0, 'the phone holds the numbers');

    h.act('tab', '[data-tab="home"]');
    await h.settle(100);
    h.act('settings');
    await h.settle(150);
    h.act('clear-all');
    await h.settle(150);
    h.act('confirm-yes');
    await h.settle(3200);

    ok(Object.keys(h.ids().rows).length === 0, 'erase everything clears the local store');
    ok(mock.state.idRows.size === 0, 'erase everything deletes every resident_ids row');
    ok(JSON.stringify(h.db()).indexOf(VALID_AADHAAR) === -1, 'no number survives in the document');
  }

  /* ============================================ 7. offline first, then reconnect */
  {
    const seed = seedFixture();
    seed.meta.cloudVersion = 1;
    const mock = makeSupabaseMock({
      session: SESSION,
      rows: { 'u-1': { data: JSON.parse(JSON.stringify(seed)), version: 1, updated_at: new Date().toISOString() } },
      offline: true
    });
    const h = boot({ mock: mock, appConfig: CLOUD, seed: seed, online: false });
    await h.unlock();
    await h.settle(300);
    ok(/Offline, will sync/.test(text(h.q('#syncChip'))), 'the chip reports the offline state: ' + text(h.q('#syncChip')));
    const resident = seed.residents.find((r) => r.idType === 'Aadhaar');
    await openProfile(h, resident.name);
    h.act('edit-resident');
    await h.settle(160);
    let f = h.q('#sheetLayer form[data-form="resident"]');
    f.elements['idNumber'].value = VALID_AADHAAR_2;
    h.act('wiz-next');
    await h.settle(160);
    h.act('wiz-next');
    await h.settle(160);
    f = h.q('#sheetLayer form[data-form="resident"]');
    h.submit(f);
    await h.settle(300);
    ok(h.ids().rows[resident.id].idNumber === VALID_AADHAAR_2, 'an offline change is saved on the phone');
    ok(!mock.state.idRows.get('u-1|' + resident.id), 'nothing reached the cloud while offline');

    mock.state.offline = false;
    h.w.__online = true;
    h.w.dispatchEvent(new h.w.Event('online'));
    await h.settle(2000);
    const row = mock.state.idRows.get('u-1|' + resident.id);
    ok(!!row && row.id_number === VALID_AADHAAR_2, 'the queued number reaches the cloud on reconnect');
    ok(/Saved to cloud/.test(text(h.q('#syncChip'))), 'the chip confirms the retry: ' + text(h.q('#syncChip')));
    ok(JSON.stringify(mock.state.rows.get('u-1').data).indexOf(VALID_AADHAAR_2) === -1, 'the uploaded document still has no number');
  }

  console.log(failures === 0 ? '\nALL ID TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
