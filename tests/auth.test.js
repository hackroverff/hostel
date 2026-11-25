/* Account, PIN and privacy tests: the login gate, the local (offline) account,
   the 4-digit PIN on top of it, locking, changing the PIN, logging out, and the
   parts of the app that must keep working with all of that: backups, masked ID
   numbers, rent changes by month and large text.
   Cloud sync itself is covered by tests/cloud.test.js with a mocked client. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture, thisMk, mkAdd } = require('./fixture');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

const PLACEHOLDERS = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      w.APP_CONFIG = opts.appConfig || PLACEHOLDERS;
      w.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      if (opts.seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(opts.seed));
      Object.keys(opts.storage || {}).forEach((k) => w.localStorage.setItem(k, opts.storage[k]));
      w.__downloads = [];
      w.URL.createObjectURL = () => 'blob:1';
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () { w.__downloads.push({ name: this.download }); };
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
  const settle = (ms) => new Promise((r) => setTimeout(r, ms || 60));
  const authForm = () => q('#authLayer form[data-form="login"]');
  const login = async (username, password) => {
    await settle(180);
    const form = authForm();
    if (!form) return false;
    const nameEl = form.elements['email'] || form.elements['username'];
    if (nameEl) nameEl.value = username || 'owner';
    form.elements['password'].value = password || 'hostel123';
    if (form.elements['confirm']) form.elements['confirm'].value = password || 'hostel123';
    submit(form);
    await settle(400);
    return true;
  };
  const pressPin = async (pin) => {
    for (const ch of pin) {
      const key = q('[data-act="pin-digit"][data-digit="' + ch + '"]');
      if (key) click(key);
    }
    await settle(320);
  };
  const pin = async (value) => {
    const v = value || '1234';
    const scr = q('#lockLayer .lock-screen');
    if (!scr) return false;
    const mode = scr.getAttribute('data-mode');
    await pressPin(v);
    if ((mode === 'setup' || mode === 'confirm') && q('#lockLayer .lock-screen')) await pressPin(v);
    await settle(200);
    return !q('#lockLayer .lock-screen');
  };
  const unlock = async (o) => {
    o = o || {};
    await login(o.username, o.password);
    if (o.pin === false) return;
    await pin(o.pinValue || '1234');
    await settle(o.wait || 120);
  };
  const session = () => {
    const raw = w.localStorage.getItem('hostelManager.session');
    return raw ? JSON.parse(raw) : null;
  };
  return { w, d, q, qa, click, act, submit, db, settle, authForm, login, pin, pressPin, unlock, session };
}

(async function () {
  /* ================================================== 1. fresh phone: the login gate */
  const fresh = boot();
  await fresh.settle(220);
  ok(!!fresh.q('#authLayer.open'), 'a fresh phone opens on the account screen');
  ok(/Create your account/.test(text(fresh.q('.auth-title'))), 'it offers to create a local account first');
  ok(fresh.d.body.classList.contains('is-locked'), 'the app is paused behind the account screen');
  ok(!fresh.q('#lockLayer.open'), 'the PIN is asked after the account, not before it');
  fresh.act('tab', '[data-tab="rooms"]');
  await fresh.settle(80);
  ok(!fresh.q('.room-card') && !!fresh.q('#authLayer.open'), 'tabs cannot be used until you sign in');
  ok(!!fresh.q('[data-act="auth-forgot"]'), 'forgot password is offered');
  ok(!!fresh.q('[data-act="auth-toggle"]'), 'a local install can switch to sign-in');
  fresh.act('auth-toggle');
  await fresh.settle(80);
  ok(/Welcome back/.test(text(fresh.q('.auth-title'))), 'the toggle switches to sign-in mode');
  fresh.submit(fresh.authForm());
  await fresh.settle(80);
  ok(/Enter your username/.test(text(fresh.q('.field-error'))), 'an empty sign-in is rejected: ' + text(fresh.q('.field-error')).slice(0, 50));
  ok(!!fresh.q('#authLayer.open'), 'an empty form never opens the app');

  /* ================================================== 2. local account + PIN setup */
  const local = boot();
  await local.settle(220);
  await local.login('owner', 'hostel123');
  ok(!local.q('#authLayer.open'), 'creating the account closes the account screen');
  ok(!!local.q('#lockLayer.open'), 'the PIN setup follows straight away');
  ok(/Set your 4-digit PIN/.test(text(local.q('.lock-title'))), 'it asks for a 4-digit PIN: ' + text(local.q('.lock-title')));
  ok(local.qa('.lock-key').length === 12, 'the keypad has 10 digits and 2 spare keys');
  await local.pressPin('1234');
  ok(/Confirm your PIN/.test(text(local.q('.lock-title'))), 'the PIN has to be typed twice');
  await local.pressPin('9999');
  ok(/did not match/.test(text(local.q('.lock-msg'))), 'a mismatch is explained: ' + text(local.q('.lock-msg')));
  ok(/Set your 4-digit PIN/.test(text(local.q('.lock-title'))), 'and the setup starts again');
  await local.pressPin('1234');
  await local.pressPin('1234');
  await local.settle(300);
  ok(!local.q('#lockLayer.open'), 'the matching PIN opens the app');
  ok(!!local.q('.hero'), 'home renders after sign-in');
  ok(!!local.w.localStorage.getItem('hostelManager.account'), 'the account is stored on the phone');
  const acct = JSON.parse(local.w.localStorage.getItem('hostelManager.account'));
  ok(acct.username === 'owner', 'the username is stored: ' + acct.username);
  ok(!!acct.salt && !!acct.hash, 'only a salt and a hash are stored');
  ok(JSON.stringify(acct).indexOf('hostel123') === -1, 'the password is never stored in plain text');
  const pinRec = JSON.parse(local.w.localStorage.getItem('hostelManager.pin'));
  ok(!!pinRec && !!pinRec.hash && !!pinRec.salt, 'the PIN is stored as a salted hash');
  ok(JSON.stringify(pinRec).indexOf('1234') === -1, 'the PIN itself is never stored');
  ok(local.session() && local.session().cloud === false, 'a local session is saved');
  ok(!local.w.localStorage.getItem('hostelManager.owner'), 'a local cache stays untagged so it can move to a cloud account later');
  ok(!!local.db() && Array.isArray(local.db().residents), 'hostel data is created and saved');

  /* ================================================== 3. reopening the app */
  const stored = {
    'hostelManager.account': local.w.localStorage.getItem('hostelManager.account'),
    'hostelManager.session': local.w.localStorage.getItem('hostelManager.session'),
    'hostelManager.pin': local.w.localStorage.getItem('hostelManager.pin'),
    'hostelManager.v1': local.w.localStorage.getItem('hostelManager.v1')
  };
  const reopen = boot({ storage: stored });
  await reopen.settle(250);
  ok(!reopen.q('#authLayer.open'), 'a saved session skips the account screen');
  ok(!!reopen.q('#lockLayer.open'), 'but the PIN is still asked');
  ok(/Enter your PIN/.test(text(reopen.q('.lock-title'))), 'the lock screen asks for the PIN');
  await reopen.pressPin('0000');
  ok(!!reopen.q('#lockLayer.open'), 'a wrong PIN keeps the app locked');
  ok(/Incorrect PIN/.test(text(reopen.q('.lock-msg'))), 'a wrong PIN says so');
  await reopen.pressPin('1234');
  await reopen.settle(250);
  ok(!reopen.q('#lockLayer.open'), 'the right PIN opens the app');
  ok(reopen.db().residents.length === local.db().residents.length, 'the hostel data is still there');

  // no session -> the account screen, with the PIN still in place afterwards
  const signedOut = boot({ storage: Object.assign({}, stored, { 'hostelManager.session': '' }) });
  await signedOut.settle(250);
  ok(!!signedOut.q('#authLayer.open'), 'without a session the sign-in screen is back');
  ok(/Welcome back/.test(text(signedOut.q('.auth-title'))), 'a returning phone asks you to sign in');
  await signedOut.login('owner', 'wrong-one');
  ok(!!signedOut.q('#authLayer.open'), 'a wrong password keeps the app closed');
  ok(/Incorrect password/i.test(text(signedOut.q('.auth-msg'))), 'a wrong password explains itself: ' + text(signedOut.q('.auth-msg')).slice(0, 50));
  ok(!signedOut.q('#lockLayer.open'), 'the PIN is not offered until the password is right');
  await signedOut.login('owner', 'hostel123');
  ok(!!signedOut.q('#lockLayer.open'), 'the right password leads to the PIN');
  await signedOut.pressPin('1234');
  await signedOut.settle(250);
  ok(!!signedOut.q('.hero'), 'and then into the app');
  ok(signedOut.db().residents.length === local.db().residents.length, 'the hostel data survived');

  /* ================================================== 4. locking and changing the PIN */
  const lock = boot({ storage: stored });
  await lock.settle(250);
  await lock.pin('1234');
  lock.act('tab', '[data-tab="home"]');
  await lock.settle(80);
  lock.act('settings');
  await lock.settle(120);
  ok(!!lock.q('[data-act="lock-now"]'), 'settings offers Lock now');
  ok(!!lock.q('[data-act="change-pin"]'), 'settings offers Change PIN');
  lock.act('lock-now');
  await lock.settle(120);
  ok(!!lock.q('#lockLayer.open'), 'Lock now locks the app');
  ok(await lock.pin('1234'), 'the PIN unlocks it again');

  lock.act('tab', '[data-tab="home"]');
  await lock.settle(80);
  lock.act('settings');
  await lock.settle(120);
  lock.act('change-pin');
  await lock.settle(150);
  let pinForm = lock.q('#sheetLayer form[data-form="changePin"]');
  ok(!!pinForm, 'Change PIN opens a sheet');
  pinForm.elements['current'].value = '0000';
  pinForm.elements['next'].value = '5555';
  pinForm.elements['confirm'].value = '5555';
  lock.submit(pinForm);
  await lock.settle(300);
  ok(/not the current PIN/i.test(text(lock.q('#sheetLayer .field-error'))), 'the current PIN is checked: ' + text(lock.q('#sheetLayer .field-error')).slice(0, 40));
  pinForm = lock.q('#sheetLayer form[data-form="changePin"]');
  pinForm.elements['current'].value = '1234';
  pinForm.elements['next'].value = '5555';
  pinForm.elements['confirm'].value = '5555';
  lock.submit(pinForm);
  await lock.settle(400);
  ok(!lock.q('#sheetLayer form[data-form="changePin"]'), 'a valid change closes the sheet');
  lock.act('lock-now');
  await lock.settle(120);
  await lock.pressPin('1234');
  ok(!!lock.q('#lockLayer.open'), 'the old PIN no longer works');
  ok(await lock.pin('5555'), 'the new PIN opens the app');

  /* ================================================== 5. logging out of a local account */
  const out = boot({ storage: stored });
  await out.settle(250);
  await out.pin('1234');
  out.act('tab', '[data-tab="home"]');
  await out.settle(80);
  out.act('settings');
  await out.settle(120);
  ok(!!out.q('#syncStatus'), 'settings shows the sync status row');
  ok(/Local account|Saved on this phone/.test(text(out.q('#syncStatus'))), 'the sync row explains where data lives: ' + text(out.q('#syncStatus')).slice(0, 60));
  ok(!!out.q('[data-act="logout"]'), 'settings offers Log out');
  const beforeOut = out.db().residents.length;
  out.act('logout');
  await out.settle(150);
  ok(!!out.q('#lockLayer.open'), 'logging out asks for the PIN first');
  ok(await out.pin('1234'), 'the PIN is accepted');
  await out.settle(150);
  ok(!!out.q('#confirmLayer .sheet'), 'then it asks whether to log out');
  out.act('confirm-yes');
  await out.settle(300);
  ok(!!out.q('#authLayer.open'), 'logging out returns to the sign-in screen');
  ok(!out.w.localStorage.getItem('hostelManager.session'), 'the session is cleared');
  ok(!out.w.localStorage.getItem('hostelManager.pin'), 'the PIN is cleared with it');
  ok(!!out.w.localStorage.getItem('hostelManager.account'), 'the account stays so you can sign back in');
  ok(!!out.db() && out.db().residents.length === beforeOut, 'a local-only install keeps its data: the phone is the only copy');

  // forgot password on a local account
  const forgot = boot({ storage: { 'hostelManager.account': stored['hostelManager.account'] } });
  await forgot.settle(250);
  forgot.act('auth-forgot');
  await forgot.settle(120);
  ok(/backup/i.test(text(forgot.q('#toast'))), 'forgot password points at a backup file: ' + text(forgot.q('#toast')));

  /* ================================================== 6. cloud mode: login before PIN */
  const cloudHtml = boot({ appConfig: { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_KEY: 'sb_publishable_x' } });
  await cloudHtml.settle(250);
  ok(!!cloudHtml.q('#authLayer.open'), 'with keys the app asks for the account');
  ok(!!cloudHtml.q('#authLayer input[name="email"]'), 'the cloud screen takes an email address');
  ok(!cloudHtml.q('[data-act="auth-toggle"]'), 'cloud mode has no sign-up screen');
  ok(!cloudHtml.q('#lockLayer.open'), 'the PIN comes after the login in cloud mode too');

  /* ================================================== 7. backups, sharing and the banner */
  const app = boot({ seed: seedFixture() });
  await app.unlock();
  ok(!app.q('#authLayer.open'), 'seeded phone signed in');
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

  const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  const oldSeed = seedFixture();
  oldSeed.meta.lastBackup = eightDaysAgo;
  const older = boot({ seed: oldSeed });
  await older.unlock();
  ok(!!older.q('.banner.danger'), 'an old backup still warns');
  ok(/Last backup 8 days ago/.test(text(older.q('.banner.danger'))), 'warning counts the ways: ' + text(older.q('.banner.danger')));

  const dl = boot({ seed: seedFixture() });
  await dl.unlock();
  dl.act('share-backup');
  await dl.settle(150);
  ok(dl.w.__downloads.some((x) => /^hostel-backup-/.test(x.name || '')), 'without a share sheet it downloads the file instead');
  ok(dl.db().meta.lastBackup === new Date().toISOString().slice(0, 10), 'download also records the backup date');

  /* ================================================== 8. ID proof masking */
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

  /* ================================================== 9. rent change from a chosen month */
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

  /* ================================================== 10. large text */
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

  console.log(failures === 0 ? '\nALL AUTH TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
