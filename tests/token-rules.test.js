const test = require('node:test');
const assert = require('node:assert/strict');
const TR = require('../shared/js/token-rules.js');

const NOW = 1_800_000_000_000;
const MIN = 60000;
const HOUR = 60 * MIN;

test('isTaken matches the iOS transaction', () => {
  assert.equal(TR.isTaken(null, NOW), false);
  assert.equal(TR.isTaken({ t: NOW - MIN, r: 0, c: 0 }, NOW), true, 'preparing holds the token');
  assert.equal(TR.isTaken({ t: NOW - MIN, r: NOW - MIN, c: 0 }, NOW), true, 'fresh ready holds it');
  assert.equal(TR.isTaken({ t: NOW - HOUR, r: NOW - 20 * MIN, c: 0 }, NOW), true, 'exactly 20 min is still held');
  assert.equal(TR.isTaken({ t: NOW - HOUR, r: NOW - 20 * MIN - 1, c: 0 }, NOW), false, 'ready expired after 20 min');
  assert.equal(TR.isTaken({ t: NOW - MIN, r: NOW - MIN, c: NOW }, NOW), false, 'collected is free');
  assert.equal(TR.isTaken({ t: NOW - 4 * HOUR, r: 0, c: 0 }, NOW), true, 'exactly 4 h is not stale yet');
  assert.equal(TR.isTaken({ t: NOW - 4 * HOUR - 1, r: 0, c: 0 }, NOW), false, 'older than 4 h is stale');
});

test('isValidToken accepts whole numbers 1–200 only', () => {
  assert.equal(TR.isValidToken(1), true);
  assert.equal(TR.isValidToken(151), true);
  assert.equal(TR.isValidToken(200), true);
  for (const bad of [0, 201, 1000, -1, 2.5, NaN, '5', null, undefined]) assert.equal(TR.isValidToken(bad), false, String(bad));
});

const fmt = (ms) => 'T' + (ms - NOW) / MIN;

test('entryState: empty and free numbers offer Add', () => {
  assert.deepEqual(TR.entryState(0, null, NOW), { kind: 'empty', blocked: false });
  assert.deepEqual(TR.entryState(12, null, NOW), { kind: 'free', blocked: false, n: 12 });
  assert.equal(TR.entryState(201, null, NOW).kind, 'invalid');
  assert.equal(TR.entryState(201, null, NOW).blocked, true);
  assert.equal(TR.entryState(200, null, NOW).kind, 'free');
  assert.match(TR.entryState(201, null, NOW).message, /Check the token number/);
});

test('entryState: a preparing token is in use and blocks Add', () => {
  const st = TR.entryState(12, { t: NOW - 5 * MIN, r: 0, c: 0 }, NOW, fmt);
  assert.equal(st.kind, 'preparing');
  assert.equal(st.blocked, true);
  assert.equal(st.title, 'Token 12 is already in use');
  assert.match(st.message, /Preparing since T-5/);
  assert.match(st.message, /Mark it ready/);
});

test('entryState: a ready token is in use until 20 min after ready', () => {
  const st = TR.entryState(12, { t: NOW - 30 * MIN, r: NOW - 10 * MIN, c: 0 }, NOW, fmt);
  assert.equal(st.kind, 'ready');
  assert.equal(st.blocked, true);
  assert.match(st.message, /Ready since T-10/);
  assert.equal(TR.entryState(12, { t: NOW - 60 * MIN, r: NOW - 21 * MIN, c: 0 }, NOW).kind, 'free');
});

test('entryState: collected and stale orders are free; just handed over warns but does not block', () => {
  assert.equal(TR.entryState(5, { t: NOW - 30 * MIN, r: NOW - 20 * MIN, c: NOW - 10 * MIN }, NOW).kind, 'free');
  assert.equal(TR.entryState(5, { t: NOW - 5 * HOUR, r: 0, c: 0 }, NOW).kind, 'free');
  const st = TR.entryState(5, { t: NOW - 30 * MIN, r: NOW - 5 * MIN, c: NOW - 90 * 1000 }, NOW, fmt);
  assert.equal(st.kind, 'recent');
  assert.equal(st.blocked, false);
  assert.match(st.message, /Add it again\?/);
  assert.equal(TR.entryState(5, { t: NOW - 30 * MIN, r: 0, c: NOW - 2 * MIN - 1 }, NOW).kind, 'free', 'warning window is 2 min');
});

test('nearestFree returns the closest free numbers, skipping in-use and just-handed-over ones', () => {
  const busy = { t: NOW - MIN, r: 0, c: 0 };
  const board = { 12: busy, 13: busy, 11: { t: NOW - MIN, r: 0, c: NOW - 30 * 1000 }, 10: busy };
  const get = (n) => board[n] || null;
  assert.deepEqual(TR.nearestFree(12, get, NOW, 3), [14, 15, 9]);
  assert.deepEqual(TR.nearestFree(12, get, NOW, 2), [14, 15]);
});

test('nearestFree stays inside 1–200 at the edges', () => {
  assert.deepEqual(TR.nearestFree(1, () => null, NOW, 3), [2, 3, 4]);
  assert.deepEqual(TR.nearestFree(200, () => null, NOW, 3), [199, 198, 197]);
  const busy = { t: NOW - MIN, r: 0, c: 0 };
  assert.deepEqual(TR.nearestFree(2, (n) => (n === 1 || n === 3 ? busy : null), NOW, 3), [4, 5, 6]);
  assert.deepEqual(TR.nearestFree(5, () => busy, NOW, 3), [], 'nothing free');
});
