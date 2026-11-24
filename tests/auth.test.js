/* Account + cloud-sync tests: login gate, local account, Supabase REST sync, backups, privacy */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { seedFixture, thisMk, mkAdd } = require('./fixture');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

/* A tiny fetch stand-in: routes by URL substring, records every call. */
function mockFetch(routes) {
  const calls = [];
  const fn = (url, opts) => {
    const call = { url: String(url), opts: opts || {} };
    calls.push(call);
    const route = routes.find((r) => call.url.indexOf(r.match) !== -1 && (!r.method || r.method === call.opts.method));
    if (!route) return Promise.reject(new Error('unexpected request ' + call.url));
    if (route.networkError) return Promise.reject(new TypeError('Failed to fetch'));
    const res = typeof route.reply === 'function' ? route.reply(call) : route.reply;
    return Promise.resolve({
      ok: (res.status || 200) < 400,
      status: res.status || 200,
      text: () => Promise.resolve(res.body == null ? '' : JSON.stringify(res.body))
    });
  };
  fn.calls = calls;
  return fn;
}

function boot(opts) {
  opts = opts || {};
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      w.HOSTEL_CONFIG = opts.config || { cloud: false };
      if (opts.seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(opts.seed));
      Object.keys(opts.storage || {}).forEach((k) => w.localStorage.setItem(k, opts.storage[k]));
      if (opts.sessionStorage) w.sessionStorage.setItem('hostelManager.session', opts.sessionStorage);
      if (opts.fetch) w.fetch = opts.fetch;
      w.__downloads = [];
      w.__online = opts.online !== false;
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => w.__online });
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
  const authForm = () => q('#authLayer form[data-form="login"]');
  const unlock = async (o) => {
    o = o || {};
    await settle(200);
    if (!q('#authLayer.open')) return;
    const form = authForm();
    form.elements['username'].value = o.username || 'owner';
    form.elements['password'].value = o.password || 'hostel123';
    if (form.elements['confirm']) form.elements['confirm'].value = o.confirm || o.password || 'hostel123';
    if (o.stay === false && form.elements['stay']) form.elements['stay'].checked = false;
    submit(form);
    await settle(o.wait || 800);
  };
  const session = () => {
    const raw = w.localStorage.getItem('hostelManager.session') || w.sessionStorage.getItem('hostelManager.session');
    return raw ? JSON.parse(raw) : null;
  };
  return { w, d, q, qa, click, act, submit, db, settle, authForm, unlock, session };
}

function cloudSession(extra) {
  return JSON.stringify(Object.assign({
    v: 1.3, cloud: true, stay: true,
    access_token: 'tok-1', refresh_token: 'ref-1',
    expires_at: Date.now() + 3600 * 1000,
    user: { id: 'u-1', email: 'owner@hostel.local', username: 'owner' }
  }, extra || {}));
}

