/**
 * Firestore rules tests against the Firebase emulator (real firestore.rules).
 *
 *   npm run test:rules
 *
 * Needs Java 21+ (the Firestore emulator). Exercises the iOS write patterns
 * (ios/CueCore/.../FirestoreBoardStore.swift) and the Android ones.
 */
const assert = require('node:assert/strict');
const test = require('node:test');

const PROJECT = 'demo-cue';
const FS = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const MIN = 60000;
const HOUR = 60 * MIN;

const url = (path, mask) =>
  `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}` +
  (mask ? '?' + mask.map((f) => 'updateMask.fieldPaths=' + f).join('&') : '');

const toFields = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { integerValue: String(v) }]));
const fromFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, Number(v.integerValue)]));

async function call(token, method, path, body, mask) {
  const res = await fetch(url(path, mask), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify({ fields: toFields(body) }) : undefined
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

const OWNER = 'owner'; // emulator-only bypass token
const seed = (n, doc) => call(OWNER, 'PATCH', 'orders/' + n, doc);
const read = async (n) => fromFields((await call(null, 'GET', 'orders/' + n)).json.fields);

async function signUp(email) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw-123456' })
  });
  const j = await res.json();
  return { uid: j.localId, token: j.idToken };
}

let staff, other;
test.before(async () => {
  const stamp = Date.now();
  staff = await signUp(`staff${stamp}@cue.test`);
  other = await signUp(`other${stamp}@cue.test`);
  const r = await call(OWNER, 'PATCH', 'staff/' + staff.uid, { x: 1 });
  assert.ok(r.ok, 'seed staff doc');
});

// iOS: partial merge writes {r} / {c}; full {t,r,c} merge on issue. Android: same via setDoc merge.
const patch = (token, n, fields) => call(token, 'PATCH', 'orders/' + n, fields, Object.keys(fields));

test('staff can create an order, mark ready, hand over and undo (iOS + Android patterns)', async () => {
  const now = Date.now();
  assert.ok((await call(staff.token, 'PATCH', 'orders/1', { t: now, r: 0, c: 0 })).ok, 'create');
  assert.ok((await patch(staff.token, 1, { r: now })).ok, 'ready');
  assert.ok((await patch(staff.token, 1, { r: 0 })).ok, 'undo ready');
  assert.ok((await patch(staff.token, 1, { r: now })).ok, 'ready again');
  assert.ok((await patch(staff.token, 1, { c: now })).ok, 'hand over');
  assert.ok((await patch(staff.token, 1, { c: 0 })).ok, 'undo hand over');
  assert.ok((await call(staff.token, 'PATCH', 'orders/1', { t: (await read(1)).t, r: 0, c: 0 }, ['t', 'r', 'c'])).ok, 'full merge, same t');
});

test('staff CANNOT reset t on a preparing order (duplicate issue)', async () => {
  const now = Date.now();
  await seed(2, { t: now - 5 * MIN, r: 0, c: 0 });
  const res = await call(staff.token, 'PATCH', 'orders/2', { t: now, r: 0, c: 0 });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  assert.equal((await read(2)).t, now - 5 * MIN, 'unchanged');
});

test('staff CANNOT reset t on a freshly ready order', async () => {
  const now = Date.now();
  await seed(3, { t: now - 10 * MIN, r: now - 2 * MIN, c: 0 });
  assert.equal((await call(staff.token, 'PATCH', 'orders/3', { t: now, r: 0, c: 0 })).ok, false);
  assert.equal((await patch(staff.token, 3, { t: now })).ok, false, 'partial t-only update too');
});

test('re-issue IS allowed once collected, stale, or ready for over 20 min', async () => {
  const now = Date.now();
  await seed(4, { t: now - 10 * MIN, r: now - 5 * MIN, c: now - 1 * MIN });       // collected
  await seed(5, { t: now - 5 * HOUR, r: 0, c: 0 });                                // stale
  await seed(6, { t: now - 1 * HOUR, r: now - 30 * MIN, c: 0 });                   // ready, expired
  await seed(7, { t: now - 3 * HOUR, r: now - 21 * MIN, c: 0 });                   // expired (within grace window)
  for (const n of [4, 5, 6, 7]) {
    const res = await call(staff.token, 'PATCH', 'orders/' + n, { t: now, r: 0, c: 0 });
    assert.ok(res.ok, 'token ' + n + ' re-issue: ' + JSON.stringify(res.json));
  }
});

test('re-issue grace: client clock a little ahead of the server still works at the boundaries', async () => {
  const now = Date.now();
  await seed(8, { t: now - (4 * HOUR - 30 * 1000), r: 0, c: 0 });                  // 30 s before the 4 h limit
  assert.ok((await call(staff.token, 'PATCH', 'orders/8', { t: now, r: 0, c: 0 })).ok);
});

test('students (no sign-in) may only set c on a ready, uncollected order', async () => {
  const now = Date.now();
  await seed(10, { t: now - 10 * MIN, r: now - 2 * MIN, c: 0 });
  assert.equal((await patch(null, 10, { t: now })).ok, false, 'cannot change t');
  assert.equal((await patch(null, 10, { r: 0 })).ok, false, 'cannot change r');
  assert.equal((await call(null, 'PATCH', 'orders/11', { t: now, r: 0, c: 0 })).ok, false, 'cannot create');
  assert.ok((await patch(null, 10, { c: now })).ok, 'can collect');
  assert.equal((await patch(null, 10, { c: now + 1000 })).ok, false, 'cannot collect twice');
  await seed(12, { t: now - 10 * MIN, r: 0, c: 0 });
  assert.equal((await patch(null, 12, { c: now })).ok, false, 'cannot collect a preparing order');
});

test('a signed-in non-staff account is treated like a student', async () => {
  const now = Date.now();
  assert.equal((await call(other.token, 'PATCH', 'orders/13', { t: now, r: 0, c: 0 })).ok, false);
});

test('counter documents stay staff-writable (iOS issue transaction)', async () => {
  const now = Date.now();
  assert.ok((await call(staff.token, 'PATCH', 'counters/token_counter', { next: 2, version: 1, updatedAt: now })).ok);
  assert.equal((await call(null, 'PATCH', 'counters/token_counter', { next: 9, version: 9, updatedAt: now })).ok, false);
});

test('token ids are 1–200: 200 is accepted, 0 and 201 are refused', async () => {
  const now = Date.now();
  assert.ok((await call(staff.token, 'PATCH', 'orders/150', { t: now, r: 0, c: 0 })).ok, '150');
  assert.ok((await call(staff.token, 'PATCH', 'orders/151', { t: now, r: 0, c: 0 })).ok, '151');
  assert.ok((await call(staff.token, 'PATCH', 'orders/200', { t: now, r: 0, c: 0 })).ok, '200');
  assert.equal((await call(staff.token, 'PATCH', 'orders/201', { t: now, r: 0, c: 0 })).ok, false, '201');
  assert.equal((await call(staff.token, 'PATCH', 'orders/0', { t: now, r: 0, c: 0 })).ok, false, '0');
  assert.equal((await call(staff.token, 'PATCH', 'orders/2000', { t: now, r: 0, c: 0 })).ok, false, '2000');
});
