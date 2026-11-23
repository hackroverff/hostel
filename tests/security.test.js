/* Security + comfort tests: PIN lock, masked IDs, backup sharing, rent change, large text */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture, thisMk, mkAdd } = require('./fixture');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      if (opts.pinRecord) w.localStorage.setItem('hostelManager.pin', opts.pinRecord);
      if (opts.seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(opts.seed));
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
  const pinEntry = async (digits) => {
    for (const ch of String(digits)) {
      const key = q('.lock-key[data-digit="' + ch + '"]');
      if (!key) throw new Error('no keypad for digit ' + ch);
      click(key);
    }
    await settle(250);
  };
  const unlock = async () => {
    await settle(160);
    const scr = q('.lock-screen');
    if (!scr) return;
    if (scr.getAttribute('data-mode') === 'setup') {
      await pinEntry('1234');
      await pinEntry('1234');
    } else {
      await pinEntry('1234');
    }
    await settle(160);
  };
  const setVisibility = (state) => {
    Object.defineProperty(d, 'visibilityState', { configurable: true, get: () => state });
    d.dispatchEvent(new w.Event('visibilitychange'));
  };
  return { w, d, q, qa, click, act, submit, db, settle, pinEntry, unlock, setVisibility };
}

(async function () {
  // ------------------------------------------------------------ fresh browser: PIN comes first
  const first = boot();
  await first.settle(160);
  ok(!!first.q('#lockLayer.open'), 'a fresh browser opens on a full-screen PIN screen');
  ok(first.q('.lock-screen').getAttribute('data-mode') === 'setup', 'it is in setup mode');
  ok(/Set your 4-digit PIN/.test(text(first.q('.lock-title'))), 'it asks to set a 4-digit PIN: ' + text(first.q('.lock-title')));
  ok(first.d.body.classList.contains('is-locked'), 'the app is paused behind it');

  first.click(first.q('[data-act="settings"]'));
  first.click(first.q('[data-act="add-resident"]'));
  await first.settle(60);
  ok(!!first.q('.brand-name'), 'settings cannot be opened while the PIN is not set');
  ok(!first.q('#sheetLayer .sheet'), 'home actions do nothing while the PIN is not set');

  await first.pinEntry('12');
  ok(first.qa('.pin-dots span.on').length === 2, 'dots fill as digits are pressed');
  first.act('pin-delete');
  ok(first.qa('.pin-dots span.on').length === 1, 'delete removes the last digit');
  await first.pinEntry('234');
  ok(first.q('.lock-screen').getAttribute('data-mode') === 'confirm', 'after 4 digits it asks to confirm');

  await first.pinEntry('9999');
  ok(first.q('.lock-screen').getAttribute('data-mode') === 'setup', 'mismatched confirm goes back to setup');
  ok(/did not match/i.test(text(first.q('.lock-msg'))), 'mismatch explains what happened');
  ok(!!first.q('#lockLayer.open'), 'the app stays blocked after a mismatch');

  await first.pinEntry('1234');
  await first.pinEntry('1234');
  await first.settle(200);
  ok(!first.q('#lockLayer.open'), 'matching confirm removes the lock');
  ok(!!first.q('.hero'), 'home is reachable once the PIN is confirmed');
  ok(!first.d.body.classList.contains('is-locked'), 'the app is no longer paused');

  const recordRaw = first.w.localStorage.getItem('hostelManager.pin');
  ok(!!recordRaw, 'a PIN record is stored on the phone');
  const record = JSON.parse(recordRaw || '{}');
  ok(!!record.salt && !!record.hash, 'record keeps a salt and a hash');
  ok(recordRaw.indexOf('1234') === -1, 'the raw PIN is not stored');
  const savedDb = JSON.stringify(first.db());
  ok(savedDb.indexOf('1234') === -1 && !first.db().settings.pin, 'the PIN is never written into hostel data');

  // ------------------------------------------------------------ reload: wrong then right PIN
  const second = boot({ pinRecord: recordRaw });
  await second.settle(160);
  ok(!!second.q('#lockLayer.open'), 'reopening the app shows the lock');
  ok(second.q('.lock-screen').getAttribute('data-mode') === 'locked', 'it is in unlock mode');
  ok(/Enter your PIN/.test(text(second.q('.lock-title'))), 'lock asks for the existing PIN');
  ok(!!second.q('[data-act="pin-help"]'), 'forgot PIN link is offered');

  await second.pinEntry('0000');
  ok(!!second.q('#lockLayer.open'), 'a wrong PIN keeps the app locked');
  ok(/Incorrect PIN/i.test(text(second.q('.lock-msg'))), 'wrong PIN shows a friendly message');
  second.click(second.q('[data-act="tab"][data-tab="payments"]'));
  await second.settle(40);
  ok(!second.q('.month-nav'), 'tabs stay unreachable while locked');

  await second.pinEntry('1234');
  ok(!second.q('#lockLayer.open'), 'the correct PIN unlocks');
  ok(!!second.q('.hero'), 'home renders after unlocking');

  // ------------------------------------------------------------ forgot PIN help
  const third = boot({ pinRecord: recordRaw });
  await third.settle(160);
  third.act('pin-help');
  ok(!!third.q('.lock-help'), 'forgot PIN opens the help panel');
  ok(/restore a backup/i.test(text(third.q('.lock-help'))), 'help says the only reset is restoring a backup');
  third.act('pin-help-close');
  ok(!!third.q('.lock-keypad'), 'help can be dismissed');

  // ------------------------------------------------------------ change PIN in settings
  second.act('settings');
  await second.settle();
  ok(/Change PIN/.test(text(second.q('.screen'))), 'settings has a Change PIN row');
  ok(!/Set a PIN/.test(text(second.q('.screen'))), 'settings has no optional Set a PIN row');
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

  const fourth = boot({ pinRecord: newRecordRaw });
  await fourth.settle(160);
  await fourth.pinEntry('4321');
  ok(!fourth.q('#lockLayer.open'), 'the new PIN works on the next launch');
  const fifth = boot({ pinRecord: newRecordRaw });
  await fifth.settle(160);
  await fifth.pinEntry('1234');
  ok(!!fifth.q('#lockLayer.open'), 'the old PIN no longer works');

  // ------------------------------------------------------------ lock again after 2 minutes away
  const timed = boot({ pinRecord: newRecordRaw });
  await timed.settle(160);
  await timed.pinEntry('4321');
  ok(!timed.q('#lockLayer.open'), 'unlocked before walking away');
  timed.setVisibility('hidden');
  const realNow = timed.w.Date.now;
  const shifted = realNow() + 3 * 60 * 1000;
  timed.w.Date.now = () => shifted;
  timed.setVisibility('visible');
  timed.w.Date.now = realNow;
  await timed.settle(140);
  ok(!!timed.q('#lockLayer.open'), 'coming back after 2+ minutes locks the app again');

  // ------------------------------------------------------------ seeded app: banner, sharing, privacy
  const app = boot({ seed: seedFixture() });
  await app.unlock();
  ok(!app.q('#lockLayer.open'), 'seeded phone unlocked');
  ok(!!app.q('.banner.danger'), 'home warns in red when there is no backup');
  ok(!!app.q('[data-act="share-backup"]'), 'warning offers Share');
  ok(!!app.q('[data-act="backup"]'), 'warning offers Download');
  ok(/No backup yet/.test(text(app.q('.banner.danger'))), 'warning says no backup yet');

  let shared = null;
  Object.defineProperty(app.w.navigator, 'canShare', { configurable: true, value: () => true });
  Object.defineProperty(app.w.navigator, 'share', {
    configurable: true,
    value: (data) => { shared = data; return Promise.resolve(); }
  });
  app.act('share-backup');
  await app.settle(180);
  ok(!!shared && Array.isArray(shared.files) && shared.files.length === 1, 'share sheet receives one file');
  ok(/^hostel-backup-\d{4}-\d{2}-\d{2}\.json$/.test(shared.files[0].name), 'shared file is named by date: ' + (shared.files && shared.files[0].name));
  ok(app.db().meta.lastBackup === new Date().toISOString().slice(0, 10), 'sharing records the backup date');
  ok(!app.q('.banner.danger'), 'red warning disappears after a backup');

  // old backup (8 days) still warns
  const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const oldSeed = seedFixture();
  oldSeed.meta.lastBackup = eightDaysAgo;
  const older = boot({ seed: oldSeed });
  await older.unlock();
  ok(!!older.q('.banner.danger'), 'an old backup still warns');
  ok(/Last backup 8 days ago/.test(text(older.q('.banner.danger'))), 'warning counts the days: ' + text(older.q('.banner.danger')));

  // fallback: no share support -> download
  const dl = boot({ seed: seedFixture() });
  await dl.unlock();
  dl.act('share-backup');
  await dl.settle(150);
  ok(dl.w.__downloads.some((x) => /^hostel-backup-/.test(x.name || '')), 'without a share sheet it downloads the file instead');
  ok(dl.db().meta.lastBackup === new Date().toISOString().slice(0, 10), 'download also records the backup date');

  // ------------------------------------------------------------ ID proof masking
  app.act('tab', '[data-tab="residents"]');
  await app.settle();
  app.click(app.q('.res-card'));
  await app.settle();
  const profileText = text(app.q('.screen'));
  ok(/Show/.test(profileText), 'ID proof has a Show control');
  const storedId = app.db().residents.find((r) => r.idNumber);
  ok(!!storedId, 'seeded resident has an ID number');
  const last4 = storedId.idNumber.slice(-4);
  ok(profileText.indexOf(storedId.idNumber) === -1, 'the full ID number is hidden by default');
  ok(/••••/.test(profileText), 'a masked ID is shown instead');
  app.act('toggle-id');
  await app.settle();
  ok(text(app.q('.screen')).indexOf(storedId.idNumber) !== -1, 'tapping Show reveals the full ID');
  ok(/Hide/.test(text(app.q('.reveal-btn'))), 'button switches to Hide');
  app.act('toggle-id');
  await app.settle();
  ok(text(app.q('.screen')).indexOf(last4) !== -1 && text(app.q('.screen')).indexOf(storedId.idNumber) === -1, 'tapping Hide masks it again');

  // ------------------------------------------------------------ rent change from a chosen month
  const twoAgo = mkAdd(thisMk(), -2);
  const lastMk = mkAdd(thisMk(), -1);
  const target = app.db().residents.find((r) => {
    const dues = app.db().payments.filter((p) => p.residentId === r.id);
    return r.status === 'Active' && dues.some((p) => p.month === twoAgo) && dues.some((p) => p.month < twoAgo);
  });
  ok(!!target, 'a seeded resident has dues both before and after the chosen month');

  const oldRent = target.rent;
  const duesBefore = app.db().payments.filter((p) => p.residentId === target.id).map((p) => ({ month: p.month, due: p.due }));
  app.act('tab', '[data-tab="residents"]');
  await app.settle();
  app.click(app.qa('.res-card').find((c) => text(c).indexOf(target.name) !== -1));
  await app.settle();
  app.act('edit-resident');
  await app.settle();
  app.act('wiz-next');
  await app.settle();
  app.act('wiz-next');
  await app.settle();
  const stepForm = app.q('#sheetLayer form[data-form="resident"]');
  ok(!!stepForm, 'edit wizard reached the rent step');
  ok(!!stepForm.elements['rentFrom'], 'wizard asks from which month a rent change applies');
  const fromSel = stepForm.elements['rentFrom'];
  ok(fromSel.options.length >= 6, 'month choices are offered: ' + fromSel.options.length);
  ok(fromSel.value === thisMk(), 'defaults to this month');
  fromSel.value = twoAgo;
  stepForm.elements['rent'].value = String(oldRent + 700);
  app.submit(stepForm);
  await app.settle(250);

  const after = app.db();
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

  // ------------------------------------------------------------ large text
  app.act('tab', '[data-tab="home"]');
  await app.settle();
  app.act('settings');
  await app.settle();
  const ltRow = app.q('[data-act="toggle-large-text"]');
  ok(!!ltRow, 'settings has a Large text switch');
  ok(!!ltRow.querySelector('.switch'), 'switch control is drawn');
  app.click(ltRow);
  await app.settle();
  ok(app.d.documentElement.classList.contains('large-text'), 'large text class turns on');
  ok(app.db().settings.largeText === true, 'large text is saved');
  ok(/Large text on/.test(text(app.q('#toast'))), 'large text toast shown');
  app.click(app.q('[data-act="toggle-large-text"]'));
  await app.settle();
  ok(!app.d.documentElement.classList.contains('large-text'), 'large text can be turned off');

  console.log(failures === 0 ? '\nALL SECURITY TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