(async function () {
  /* ================================================== 1. fresh phone: the login gate */
  const fresh = boot();
  await fresh.settle(200);
  ok(!!fresh.q('#authLayer.open'), 'a fresh phone opens on the login screen');
  ok(/Create your account/.test(text(fresh.q('.auth-title'))), 'it offers to create an account first');
  ok(fresh.d.body.classList.contains('is-locked'), 'the app is paused behind the login screen');
  ok(!fresh.q('.lock-screen') && !fresh.q('.lock-key') && !fresh.q('.pin-dots'), 'no PIN pad exists any more');
  ok(!/PIN/i.test(text(fresh.d.body)), 'no PIN wording is left anywhere');
  fresh.act('tab', '[data-tab="rooms"]');
  await fresh.settle(80);
  ok(!fresh.q('.room-card') && !!fresh.q('#authLayer.open'), 'tabs cannot be used until you sign in');
  ok(!!fresh.q('[data-act="auth-forgot"]'), 'forgot password is offered');
  ok(!!fresh.q('[data-act="auth-toggle"]'), 'switching between sign in and sign up is offered');
  fresh.act('auth-toggle');
  await fresh.settle(80);
  ok(/Welcome back/.test(text(fresh.q('.auth-title'))), 'toggle switches to sign-in mode');
  fresh.submit(fresh.authForm());
  await fresh.settle(80);
  ok(/Enter your username or email/.test(text(fresh.q('.field-error'))), 'empty sign-in is rejected: ' + text(fresh.q('.field-error')).slice(0, 60));
  ok(!!fresh.q('#authLayer.open'), 'an empty form never opens the app');

  /* ================================================== 2. local account lifecycle */
  const local = boot();
  await local.settle(200);
  await local.unlock();
  ok(!local.q('#authLayer.open'), 'creating an account opens the app');
  ok(!!local.w.localStorage.getItem('hostelManager.account'), 'the account is stored on the phone');
  const acct = JSON.parse(local.w.localStorage.getItem('hostelManager.account'));
  ok(acct.username === 'owner', 'username is stored: ' + acct.username);
  ok(!!acct.salt && !!acct.hash, 'only a salt and a hash are stored');
  ok(JSON.stringify(acct).indexOf('hostel123') === -1, 'the password is never stored in plain text');
  ok(local.session() && local.session().cloud === false, 'a local session is saved');
  ok(!local.w.localStorage.getItem('hostelManager.owner'), 'a local cache stays untagged so it can move to a cloud account later');
  ok(!!local.db() && Array.isArray(local.db().residents), 'hostel data is created and saved');

  // reopen on the same phone with the account in place
  const stored = {
    'hostelManager.account': local.w.localStorage.getItem('hostelManager.account'),
    'hostelManager.session': local.w.localStorage.getItem('hostelManager.session'),
    'hostelManager.owner': 'local',
    'hostelManager.v1': local.w.localStorage.getItem('hostelManager.v1')
  };
  const reopen = boot({ storage: stored });
  await reopen.settle(200);
  ok(!reopen.q('#authLayer.open'), 'a saved session opens straight into the app');
  const signedOut = boot({ storage: Object.assign({}, stored, { 'hostelManager.session': '' }) });
  await signedOut.settle(200);
  ok(!!signedOut.q('#authLayer.open'), 'without a session the login screen is back');
  ok(/Welcome back/.test(text(signedOut.q('.auth-title'))), 'a returning phone asks you to sign in');
  await signedOut.unlock({ password: 'wrong-one' });
  ok(!!signedOut.q('#authLayer.open'), 'a wrong password keeps the app locked');
  ok(/Incorrect password/i.test(text(signedOut.q('.auth-msg'))), 'a wrong password explains itself: ' + text(signedOut.q('.auth-msg')).slice(0, 60));
  await signedOut.unlock();
  ok(!signedOut.q('#authLayer.open'), 'the right password opens the app');
  ok(!!signedOut.q('.hero'), 'home renders after signing in');
  ok(signedOut.db().residents.length === local.db().residents.length, 'the hostel data survived the sign out');

  // not staying signed in -> session lives only in this tab
  const noStay = boot({ storage: { 'hostelManager.account': stored['hostelManager.account'] } });
  await noStay.settle(200);
  await noStay.unlock({ stay: false });
  ok(!!noStay.w.sessionStorage.getItem('hostelManager.session'), 'without "stay signed in" the session is kept in the tab only');
  ok(!noStay.w.localStorage.getItem('hostelManager.session'), 'nothing persistent is written for a one-off sign-in');
  ok(!noStay.q('#authLayer.open'), 'that sign-in still opens the app');

  // log out from Settings
  noStay.act('tab', '[data-tab="home"]');
  await noStay.settle();
  noStay.act('settings');
  await noStay.settle();
  ok(!!noStay.q('#syncStatus'), 'settings shows the sync status row');
  ok(/Local account|Cloud sync off/.test(text(noStay.q('#syncStatus'))), 'the sync row explains where data lives: ' + text(noStay.q('#syncStatus')).slice(0, 80));
  ok(!!noStay.q('[data-act="logout"]'), 'settings offers Log out');
  ok(!noStay.q('[data-act="change-pin"]'), 'Change PIN is gone');
  noStay.act('logout');
  await noStay.settle(120);
  ok(!!noStay.q('#confirmLayer .sheet'), 'logging out asks first');
  noStay.act('confirm-yes');
  await noStay.settle(200);
  ok(!!noStay.q('#authLayer.open'), 'logging out returns to the login screen');
  ok(!noStay.w.localStorage.getItem('hostelManager.session') && !noStay.w.sessionStorage.getItem('hostelManager.session'), 'the session is cleared');
  ok(!!noStay.w.localStorage.getItem('hostelManager.account'), 'the account stays so you can sign back in');
  ok(!!noStay.db() && Array.isArray(noStay.db().residents), 'hostel data is not deleted by logging out');

  // forgot password on a local account
  const forgot = boot({ storage: { 'hostelManager.account': stored['hostelManager.account'] } });
  await forgot.settle(200);
  forgot.act('auth-forgot');
  await forgot.settle(120);
  ok(!!forgot.q('#confirmLayer .sheet'), 'forgot password opens an explanation');
  ok(/no password reset|create a new account/i.test(text(forgot.q('#confirmLayer'))), 'it explains what a local account can do');

  /* ================================================== 3. Supabase cloud mode */
  const cloudDb = seedFixture();
  cloudDb.residents[0].name = 'Cloudy Guest';
  cloudDb.residents[0].phone = '9000000001';
  const remoteRow = { data: cloudDb, updated_at: new Date(Date.now() + 60000).toISOString() };
  const cloudFetch = mockFetch([
    { match: '/auth/v1/token', method: 'POST', reply: { body: { access_token: 'tok-9', refresh_token: 'ref-9', expires_in: 3600, user: { id: 'u-1', email: 'owner@hostel.local' } } } },
    { match: '/rest/v1/hostel_data', method: 'GET', reply: { body: [remoteRow] } },
    { match: '/rest/v1/hostel_data', method: 'POST', reply: { status: 201, body: null } }
  ]);
  const cloud = boot({
    config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' },
    fetch: cloudFetch
  });
  await cloud.settle(200);
  ok(/Welcome back/.test(text(cloud.q('.auth-title'))), 'with cloud keys a returning user is asked to sign in');
  cloud.act('auth-toggle');
  await cloud.settle(80);
  ok(/Your hostel data is saved to your account/.test(text(cloud.q('.auth-sub'))), 'cloud sign-up says data is saved to your account: ' + text(cloud.q('.auth-sub')).slice(0, 70));
  cloud.act('auth-toggle');
  await cloud.settle(80);
  await cloud.unlock({ username: 'owner@hostel.local' });
  ok(!cloud.q('#authLayer.open'), 'cloud sign-in opens the app');
  const tokenCall = cloudFetch.calls.find((c) => c.url.indexOf('/auth/v1/token?grant_type=password') !== -1);
  ok(!!tokenCall, 'sign-in goes through Supabase auth');
  ok(/^apikey$/.test(Object.keys(tokenCall.opts.headers)[0]) || !!tokenCall.opts.headers.apikey, 'the anon key is sent as apikey');
  ok(JSON.parse(tokenCall.opts.body).email === 'owner@hostel.local', 'a bare username becomes a hostel.local email');
  ok(JSON.parse(tokenCall.opts.body).password === 'hostel123', 'the password is posted once, never stored');
  const getCall = cloudFetch.calls.find((c) => c.opts.method === 'GET');
  ok(!!getCall && /user_id=eq\.u-1/.test(getCall.url), 'the row is fetched for this user only: ' + (getCall && getCall.url));
  ok(/select=data,updated_at/.test(getCall.url), 'only the data payload is selected');
  ok(/Cloudy Guest/.test(text(cloud.q('.screen'))), 'the cloud copy is shown after signing in');
  ok(cloud.db().residents[0].name === 'Cloudy Guest', 'the local cache is filled from the cloud');
  ok(!!cloud.session() && cloud.session().access_token === 'tok-9', 'the access token is kept for the session');
  ok(cloud.w.localStorage.getItem('hostelManager.owner') === 'u-1', 'the cache is tagged with the cloud user');

  cloud.act('tab', '[data-tab="home"]');
  await cloud.settle();
  cloud.act('settings');
  await cloud.settle();
  ok(!!cloud.q('[data-act="sync-now"]'), 'settings offers Sync now in cloud mode');
  ok(/Synced/.test(text(cloud.q('#syncStatus'))), 'settings says the data is synced: ' + text(cloud.q('#syncStatus')).slice(0, 60));
  ok(/u-1|owner/.test(text(cloud.q('.screen'))), 'settings shows who is signed in');

  // a change is pushed automatically
  const postsBefore = cloudFetch.calls.filter((c) => c.opts.method === 'POST' && c.url.indexOf('/rest/v1/') !== -1).length;
  const lt = cloud.q('[data-act="toggle-large-text"]');
  cloud.click(lt);
  await cloud.settle(1600);
  const posts = cloudFetch.calls.filter((c) => c.opts.method === 'POST' && c.url.indexOf('/rest/v1/') !== -1);
  ok(posts.length === postsBefore + 1, 'a data change pushes one row: ' + postsBefore + ' -> ' + posts.length);
  const pushBody = JSON.parse(posts[posts.length - 1].opts.body)[0];
  ok(pushBody.user_id === 'u-1', 'the pushed row is keyed by the user');
  ok(pushBody.data && pushBody.data.settings && pushBody.data.settings.largeText === true, 'the pushed row holds the full data');
  ok(!!pushBody.updated_at, 'the pushed row carries updated_at');
  ok(/on_conflict=user_id/.test(posts[posts.length - 1].url), 'the row upserts on user_id');
  ok(/Synced/.test(text(cloud.q('#syncStatus'))), 'the status goes back to Synced');

  cloud.act('sync-now');
  await cloud.settle(600);
  ok(cloudFetch.calls.filter((c) => c.opts.method === 'POST' && c.url.indexOf('/rest/v1/') !== -1).length >= posts.length, 'Sync now pushes again');

  // offline: cache keeps working
  const offlineFetch = mockFetch([
    { match: '/rest/v1/hostel_data', method: 'GET', networkError: true },
    { match: '/rest/v1/hostel_data', method: 'POST', networkError: true }
  ]);
  const offline = boot({
    config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' },
    fetch: offlineFetch,
    seed: seedFixture(),
    storage: { 'hostelManager.session': cloudSession(), 'hostelManager.owner': 'u-1' }
  });
  await offline.settle(700);
  offline.act('tab', '[data-tab="home"]');
  await offline.settle();
  offline.act('settings');
  await offline.settle();
  ok(!offline.q('#authLayer.open'), 'a saved cloud session still opens the app offline');
  ok(/Offline/.test(text(offline.q('#syncStatus'))), 'offline status is shown: ' + text(offline.q('#syncStatus')).slice(0, 60));
  ok(!!offline.db() && offline.db().residents.length > 0, 'the offline cache still has the data');

  // wrong cloud password
  const badFetch = mockFetch([
    { match: '/auth/v1/token', method: 'POST', reply: { status: 400, body: { error_description: 'Invalid login credentials' } } }
  ]);
  const bad = boot({ config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' }, fetch: badFetch });
  await bad.settle(200);
  await bad.unlock({ username: 'owner@hostel.local', password: 'nope' });
  ok(!!bad.q('#authLayer.open'), 'a rejected cloud password keeps the app locked');
  ok(/Invalid login credentials/.test(text(bad.q('.auth-msg'))), 'the cloud error is shown: ' + text(bad.q('.auth-msg')).slice(0, 60));

  // sign up in cloud mode posts to /signup
  const upFetch = mockFetch([
    { match: '/auth/v1/signup', method: 'POST', reply: { body: { access_token: 'tok-2', refresh_token: 'ref-2', expires_in: 3600, user: { id: 'u-2' } } } },
    { match: '/rest/v1/hostel_data', method: 'GET', reply: { body: [] } },
    { match: '/rest/v1/hostel_data', method: 'POST', reply: { status: 201, body: null } }
  ]);
  const up = boot({ config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' }, fetch: upFetch });
  await up.settle(200);
  up.act('auth-toggle');
  await up.settle(80);
  await up.unlock({ username: 'newowner' });
  ok(!up.q('#authLayer.open'), 'signing up in cloud mode opens the app');
  ok(upFetch.calls.some((c) => c.url.indexOf('/auth/v1/signup') !== -1), 'sign-up goes through Supabase');
  const firstPush = upFetch.calls.find((c) => c.opts.method === 'POST' && c.url.indexOf('/rest/v1/hostel_data') !== -1);
  ok(!!firstPush, 'a brand new cloud account uploads its starting data');
  up.act('tab', '[data-tab="home"]');
  await up.settle();
  up.act('settings');
  await up.settle();
  ok(/Synced/.test(text(up.q('#syncStatus'))), 'a brand new account reports Synced: ' + text(up.q('#syncStatus')).slice(0, 50));

  // a stale cloud token is refreshed before use
  const refreshFetch = mockFetch([
    { match: '/auth/v1/token?grant_type=refresh_token', method: 'POST', reply: { body: { access_token: 'tok-3', refresh_token: 'ref-3', expires_in: 3600, user: { id: 'u-1' } } } },
    { match: '/rest/v1/hostel_data', method: 'GET', reply: { body: [] } },
    { match: '/rest/v1/hostel_data', method: 'POST', reply: { status: 201, body: null } }
  ]);
  const stale = boot({
    config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' },
    fetch: refreshFetch,
    seed: seedFixture(),
    storage: { 'hostelManager.session': cloudSession({ expires_at: Date.now() - 5000 }), 'hostelManager.owner': 'u-1' }
  });
  await stale.settle(800);
  ok(refreshFetch.calls.some((c) => c.url.indexOf('grant_type=refresh_token') !== -1), 'an expired token is refreshed');
  ok(stale.w.localStorage.getItem('hostelManager.session').indexOf('tok-3') !== -1, 'the refreshed token is stored');

  // a different account on the same phone never inherits the cache
  const switchFetch = mockFetch([
    { match: '/auth/v1/token', method: 'POST', reply: { body: { access_token: 'tok-7', refresh_token: 'ref-7', expires_in: 3600, user: { id: 'u-7' } } } },
    { match: '/rest/v1/hostel_data', method: 'GET', reply: { body: [] } },
    { match: '/rest/v1/hostel_data', method: 'POST', reply: { status: 201, body: null } }
  ]);
  const switched = boot({
    config: { supabaseUrl: 'https://demo.supabase.co', supabaseAnonKey: 'anon-key' },
    fetch: switchFetch,
    seed: seedFixture(),
    storage: { 'hostelManager.owner': 'u-1' }
  });
  await switched.settle(200);
  await switched.unlock({ username: 'someone@hostel.local' });
  ok(switched.db().residents.length === 0, 'a different user starts from a clean slate: ' + switched.db().residents.length);
  const newPush = switchFetch.calls.find((c) => c.opts.method === 'POST' && c.url.indexOf('/rest/v1/hostel_data') !== -1);
  ok(!!newPush && JSON.parse(newPush.opts.body)[0].user_id === 'u-7', 'the clean slate is uploaded to the new account');

  // ------------------------------------------------------------ seeded app: banner, sharing, privacy
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

  console.log(failures === 0 ? '\nALL AUTH TESTS PASSED' : 
 + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
