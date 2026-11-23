/* Security + comfort tests: PIN lock, masked IDs, backup sharing, rent change, large text */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }
const pad = (n) => String(n).padStart(2, '0');
const thisMk = () => { const n = new Date(); return n.getFullYear() + '-' + pad(n.getMonth() + 1); };
const monthAdd = (mk, delta) => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
};

function boot(pinRecord, seedDB) {
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      if (pinRecord) w.localStorage.setItem('hostelManager.pin', pinRecord);
      if (seedDB) w.localStorage.setItem('hostelManager.v1', JSON.stringify(seedDB));
      w.__downloads = [];
      let n = 0;
      w.URL.createObjectURL = () => 'blob:' + (++n);
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__downloads.push({ name: this.download }); };
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
  const pin = async (digits) => {
    for (const dig of String(digits)) {
      const key = q('.lock-key[data-digit="' + dig + '"]');
      if (!key) throw new Error('no keypad for digit ' + dig);
      click(key);
    }
    await settle(260);
  };
  const setVisibility = (state) => {
    Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => state });
    d.dispatchEvent(new w.Event('visibilitychange'));
  };
  return { w, d, q, qa, click, act, submit, db, settle, pin, setVisibility };
}

(async function () {
  // ------------------------------------------------------------ first run: set a PIN from Settings
  const first = boot();
  await first.settle();
  ok(!first.q('#lockLayer.open'), 'a fresh phone opens without a PIN');
  ok(!!first.q('.hero'), 'home is usable straight away');
  first.act('settings');
  await first.settle();
  ok(!!first.q('[data-act="set-pin"]'), 'settings offers to set a PIN');
  ok(/Set a PIN/.test(text(first.q('.screen'))), 'set PIN row is explained');
  first.act('set-pin');
  await first.settle(60);
  ok(!!first.q('#lockLayer.open'), 'setting a PIN opens the lock screen');
  ok(/Create your PIN/.test(text(first.q('.lock-title'))), 'it asks to create a PIN: ' + text(first.q('.lock-title')));
  ok(first.d.body.classList.contains('is-locked'), 'lock screen pauses the app behind it');

  first.act('pin-cancel');
  ok(!first.q('#lockLayer.open'), 'Not now closes the PIN setup');
  ok(!first.w.localStorage.getItem('hostelManager.pin'), 'no PIN is stored when cancelled');

  first.act('set-pin');
  await first.settle(60);
  await first.pin('12');
  ok(first.qa('.pin-dots span.on').length === 2, 'dots fill as digits are pressed');
  first.act('pin-delete');
  ok(first.qa('.pin-dots span.on').length === 1, 'delete removes the last digit');
  await first.pin('234');
  ok(first.q('.lock-screen').getAttribute('data-mode') === 'confirm', 'after 4 digits it asks to confirm');

  await first.pin('9999');
  ok(first.q('.lock-screen').getAttribute('data-mode') === 'setup', 'mismatched confirm goes back to setup');
  ok(/did not match/i.test(text(first.q('.lock-msg'))), 'mismatch explains what happened');

  await first.pin('1234');
  await first.pin('1234');
  ok(!first.q('#lockLayer.open'), 'matching confirm removes the lock');
  ok(/PIN set/.test(text(first.q('#toast'))), 'toast confirms the PIN is set');
  ok(/Change PIN/.test(text(first.q('.screen'))), 'settings now shows Change PIN');

  const recordRaw = first.w.localStorage.getItem('hostelManager.pin');
  ok(!!recordRaw, 'a PIN record is stored on the phone');
  const record = JSON.parse(recordRaw || '{}');
  ok(!!record.salt && !!record.hash, 'record keeps a salt and a hash');
  ok(recordRaw.indexOf('1234') === -1, 'the raw PIN is not stored');
  const savedDb = JSON.stringify(first.db());
  ok(savedDb.indexOf('1234') === -1 && !first.db().settings.pin, 'the PIN is never written into hostel data');

  // ------------------------------------------------------------ reload: wrong then right PIN
  const second = boot(recordRaw);
  await second.settle();
  ok(!!second.q('#lockLayer.open'), 'reopening the app shows the lock');
  ok(/Enter your PIN/.test(text(second.q('.lock-title'))), 'lock asks for the existing PIN');
  ok(!!second.q('[data-act="pin-help"]'), 'forgot PIN link is offered');

  await second.pin('0000');
  ok(!!second.q('#lockLayer.open'), 'a wrong PIN keeps the app locked');
  ok(/Incorrect PIN/i.test(text(second.q('.lock-msg'))), 'wrong PIN shows a friendly message');

  await second.pin('1234');
  ok(!second.q('#lockLayer.open'), 'the correct PIN unlocks');
  ok(!!second.q('.hero'), 'home renders after unlocking');

  // ------------------------------------------------------------ forgot PIN help
  const third = boot(recordRaw);
  await third.settle();
  third.act('pin-help');
  ok(!!third.q('.lock-help'), 'forgot PIN opens the help panel');
  ok(/restore a backup/i.test(text(third.q('.lock-help'))), 'help says the only reset is restoring a backup');
  third.act('pin-help-close');
  ok(!!third.q('.lock-keypad'), 'help can be dismissed');

  // ------------------------------------------------------------ change PIN in settings
  second.act('settings');
  await second.settle();
  ok(/Change PIN/.test(text(second.q('.screen'))), 'settings has a Change PIN row');
  second.act('change-pin');
  await second.settle();
  const pinForm = second.q('#sheetLayer form[data-form="changePin"]');
  ok(!!pinForm, 'change PIN sheet opens');
  pinForm.elements['current'].value = '9999';
  pinForm.elements['next'].value = '4321';
  pinForm.elements['confirm'].value = '4321';
  second.submit(pinForm);
  await second.settle(300);
  ok(/not the current PIN/i.test(text(second.q('#sheetLayer'))), 'wrong current PIN is rejected');

  pinForm.elements['current'].value = '1234';
  pinForm.elements['next'].value = '4321';
  pinForm.elements['confirm'].value = '4321';
  second.submit(pinForm);
  await second.settle(400);
  ok(!second.q('#sheetLayer form[data-form="changePin"]'), 'change PIN sheet closes on success');
  ok(/PIN changed/.test(text(second.q('#toast'))), 'toast confirms the new PIN');
  const newRecordRaw = second.w.localStorage.getItem('hostelManager.pin');
  ok(newRecordRaw !== recordRaw, 'a new PIN record replaces the old one');

  const fourth = boot(newRecordRaw);
  await fourth.settle();
  await fourth.pin('4321');
  ok(!fourth.q('#lockLayer.open'), 'the new PIN works on the next launch');
  const fifth = boot(newRecordRaw);
  await fifth.settle();
  await fifth.pin('1234');
  ok(!!fifth.q('#lockLayer.open'), 'the old PIN no longer works');

  // ------------------------------------------------------------ lock again after 2 minutes away
  const timed = boot(newRecordRaw);
  await timed.settle();
  await timed.pin('4321');
  ok(!timed.q('#lockLayer.open'), 'unlocked before walking away');
  timed.setVisibility('hidden');
  const realNow = timed.w.Date.now;
  const shifted = realNow() + 3 * 60 * 1000;
  timed.w.Date.now = () => shifted;
  timed.setVisibility('visible');
  timed.w.Date.now = realNow;
  await timed.settle(120);
  ok(!!timed.q('#lockLayer.open'), 'coming back after 2+ minutes locks the app again');

  // ------------------------------------------------------------ large text
  const t = second;
  t.act('tab', '[data-tab="home"]');
  await t.settle();
  t.act('settings');
  await t.settle();
  const ltRow = t.q('[data-act="toggle-large-text"]');
  ok(!!ltRow, 'settings has a Large text switch');
  ok(!!ltRow.querySelector('.switch'), 'switch control is drawn');
  t.click(ltRow);
  await t.settle();
  ok(t.d.documentElement.classList.contains('large-text'), 'large text class turns on');
  ok(t.db().settings.largeText === true, 'large text is saved');
  ok(/Large text on/.test(text(t.q('#toast'))), 'large text toast shown');
  t.click(t.q('[data-act="toggle-large-text"]'));
  await t.settle();
  ok(!t.d.documentElement.classList.contains('large-text'), 'large text can be turned off');

  // ------------------------------------------------------------ backup banner and sharing
  t.act('load-demo');
  await t.settle(250);
  const seed = t.db();
  seed.meta.lastBackup = null;

  const bk = boot(newRecordRaw, seed);
  await bk.settle();
  await bk.pin('4321');
  ok(!bk.q('#lockLayer.open'), 'seeded phone unlocks');
  ok(!!bk.q('.banner.danger'), 'home warns in red when there is no backup');
  ok(!!bk.q('[data-act="share-backup"]'), 'warning offers Share');
  ok(!!bk.q('[data-act="backup"]'), 'warning offers Download');
  ok(/No backup yet/.test(text(bk.q('.banner.danger'))), 'warning says no backup yet');

  let shared = null;
  Object.defineProperty(bk.w.navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(bk.w.navigator, 'share', {
    configurable: true,
    value: (data) => { shared = data; return Promise.resolve(); }
  });
  bk.act('share-backup');
  await bk.settle(150);
  ok(!!shared && Array.isArray(shared.files) && shared.files.length === 1, 'share sheet receives one file');
  ok(/^hostel-backup-\d{4}-\d{2}-\d{2}\.json$/.test(shared.files[0].name), 'shared file is named by date: ' + (shared.files && shared.files[0].name));
  ok(bk.db().meta.lastBackup === new Date().toISOString().slice(0, 10), 'sharing records the backup date');
  ok(!bk.q('.banner.danger'), 'red warning disappears after a backup');

  // old backup (8 days) still warns
  const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const oldSeed = JSON.parse(JSON.stringify(seed));
  oldSeed.meta.lastBackup = eightDaysAgo;
  const older = boot(newRecordRaw, oldSeed);
  await older.settle();
  await older.pin('4321');
  ok(!!older.q('.banner.danger'), 'an old backup still warns');
  ok(/Last backup 8 days ago/.test(text(older.q('.banner.danger'))), 'warning counts the days: ' + text(older.q('.banner.danger')));

  // fallback: no share support -> download
  const dl = boot(newRecordRaw, seed);
  await dl.settle();
  await dl.pin('4321');
  dl.act('share-backup');
  await dl.settle(150);
  ok(dl.w.__downloads.some((x) => /^hostel-backup-/.test(x.name || '')), 'without a share sheet it downloads the file instead');
  ok(dl.db().meta.lastBackup === new Date().toISOString().slice(0, 10), 'download also records the backup date');

  // ------------------------------------------------------------ ID proof masking
  t.act('tab', '[data-tab="residents"]');
  await t.settle();
  t.click(t.q('.res-card'));
  await t.settle();
  const profileText = text(t.q('.screen'));
  ok(/Show/.test(profileText), 'ID proof has a Show control');
  const storedId = t.db().residents.find((r) => r.idNumber);
  ok(!!storedId, 'demo resident has an ID number');
  const last4 = storedId.idNumber.slice(-4);
  ok(profileText.indexOf(storedId.idNumber) === -1, 'the full ID number is hidden by default');
  ok(/••••/.test(profileText), 'a masked ID is shown instead');
  t.act('toggle-id');
  await t.settle();
  ok(text(t.q('.screen')).indexOf(storedId.idNumber) !== -1, 'tapping Show reveals the full ID');
  ok(/Hide/.test(text(t.q('.reveal-btn'))), 'button switches to Hide');
  t.act('toggle-id');
  await t.settle();
  ok(text(t.q('.screen')).indexOf(last4) !== -1 && text(t.q('.screen')).indexOf(storedId.idNumber) === -1, 'tapping Hide masks it again');

  // ------------------------------------------------------------ rent change from a chosen month
  const twoAgo = monthAdd(thisMk(), -2);
  const lastMk = monthAdd(thisMk(), -1);
  const target = t.db().residents.find((r) => {
    const dues = t.db().payments.filter((p) => p.residentId === r.id);
    return r.status === 'Active' && dues.some((p) => p.month === twoAgo) && dues.some((p) => p.month < twoAgo);
  });
  ok(!!target, 'a demo resident has dues both before and after the chosen month');

  const oldRent = target.rent;
  const duesBefore = t.db().payments.filter((p) => p.residentId === target.id).map((p) => ({ month: p.month, due: p.due }));
  t.click(t.q('[data-act="tab"][data-tab="residents"]'));
  await t.settle();
  t.click(t.qa('.res-card').find((c) => text(c).indexOf(target.name) !== -1));
  await t.settle();
  t.act('edit-resident');
  await t.settle();
  t.act('wiz-next');
  await t.settle();
  t.act('wiz-next');
  await t.settle();
  const stepForm = t.q('#sheetLayer form[data-form="resident"]');
  ok(!!stepForm, 'edit wizard reached the rent step');
  ok(!!stepForm.elements['rentFrom'], 'wizard asks from which month a rent change applies');
  const fromSel = stepForm.elements['rentFrom'];
  ok(fromSel.options.length >= 6, 'month choices are offered: ' + fromSel.options.length);
  ok(fromSel.value === thisMk(), 'defaults to this month');
  fromSel.value = twoAgo;
  stepForm.elements['rent'].value = String(oldRent + 700);
  t.submit(stepForm);
  await t.settle(200);

  const after = t.db();
  const targetAfter = after.residents.find((r) => r.id === target.id);
  ok(targetAfter.rent === oldRent + 700, 'resident rent is updated');
  const laterDues = after.payments.filter((p) => p.residentId === target.id && p.month >= twoAgo);
  ok(laterDues.length > 0 && laterDues.every((p) => p.due === oldRent + 700), 'dues from that month onward use the new rent');
  const earlierDues = after.payments.filter((p) => p.residentId === target.id && p.month < twoAgo);
  const earlierBefore = duesBefore.filter((d) => d.month < twoAgo);
  ok(earlierDues.length === earlierBefore.length && earlierDues.every((p) => {
    const before = earlierBefore.find((b) => b.month === p.month);
    return before && before.due === p.due;
  }), 'earlier months keep the old rent');
  ok(after.payments.filter((p) => p.residentId === target.id && p.month === lastMk).every((p) => p.due === oldRent + 700), 'last month also updated');

  console.log(failures === 0 ? '\nALL SECURITY TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
