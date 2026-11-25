/* Supabase cloud storage tests: config placeholders, login before PIN, versioned
   upload, pull on open, debounced push, offline retry, the conflict screen,
   logout wiping local copies and the service worker staying out of the cloud.
   The Supabase client is mocked (tests/mocksupabase.js): no test touches the
   network. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { seedFixture } = require('./fixture');
const { makeSupabaseMock, noNetworkFetch } = require('./mocksupabase');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const swSrc = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const assetsIgnore = fs.readFileSync(path.join(__dirname, '..', '.assetsignore'), 'utf8');
const configSrc = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');

let failures = 0;
function ok(cond, label) { console.log((cond ? 'PASS  ' : 'FAIL  ') + label); if (!cond) failures++; }
function text(el) { return (el ? el.textContent : '').replace(/\s+/g, ' ').trim(); }

const CLOUD = { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_KEY: 'sb_publishable_test_key' };
const PLACEHOLDERS = { SUPABASE_URL: 'PASTE_PROJECT_URL', SUPABASE_KEY: 'PASTE_PUBLISHABLE_KEY' };
const NOW = new Date().toISOString();
const SESSION = { access_token: 'tok-1', refresh_token: 'ref-1', user: { id: 'u-1', email: 'owner@hostel.test' } };

function boot(o) {
  o = o || {};
  const mock = o.mock || null;
  const network = o.fetch || noNetworkFetch();
  const dom = new JSDOM(html, {
    url: 'https://example.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.scrollTo = () => {};
      w.print = () => {};
      w.APP_CONFIG = o.appConfig || PLACEHOLDERS;
      if (mock) w.supabase = mock.lib;
      w.fetch = network;
      w.__online = o.online !== false;
      Object.defineProperty(w.navigator, 'onLine', { configurable: true, get: () => w.__online });
      if (o.seed) w.localStorage.setItem('hostelManager.v1', JSON.stringify(o.seed));
      Object.keys(o.storage || {}).forEach((k) => w.localStorage.setItem(k, o.storage[k]));
      w.URL.createObjectURL = () => 'blob:1';
      w.URL.revokeObjectURL = () => {};
      w.HTMLAnchorElement.prototype.click = function () {};
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
  const login = async (email, password) => {
    await settle(150);
    const form = authForm();
    if (!form) return false;
    const nameEl = form.elements['email'] || form.elements['username'];
    if (nameEl) nameEl.value = email;
    form.elements['password'].value = password;
    if (form.elements['confirm']) form.elements['confirm'].value = password;
    submit(form);
    await settle(400);
    return true;
  };
  /* presses a 4-digit PIN on the lock screen (setup, confirm, locked or verify) */
  const pressPin = async (pin) => {
    for (const ch of pin) {
      const key = q('[data-act="pin-digit"][data-digit="' + ch + '"]');
      if (key) click(key);
    }
    await settle(320);
  };
  const pin = async (value, mode) => {
    const v = value || '1234';
    if (!q('#lockLayer .lock-screen')) return false;
    const startMode = (q('#lockLayer .lock-screen') || {}).getAttribute
      ? q('#lockLayer .lock-screen').getAttribute('data-mode') : '';
    await pressPin(v);
    if (startMode === 'setup' || startMode === 'confirm') {
      if (q('#lockLayer .lock-screen')) await pressPin(v);
    }
    await settle(200);
    return !q('#lockLayer .lock-screen');
  };
  return { w, d, q, qa, click, act, submit, db, settle, authForm, login, pin, pressPin, network, mock };
}

function openSettings(h) {
  if (!h.q('[data-act="settings"]')) { h.act('tab', '[data-tab="home"]'); }
  h.act('settings');
}

function cloudRow(mock) { return mock.state.rows.get('u-1'); }

