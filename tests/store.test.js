const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const TR = require('../shared/js/token-rules.js');

/** Minimal in-memory Firestore: setDoc, runTransaction with optimistic retry, rule hook. */
function makeFakeFirestore(data, rules) {
  const fs = {
    commits: [],
    collection: (db, name) => ({ path: name }),
    doc: (parent, ...segs) => ({ path: (parent.path ? [parent.path, ...segs] : segs).join('/') }),
    listeners: {},
    onSnapshot(ref, ...rest) {
      const cb = rest.find((x) => typeof x === 'function');
      fs.listeners[ref.path] = cb;
      return () => {};
    },
    /** Deliver the current `orders` collection to the store, like the realtime listener does. */
    deliverOrders() {
      const docs = [...data].filter(([p]) => p.startsWith('orders/'))
        .map(([p, v]) => ({ id: p.split('/')[1], data: () => ({ ...v }) }));
      fs.listeners.orders({ docs, metadata: { fromCache: false, hasPendingWrites: false } });
    },
    async getDocFromServer(ref) { return snap(ref); },
    async setDoc(ref, value, opts) {
      commit([{ ref, value, opts }]);
    },
    async runTransaction(db, fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map();
        const writes = [];
        const tx = {
          async get(ref) {
            await Promise.resolve();
            reads.set(ref.path, JSON.stringify(data.get(ref.path) || null));
            return snap(ref);
          },
          set(ref, value, opts) { writes.push({ ref, value, opts }); }
        };
        const result = await fn(tx);
        if (fs.beforeCommit) { fs.beforeCommit(attempt); }
        const clean = [...reads].every(([p, v]) => JSON.stringify(data.get(p) || null) === v);
        if (!clean) { fs.retries = (fs.retries || 0) + 1; continue; }
        commit(writes);
        return result;
      }
      const e = new Error('too much contention'); e.code = 'aborted'; throw e;
    }
  };
  function snap(ref) {
    const v = data.get(ref.path);
    return { exists: () => !!v, data: () => (v ? { ...v } : undefined) };
  }
  function commit(writes) {
    // Validate all first so a rejected write changes nothing.
    for (const w of writes) {
      const existing = data.get(w.ref.path) || null;
      const merged = { ...(existing || {}), ...w.value };
      if (rules) {
        const err = rules(w.ref.path, merged, existing);
        if (err) { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; throw e; }
      }
    }
    for (const w of writes) {
      data.set(w.ref.path, { ...(data.get(w.ref.path) || {}), ...w.value });
      fs.commits.push({ path: w.ref.path, value: w.value });
    }
  }
  return fs;
}

function loadStore({ staff = true } = {}) {
  const store = new Map();
  global.window = global;
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  global.OBTokenRules = TR;
  global.ORDER_BOARD_STAFF_APP = staff;
  const file = path.resolve(__dirname, '../shared/js/store.js');
  delete require.cache[file];
  require(file);
  const s = global.OBStore;
  s._resetForTest();
  return s;
}

const mkdata = () => new Map();

test('local-only: issueToken adds a free token and refuses an active one', async () => {
  const s = loadStore();
  const o = await s.issueToken(12);
  assert.equal(o.n, 12);
  assert.equal(s.find(12).c, 0);
  await assert.rejects(s.issueToken(12), /Token 12 is already in use/);
  await assert.rejects(s.issueToken(0), /between 1 and 200/);
  await assert.rejects(s.issueToken(201), /between 1 and 200/);
  await s.write(12, { c: Date.now() });
  await s.issueToken(12);                       // collected → free again
  assert.equal(s.find(12).c, 0);
});

test('firebase: issueToken creates {t,r:0,c:0} and never touches the counter', async () => {
  const data = mkdata();
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  await s.issueToken(7);
  assert.deepEqual(Object.keys(data.get('orders/7')).sort(), ['c', 'r', 't']);
  assert.equal(data.get('orders/7').r, 0);
  assert.equal(data.get('orders/7').c, 0);
  assert.equal(data.has('counters/token_counter'), false);
  assert.equal(s.find(7).c, 0);
});

test('firebase: issueToken refuses tokens active on another device, reuses free ones', async () => {
  const data = mkdata();
  const now = Date.now();
  const MIN = 60000;
  data.set('orders/1', { t: now - MIN, r: 0, c: 0 });                       // preparing
  data.set('orders/2', { t: now - MIN, r: now - MIN, c: 0 });               // ready, fresh
  data.set('orders/3', { t: now - 60 * MIN, r: now - 30 * MIN, c: 0 });     // ready, expired
  data.set('orders/4', { t: now - MIN, r: now - MIN, c: now });             // collected
  data.set('orders/5', { t: now - 5 * 3600000, r: 0, c: 0 });               // stale
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});                                                 // local copy is empty on purpose
  await assert.rejects(s.issueToken(1), /already in use/);
  await assert.rejects(s.issueToken(2), /already in use/);
  assert.equal(data.get('orders/1').r, 0);
  assert.equal(s.find(1), null, 'a refused token is not added locally');
  for (const n of [3, 4, 5]) {
    await s.issueToken(n);
    assert.deepEqual({ r: data.get('orders/' + n).r, c: data.get('orders/' + n).c }, { r: 0, c: 0 });
    assert.ok(data.get('orders/' + n).t >= now);
  }
});

