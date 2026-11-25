/* A tiny stand-in for @supabase/supabase-js (client v2 API surface used by the
   app): auth.signInWithPassword / getSession / signOut and the from(table)
   query builder with select / eq / limit / insert / update / upsert / delete.
   Two tables are modelled: app_state (one jsonb document per user) and
   resident_ids (one row per resident). Every call is recorded so tests can
   assert exactly what the app sent to the cloud. */
'use strict';

function makeSupabaseMock(opts) {
  opts = opts || {};
  const state = {
    users: opts.users || { 'owner@hostel.test': { id: 'u-1', password: 'hostel123' } },
    rows: new Map(Object.entries(opts.rows || {})),        // user_id -> { data, version, updated_at }
    idRows: new Map(Object.entries(opts.idRows || {})),    // 'user_id|resident_id' -> row
    session: opts.session || null,
    calls: [],          // data calls: { table, op, filters, payload }
    authCalls: [],      // sign-in attempts
    createCalls: [],    // createClient invocations
    signOuts: 0,
    failNext: null,     // 'network' | 'auth' -> next data call fails
    offline: !!opts.offline
  };

  function networkError() {
    const err = new TypeError('Failed to fetch');
    err.name = 'AuthRetryableFetchError';
    return err;
  }

  function exec(q) {
    if (state.offline) throw networkError();
    if (state.failNext) {
      const kind = state.failNext;
      state.failNext = null;
      if (kind === 'network') throw networkError();
      return { data: null, error: { message: 'permission denied for table ' + q.table, code: '42501' } };
    }
    state.calls.push({
      table: q.table, op: q.op,
      filters: Object.assign({}, q.filters),
      payload: q.payload
    });

    if (q.table === 'resident_ids') {
      if (q.op === 'select') {
        const out = [];
        state.idRows.forEach((row) => {
          if (q.filters.user_id && row.user_id !== q.filters.user_id) return;
          if (q.filters.resident_id && row.resident_id !== q.filters.resident_id) return;
          out.push({
            resident_id: row.resident_id,
            id_type: row.id_type,
            id_number: row.id_number,
            updated_at: row.updated_at
          });
        });
        return { data: out, error: null };
      }
      if (q.op === 'upsert') {
        const row = q.payload;
        const key = row.user_id + '|' + row.resident_id;
        const merged = Object.assign({ updated_at: new Date().toISOString() }, state.idRows.get(key) || {}, row);
        state.idRows.set(key, merged);
        return { data: [{ resident_id: row.resident_id }], error: null };
      }
      if (q.op === 'delete') {
        const key = q.filters.user_id + '|' + q.filters.resident_id;
        const had = state.idRows.has(key);
        state.idRows.delete(key);
        return { data: had ? [{ resident_id: q.filters.resident_id }] : [], error: null };
      }
      return { data: [], error: null };
    }

    if (q.op === 'select') {
      const row = state.rows.get(q.filters.user_id);
      if (!row) return { data: [], error: null };
      return { data: [{ data: row.data, version: row.version, updated_at: row.updated_at }], error: null };
    }
    if (q.op === 'insert') {
      const row = q.payload[0];
      if (state.rows.has(row.user_id)) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } };
      }
      state.rows.set(row.user_id, { data: row.data, version: row.version, updated_at: row.updated_at });
      return { data: [{ version: row.version }], error: null };
    }
    if (q.op === 'update') {
      const current = state.rows.get(q.filters.user_id);
      if (!current || Number(current.version) !== Number(q.filters.version)) return { data: [], error: null };
      state.rows.set(q.filters.user_id, {
        data: q.payload.data, version: q.payload.version, updated_at: q.payload.updated_at
      });
      return { data: [{ version: q.payload.version }], error: null };
    }
    if (q.op === 'delete') {
      const had = state.rows.delete(q.filters.user_id);
      return { data: had ? [{ user_id: q.filters.user_id }] : [], error: null };
    }
    return { data: [], error: null };
  }

  function from(table) {
    const q = { table: table, op: 'select', filters: {}, payload: null };
    const api = {
      select() { return api; },
      eq(col, value) { q.filters[col] = value; return api; },
      limit() { return api; },
      insert(row) { q.op = 'insert'; q.payload = [].concat(row); return api; },
      update(row) { q.op = 'update'; q.payload = row; return api; },
      upsert(row) { q.op = 'upsert'; q.payload = [].concat(row)[0]; return api; },
      delete() { q.op = 'delete'; return api; },
      then(resolve, reject) { return Promise.resolve().then(() => exec(q)).then(resolve, reject); }
    };
    return api;
  }

  const client = {
    auth: {
      async getSession() {
        return { data: { session: state.session }, error: null };
      },
      async signInWithPassword(creds) {
        state.authCalls.push({ email: creds.email, password: creds.password });
        if (state.offline) return { data: { session: null }, error: { message: 'Failed to fetch' } };
        const user = state.users[creds.email];
        if (!user || user.password !== creds.password) {
          return { data: { session: null }, error: { message: 'Invalid login credentials', status: 400 } };
        }
        state.session = {
          access_token: 'tok-1',
          refresh_token: 'ref-1',
          user: { id: user.id, email: creds.email }
        };
        return { data: { session: state.session }, error: null };
      },
      async signOut() {
        state.signOuts += 1;
        state.session = null;
        return { error: null };
      }
    },
    from: from
  };

  const lib = {
    createClient(url, key) {
      state.createCalls.push({ url: url, key: key });
      return client;
    }
  };

  return { lib: lib, state: state, client: client };
}

/* A stand-in for window.fetch that records and refuses everything: no test in
   this suite may ever reach the real network. */
function noNetworkFetch(label) {
  const calls = [];
  const fn = (url) => {
    calls.push(String(url));
    if (label) console.log('   (unexpected network call to ' + url + ')');
    return Promise.reject(new TypeError('Failed to fetch'));
  };
  fn.calls = calls;
  return fn;
}

module.exports = { makeSupabaseMock, noNetworkFetch };