(async function () {

  /* ============================================ 1. placeholder config: local only */
  {
    const network = noNetworkFetch();
    const mock = makeSupabaseMock();
    const h = boot({ fetch: network, mock });
    await h.settle(220);
    ok(!!h.q('#authLayer.open'), 'with PASTE_ placeholders the app asks for a local account');
    ok(/Create your account/.test(text(h.q('.auth-title'))), 'a fresh phone still offers the first-run account: ' + text(h.q('.auth-title')));
    ok(mock.state.createCalls.length === 0, 'no Supabase client is created from placeholder values');
    ok(network.calls.length === 0, 'no network call is made with placeholder values');

    await h.login('owner', 'hostel123');
    ok(!!h.q('#lockLayer.open'), 'the PIN comes after the account');
    ok(await h.pin('4321'), 'a PIN can be set on a local-only phone');
    ok(!h.q('#authLayer.open') && !h.q('#lockLayer.open'), 'the app opens normally');
    ok(!h.q('#syncChip'), 'a local-only phone shows no cloud chip');
    ok(!!h.db() && Array.isArray(h.db().residents), 'the hostel data is saved on the phone');
    openSettings(h);
    await h.settle(120);
    ok(/Saved on this phone/.test(text(h.q('#syncStatus'))), 'settings explains the phone-only copy: ' + text(h.q('#syncStatus')));
    // the PIN locks the app again
    h.act('lock-now');
    await h.settle(120);
    ok(!!h.q('#lockLayer.open'), 'Lock now asks for the PIN');
    ok(/Enter your PIN/.test(text(h.q('.lock-title'))), 'the lock screen asks for the PIN');
    await h.pressPin('1111');
    ok(!!h.q('#lockLayer.open'), 'a wrong PIN keeps the app locked');
    ok(/Incorrect PIN/.test(text(h.q('.lock-msg'))), 'a wrong PIN says so: ' + text(h.q('.lock-msg')));
    ok(await h.pin('4321'), 'the right PIN unlocks it');
    ok(!!h.q('#screenRoot .topbar') && !h.q('.lock-screen'), 'the app is usable after unlocking');
    ok(network.calls.length === 0, 'still no network traffic at all');
  }

  /* ============================================ 2. first login uploads version 1 */
  {
    const seed = seedFixture();
    const mock = makeSupabaseMock();
    const h = boot({ mock, appConfig: CLOUD, seed: seed });
    await h.settle(220);
    ok(!!h.q('#authLayer.open'), 'with real keys the app opens on the sign-in screen');
    ok(/Sign in/.test(text(h.q('.auth-title'))), 'the cloud screen is a sign-in: ' + text(h.q('.auth-title')));
    ok(!h.q('[data-act="auth-toggle"]'), 'there is no sign-up screen in cloud mode');
    ok(!!h.q('#authLayer input[name="email"]'), 'it asks for an email address');
    ok(!h.q('#authLayer input[name="username"]'), 'it does not ask for a username');
    ok(!h.q('#lockLayer.open'), 'the PIN is not asked for before the login');

    await h.login('owner@hostel.test', 'wrong-password');
    ok(!!h.q('#authLayer.open'), 'a wrong password keeps the sign-in screen up');
    ok(/Wrong email or password/.test(text(h.q('.auth-msg'))), 'the sign-in error is explained: ' + text(h.q('.auth-msg')));

    await h.login('owner@hostel.test', 'hostel123');
    ok(!h.q('#authLayer.open'), 'the right password closes the sign-in screen');
    ok(!!h.q('#lockLayer.open'), 'then the PIN screen appears');
    await h.settle(200);
    ok(!cloudRow(mock), 'nothing is uploaded before the PIN is entered');
    ok(await h.pin('1234'), 'a PIN is set on the first cloud login');
    await h.settle(500);

    const row = cloudRow(mock);
    ok(!!row, 'the local data is uploaded after unlocking');
    ok(row && row.version === 1, 'the first upload is version 1: ' + (row && row.version));
    ok(row && row.data && row.data.residents.length === seed.residents.length, 'the whole database object is uploaded');
    ok(!!row && Array.isArray(row.data.payments) && Array.isArray(row.data.rooms), 'the jsonb document keeps every collection');
    ok(mock.state.calls.some((c) => c.op === 'insert'), 'an insert is used when the cloud has no copy yet');
    ok(h.db().meta.cloudVersion === 1, 'the phone remembers version 1');
    ok(/Saved to cloud/.test(text(h.q('#syncChip'))), 'the header chip says Saved to cloud: ' + text(h.q('#syncChip')));
  }

  /* ============================================ 3. pull on open */
  {
    const cloudData = seedFixture();
    cloudData.residents[0].name = 'Cloudy Guest';
    const mock = makeSupabaseMock({
      rows: { 'u-1': { data: cloudData, version: 4, updated_at: NOW } },
      session: SESSION
    });
    const h = boot({ mock, appConfig: CLOUD });
    await h.settle(250);
    ok(!!h.q('#lockLayer.open') && !h.q('#authLayer.open'), 'a saved cloud session goes straight to the PIN');
    ok(await h.pin('1234'), 'unlocking with a new PIN works');
    await h.settle(600);
    ok(/Cloudy Guest/.test(text(h.q('.screen'))), 'the cloud copy is shown after unlocking');
    ok(h.db().residents[0].name === 'Cloudy Guest', 'the local cache is filled from the cloud');
    ok(h.db().meta.cloudVersion === 4, 'the cloud version is remembered: ' + h.db().meta.cloudVersion);
    ok(!h.q('#conflictLayer.open'), 'an empty phone adopts the cloud copy with no question');
    ok(/Saved to cloud/.test(text(h.q('#syncChip'))), 'the chip confirms it is saved: ' + text(h.q('#syncChip')));
    ok(mock.state.calls.filter((c) => c.op === 'insert').length === 0, 'nothing is inserted over an existing cloud copy');
  }

  /* ============================================ 4. an edit saves locally, then uploads */
  {
    const cloudData = seedFixture();
    const mock = makeSupabaseMock({
      rows: { 'u-1': { data: cloudData, version: 4, updated_at: NOW } },
      session: SESSION
    });
    const h = boot({ mock, appConfig: CLOUD });
    await h.settle(250);
    await h.pin('1234');
    await h.settle(600);
    const before = mock.state.calls.length;
    openSettings(h);
    await h.settle(150);
    h.click(h.q('[data-act="toggle-large-text"]'));
    await h.settle(120);
    ok(h.db().settings.largeText === true, 'the change is written to the phone at once');
    const localOnly = mock.state.calls.slice(before).filter((c) => c.op === 'update');
    ok(localOnly.length === 0, 'the upload waits for the 2 second debounce');
    ok(/Saving/.test(text(h.q('#syncChip'))), 'the chip says Saving while the change waits: ' + text(h.q('#syncChip')));
    await h.settle(2600);
    const upd = mock.state.calls.slice(before).filter((c) => c.op === 'update')[0];
    ok(!!upd, 'the change is uploaded after the debounce');
    ok(upd && Number(upd.filters.version) === 4, 'the update only matches the version this phone knew: ' + (upd && upd.filters.version));
    ok(upd && upd.filters.user_id === 'u-1', 'the update is scoped to this user');
    ok(cloudRow(mock).version === 5, 'the cloud version moves to 5: ' + cloudRow(mock).version);
    ok(cloudRow(mock).data.settings.largeText === true, 'the cloud copy holds the new setting');
    ok(h.db().meta.cloudVersion === 5, 'the phone records the new version');
    ok(/Saved to cloud/.test(text(h.q('#syncChip'))), 'the chip returns to Saved to cloud');
  }

  /* ============================================ 5. offline, then reconnect */
  {
    const seed = seedFixture();
    seed.meta.cloudVersion = 3;
    const mock = makeSupabaseMock({
      rows: { 'u-1': { data: seed, version: 3, updated_at: NOW } },
      session: SESSION,
      offline: true
    });
    const h = boot({ mock, appConfig: CLOUD, seed: seed, online: false });
    await h.settle(250);
    ok(await h.pin('1234'), 'the PIN works with no internet');
    await h.settle(200);
    ok(/Offline, will sync/.test(text(h.q('#syncChip'))), 'the chip says Offline, will sync: ' + text(h.q('#syncChip')));
    ok(h.db().residents.length > 0, 'the phone keeps its own copy while offline');
    openSettings(h);
    await h.settle(150);
    ok(!h.q('#authLayer.open'), 'the app is fully usable offline');
    h.click(h.q('[data-act="toggle-large-text"]'));
    await h.settle(200);
    ok(h.db().settings.largeText === true, 'an offline change is saved on the phone');
    ok(cloudRow(mock).data.settings.largeText !== true, 'the cloud copy is untouched while offline');
    ok(/Offline, will sync|Saving/.test(text(h.q('#syncChip'))), 'the chip keeps saying it will sync: ' + text(h.q('#syncChip')));

    // the internet comes back
    mock.state.offline = false;
    h.w.__online = true;
    h.w.dispatchEvent(new h.w.Event('online'));
    await h.settle(900);
    ok(cloudRow(mock).data.settings.largeText === true, 'the queued change reaches the cloud on reconnect');
    ok(cloudRow(mock).version === 4, 'reconnecting bumps the cloud version: ' + cloudRow(mock).version);
    ok(/Saved to cloud/.test(text(h.q('#syncChip'))), 'the chip confirms the retry: ' + text(h.q('#syncChip')));
  }

  /* ============================================ 6. the choice screen */
  {
    const local = seedFixture();
    local.residents[0].name = 'Local Larry';
    local.meta.cloudVersion = 2;
    const cloudData = seedFixture();
    cloudData.residents[0].name = 'Cloudy Guest';
    const mock = makeSupabaseMock({
      rows: { 'u-1': { data: cloudData, version: 5, updated_at: NOW } },
      session: SESSION
    });
    const h = boot({ mock, appConfig: CLOUD, seed: local });
    await h.settle(250);
    await h.pin('1234');
    await h.settle(600);
    ok(!!h.q('#conflictLayer.open'), 'a version mismatch opens the choice screen');
    ok(/Cloud copy is newer/.test(text(h.q('#conflictLayer'))), 'it says the cloud copy is newer: ' + text(h.q('.auth-title')));
    ok(!!h.q('[data-act="conflict-cloud"]'), 'Use cloud copy is offered');
    ok(!!h.q('[data-act="conflict-local"]'), 'Keep this phone copy is offered');
    ok(/Local Larry|resident/.test(text(h.q('#conflictLayer'))), 'the screen describes both copies');
    ok(h.db().residents[0].name === 'Local Larry', 'nothing is overwritten before the choice');
    ok(cloudRow(mock).data.residents[0].name === 'Cloudy Guest', 'the cloud copy is left alone too');

    h.act('conflict-cloud');
    await h.settle(400);
    ok(!h.q('#conflictLayer.open'), 'choosing the cloud copy closes the screen');
    ok(h.db().residents[0].name === 'Cloudy Guest', 'the phone now holds the cloud copy');
    ok(h.db().meta.cloudVersion === 5, 'the cloud version is adopted');
    ok(cloudRow(mock).version === 5, 'the cloud copy is not rewritten');

    // the same screen, the other way round
    const local2 = seedFixture();
    local2.residents[0].name = 'Local Larry';
    local2.meta.cloudVersion = 2;
    const mock2 = makeSupabaseMock({
      rows: { 'u-1': { data: cloudData, version: 5, updated_at: NOW } },
      session: SESSION
    });
    const h2 = boot({ mock: mock2, appConfig: CLOUD, seed: local2 });
    await h2.settle(250);
    await h2.pin('1234');
    await h2.settle(600);
    h2.act('conflict-local');
    await h2.settle(600);
    ok(!h2.q('#conflictLayer.open'), 'keeping the phone copy closes the screen');
    ok(cloudRow(mock2).data.residents[0].name === 'Local Larry', 'the phone copy is uploaded');
    ok(cloudRow(mock2).version === 6, 'it becomes the next cloud version: ' + cloudRow(mock2).version);
    ok(h2.db().meta.cloudVersion === 6, 'the phone records that version');

    // this phone ahead of the cloud
    const ahead = seedFixture();
    ahead.meta.cloudVersion = 9;
    const behind = seedFixture();
    const mock3 = makeSupabaseMock({
      rows: { 'u-1': { data: behind, version: 7, updated_at: NOW } },
      session: SESSION
    });
    const h3 = boot({ mock: mock3, appConfig: CLOUD, seed: ahead });
    await h3.settle(250);
    await h3.pin('1234');
    await h3.settle(600);
    ok(/This phone has newer changes/.test(text(h3.q('#conflictLayer'))), 'a phone ahead of the cloud says so: ' + text(h3.q('.auth-title')));
  }

  /* ============================================ 7. logout clears this phone */
  {
    const cloudData = seedFixture();
    const mock = makeSupabaseMock({
      rows: { 'u-1': { data: cloudData, version: 4, updated_at: NOW } },
      session: SESSION
    });
    const h = boot({ mock, appConfig: CLOUD });
    await h.settle(250);
    await h.pin('1234');
    await h.settle(600);
    ok(h.db().residents.length > 0, 'the phone has the hostel data before logging out');
    openSettings(h);
    await h.settle(150);
    h.act('logout');
    await h.settle(150);
    ok(!!h.q('#lockLayer.open') && (h.q('#lockLayer .lock-screen') || {}).getAttribute('data-mode') === 'verify',
      'logging out asks for the PIN first');
    ok(!h.q('#confirmLayer .sheet'), 'the warning waits for the PIN');
    ok(await h.pin('1234'), 'the PIN is accepted');
    await h.settle(150);
    ok(!!h.q('#confirmLayer .sheet'), 'then the logout warning appears');
    ok(/lost|not reached the cloud/i.test(text(h.q('#confirmLayer'))), 'it warns that unsynced changes are lost: ' + text(h.q('#confirmLayer')).slice(0, 90));
    h.act('confirm-yes');
    await h.settle(400);
    ok(!!h.q('#authLayer.open'), 'logging out returns to the sign-in screen');
    ok(!h.w.localStorage.getItem('hostelManager.session'), 'the session is forgotten');
    ok(!h.w.localStorage.getItem('hostelManager.pin'), 'the PIN is forgotten too');
    ok(h.db().residents.length === 0 && h.db().rooms.length === 0, 'the local copy is cleared');
    ok(cloudRow(mock).data.residents.length === cloudData.residents.length, 'the cloud copy is untouched');
    ok(mock.state.signOuts === 1, 'the cloud session is signed out');
    ok(!h.q('#syncChip'), 'no cloud chip is left behind');
  }

  /* ============================================ 8. the service worker never caches the cloud */
  {
    ok(/hostel-manager-v7/.test(swSrc), 'the cache version was bumped to v7');
    ok(/\.\/vendor\/supabase\.js/.test(swSrc), 'the vendored client is part of the app shell');
    ok(/\.\/config\.js/.test(swSrc), 'config.js is part of the app shell');
    ok(/supabase/.test(swSrc), 'the worker knows about supabase hosts');
    ok(!/^\s*vendor\s*$/m.test(assetsIgnore), '.assetsignore does not exclude the vendor folder');
    ok(!/supabase/.test(assetsIgnore), '.assetsignore does not exclude supabase files');
    ok(/PASTE_PROJECT_URL/.test(configSrc) && /PASTE_PUBLISHABLE_KEY/.test(configSrc), 'config.js ships placeholders only');
    ok(!/service_role|secret/i.test(configSrc), 'config.js never mentions a secret key');
    ok(/window\.APP_CONFIG/.test(configSrc), 'config.js defines window.APP_CONFIG');
    ok(!/service_role/.test(html) && !/sb_secret/.test(html), 'index.html carries no secret key');

    const handlers = {};
    const cachePuts = [];
    const sandboxCache = {
      addAll: async () => {},
      put: async (req) => { cachePuts.push(String(req && req.url ? req.url : req)); }
    };
    const sandboxCaches = {
      open: async () => sandboxCache,
      match: async () => null,
      keys: async () => [],
      delete: async () => true
    };
    const self = {
      addEventListener: (type, fn) => { (handlers[type] = handlers[type] || []).push(fn); },
      location: { origin: 'https://app.test' },
      skipWaiting: () => {},
      clients: { claim: () => {} }
    };
    const fetched = [];
    const sandboxFetch = (req) => {
      fetched.push(String(req && req.url ? req.url : req));
      return Promise.resolve({ ok: true, clone() { return this; } });
    };
    const ctx = { self, caches: sandboxCaches, fetch: sandboxFetch, URL, Promise, console, Date };
    vm.runInNewContext(swSrc, ctx);

    const onFetch = (handlers.fetch || [])[0];
    ok(typeof onFetch === 'function', 'the worker registers a fetch handler');

    let responded = null;
    onFetch({
      request: { method: 'GET', url: 'https://abcxyz.supabase.co/rest/v1/app_state?select=data', mode: 'cors' },
      respondWith: (p) => { responded = p; }
    });
    ok(responded === null, 'a supabase REST request is never intercepted');
    await new Promise((r) => setTimeout(r, 30));
    ok(cachePuts.length === 0, 'nothing from supabase is written to the cache');

    responded = null;
    onFetch({
      request: { method: 'GET', url: 'https://abcxyz.supabase.co/auth/v1/token?grant_type=password', mode: 'cors' },
      respondWith: (p) => { responded = p; }
    });
    ok(responded === null, 'a supabase auth request is never intercepted');

    responded = null;
    onFetch({
      request: { method: 'GET', url: 'https://app.test/vendor/supabase.js', mode: 'cors' },
      respondWith: (p) => { responded = p; }
    });
    ok(responded !== null, 'the vendored client is served from the app cache');
    await responded;
    await new Promise((r) => setTimeout(r, 30));
    ok(cachePuts.some((u) => /vendor\/supabase\.js/.test(u)), 'vendor/supabase.js is cached: ' + cachePuts.join(', '));
    ok(!cachePuts.some((u) => /supabase\.co/.test(u)), 'no supabase.co URL ever reaches the cache');
  }

  console.log(failures === 0 ? '\nALL CLOUD TESTS PASSED' : '\n' + failures + ' TEST(S) FAILED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