test('firebase: two phones adding the same token at once — exactly one wins', async () => {
  const data = mkdata();
  const fs = makeFakeFirestore(data);
  const phoneA = loadStore();
  phoneA._attachForTest(fs, {});
  const phoneB = loadStore();
  phoneB._attachForTest(fs, {});
  const results = await Promise.allSettled([phoneA.issueToken(42), phoneB.issueToken(42)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.match(lost.reason.message, /Token 42 is already in use/);
  assert.ok(fs.retries > 0, 'transactions really contended and retried');
});

test('firebase: write resolves after confirmation and sends only changed fields', async () => {
  const data = mkdata();
  const now = Date.now();
  data.set('orders/5', { t: now - 5000, r: 0, c: 0 });
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  await s.write(5, { t: now - 5000, r: 0, c: 0 });
  fs.commits.length = 0;
  await s.write(5, { r: now });
  assert.deepEqual(fs.commits.at(-1), { path: 'orders/5', value: { r: now } });
  assert.equal(s.find(5).r, now);
});

test('firebase: rejected write rolls back the local change, surfaces an error and the sync label', async () => {
  const data = mkdata();
  const now = Date.now();
  data.set('orders/5', { t: now - 5000, r: 0, c: 0 });
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  fs.deliverOrders();
  assert.equal(s.find(5).r, 0);

  fs.setDoc = async () => { const e = new Error('nope'); e.code = 'permission-denied'; throw e; };
  const p = s.write(5, { r: now });
  assert.equal(s.find(5).r, now, 'optimistic until the server answers');
  await assert.rejects(p, /staff account/);
  assert.equal(s.find(5).r, 0, 'rolled back to the previous value');
  assert.match(s.getSyncLabel(), /^Could not sync\./);

  // a brand-new order that the server rejects disappears again (with an error, not silently)
  const q = s.write(6, { t: now, r: 0, c: 0 });
  assert.ok(s.find(6));
  await assert.rejects(q);
  assert.equal(s.find(6), null);
});

test('firebase: a newer write to the same token is not clobbered by an older failure', async () => {
  const data = mkdata();
  const now = Date.now();
  data.set('orders/5', { t: now - 5000, r: 0, c: 0 });
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  fs.deliverOrders();
  let failFirst;
  fs.setDoc = (ref, v) => new Promise((res, rej) => {
    if (v.r === now) failFirst = () => { const e = new Error('x'); e.code = 'unavailable'; rej(e); };
    else res();
  });
  const first = s.write(5, { r: now });
  const second = s.write(5, { r: 0, c: now + 1 });
  failFirst();
  await assert.rejects(first, /No connection/);
  await second;
  assert.equal(s.find(5).c, now + 1);
});

test('student: marking collected sends only c, and a rejection says why', async () => {
  const data = mkdata();
  const now = Date.now();
  data.set('orders/9', { t: now - 60000, r: now - 30000, c: 0 });
  // firestore.rules, case B: only `c` may change, on a ready, uncollected order; no creates, no counters
  const studentRules = (p, merged, existing) => {
    if (p.startsWith('counters/') || !existing) return 'denied';
    const changed = Object.keys(merged).filter((k) => merged[k] !== existing[k]);
    if (changed.some((k) => k !== 'c')) return 'denied';
    if (!(existing.r > 0 && existing.c === 0 && merged.c >= existing.r)) return 'denied';
    return null;
  };
  const fs = makeFakeFirestore(data, studentRules);
  const s = loadStore({ staff: false });
  s._attachForTest(fs, {});
  fs.deliverOrders();

  await s.write(9, { c: now });
  assert.deepEqual(fs.commits, [{ path: 'orders/9', value: { c: now } }]);
  assert.equal(data.get('orders/9').c, now);

  // already collected → rejected with the student-facing message; local copy keeps the server value
  fs.deliverOrders();
  await assert.rejects(s.write(9, { c: now + 1 }), /may not be ready, or was already handed over/);
  assert.equal(s.find(9).c, now);

  // student cannot create orders or touch the counter
  await assert.rejects(s.write(10, { t: now, r: 0, c: 0 }), /couldn’t accept/);
  await assert.rejects(s.issueToken(11), /couldn’t accept/);
});
