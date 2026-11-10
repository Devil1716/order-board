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

test('local-only: issueNext uses the same scan, and undo restores the cursor', async () => {
  const s = loadStore();
  const a = await s.issueNext();
  const b = await s.issueNext();
  assert.deepEqual([a.token, b.token], [1, 2]);
  assert.equal(s.previewNext(), 3);
  assert.equal(await s.undoIssue(b), true);
  assert.equal(s.previewNext(), 2);
  assert.equal(s.find(2).c > 0, true, 'undone token is handed back');
  assert.equal(await s.undoIssue(a), false, 'cursor moved on since, so it must not rewind');
  await s.setNextStart(151);
  assert.equal(s.previewNext(), 1, 'invalid restart falls back to 1');
});

test('firebase: issueNext writes counter {next,version,updatedAt} and the order doc in one transaction', async () => {
  const data = mkdata();
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  const a = await s.issueNext();
  assert.equal(a.token, 1);
  assert.equal(a.previousStart, 1);
  assert.equal(a.nextStart, 2);
  assert.equal(a.counterVersion, 1);
  const counter = data.get('counters/token_counter');
  assert.equal(counter.next, 2);
  assert.equal(counter.version, 1);
  assert.equal(typeof counter.updatedAt, 'number');
  const order = data.get('orders/1');
  assert.deepEqual(Object.keys(order).sort(), ['c', 'r', 't']);
  assert.equal(order.r, 0);
  assert.equal(order.c, 0);
  assert.equal(s.getOrders().length, 1);
});

test('firebase: continues from a counter written by iOS, skips taken tokens, wraps', async () => {
  const data = mkdata();
  const now = Date.now();
  data.set('counters/token_counter', { next: 149, version: 41, updatedAt: now });
  data.set('orders/149', { t: now - 1000, r: 0, c: 0 });
  data.set('orders/150', { t: now - 1000, r: 0, c: 0 });
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  const a = await s.issueNext();
  assert.equal(a.token, 1);
  assert.equal(a.previousStart, 149);
  assert.equal(a.counterVersion, 42);
  assert.equal(data.get('counters/token_counter').next, 2);
});

test('firebase: two phones issuing at once never get the same token', async () => {
  const data = mkdata();
  const fs = makeFakeFirestore(data);
  const phoneA = loadStore();
  phoneA._attachForTest(fs, {});
  const phoneB = loadStore();
  phoneB._attachForTest(fs, {});
  const results = await Promise.all([phoneA.issueNext(), phoneB.issueNext(), phoneA.issueNext(), phoneB.issueNext()]);
  const tokens = results.map((r) => r.token).sort((x, y) => x - y);
  assert.deepEqual(tokens, [1, 2, 3, 4]);
  assert.ok(fs.retries > 0, 'transactions really contended and retried');
  assert.equal(data.get('counters/token_counter').next, 5);
  assert.equal(data.get('counters/token_counter').version, 4);
});

test('firebase: undo hands the order back and rewinds the counter only if nobody moved it', async () => {
  const data = mkdata();
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  const a = await s.issueNext();
  assert.equal(await s.undoIssue(a), true);
  assert.equal(data.get('counters/token_counter').next, 1);
  assert.equal(data.get('counters/token_counter').version, 2);
  assert.ok(data.get('orders/1').c > 0);

  const b = await s.issueNext();           // token 1 again (collected → free)
  assert.equal(b.token, 1);
  await s.issueNext();                      // someone else moves the counter
  assert.equal(await s.undoIssue(b), false);
  assert.equal(data.get('counters/token_counter').next, 3, 'counter untouched when version moved');
});

test('firebase: restart numbering goes through the counter and bumps version', async () => {
  const data = mkdata();
  data.set('counters/token_counter', { next: 77, version: 5, updatedAt: 1 });
  const s = loadStore();
  s._attachForTest(makeFakeFirestore(data), {});
  await s.setNextStart(1);
  assert.equal(data.get('counters/token_counter').next, 1);
  assert.equal(data.get('counters/token_counter').version, 6);
  assert.equal(await s.getNextStart(), 1);
  assert.equal(s.previewNext(), 1);
});

test('firebase: all 150 tokens in use rejects with a clear error and writes nothing', async () => {
  const data = mkdata();
  const now = Date.now();
  for (let n = 1; n <= 150; n++) data.set('orders/' + n, { t: now - 1000, r: 0, c: 0 });
  const fs = makeFakeFirestore(data);
  const s = loadStore();
  s._attachForTest(fs, {});
  await assert.rejects(() => s.issueNext(), /All 150 tokens are in use/);
  assert.equal(fs.commits.length, 0);
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
  await assert.rejects(s.issueNext());
});
