const test = require('node:test');
const assert = require('node:assert/strict');
const TR = require('../shared/js/token-rules.js');

const NOW = 1_800_000_000_000;
const MIN = 60000;
const HOUR = 60 * MIN;

test('normalizeStart falls back to 1 for anything outside 1–150', () => {
  assert.equal(TR.normalizeStart(1), 1);
  assert.equal(TR.normalizeStart(150), 150);
  for (const bad of [0, -3, 151, 1.5, NaN, undefined, null, 'x']) {
    assert.equal(TR.normalizeStart(bad), 1, String(bad));
  }
});

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

test('chooseToken returns the start when the board is empty', async () => {
  assert.deepEqual(await TR.chooseToken(7, () => null, NOW), { token: 7, nextStart: 8 });
});

test('chooseToken skips taken tokens and wraps 150 → 1', async () => {
  const board = {
    149: { t: NOW - MIN, r: 0, c: 0 },
    150: { t: NOW - MIN, r: 0, c: 0 },
    1: { t: NOW - MIN, r: 0, c: 0 }
  };
  const pick = await TR.chooseToken(149, (n) => board[n] || null, NOW);
  assert.deepEqual(pick, { token: 2, nextStart: 3 });
});

test('chooseToken wraps the next cursor after 150', async () => {
  assert.deepEqual(await TR.chooseToken(150, () => null, NOW), { token: 150, nextStart: 1 });
});

test('chooseToken reuses stale, expired and collected tokens', async () => {
  const board = {
    10: { t: NOW - 5 * HOUR, r: 0, c: 0 },
    11: { t: NOW - HOUR, r: NOW - 30 * MIN, c: 0 },
    12: { t: NOW - HOUR, r: 0, c: NOW - MIN }
  };
  assert.equal((await TR.chooseToken(10, (n) => board[n] || null, NOW)).token, 10);
  assert.equal((await TR.chooseToken(11, (n) => board[n] || null, NOW)).token, 11);
  assert.equal((await TR.chooseToken(12, (n) => board[n] || null, NOW)).token, 12);
});

test('chooseToken awaits async reads and returns null when all 150 are in use', async () => {
  const busy = { t: NOW - MIN, r: 0, c: 0 };
  const reads = [];
  const pick = await TR.chooseToken(40, async (n) => { reads.push(n); return busy; }, NOW);
  assert.equal(pick, null);
  assert.equal(reads.length, 150);
  assert.equal(reads[0], 40);
  assert.equal(reads[110], 150);
  assert.equal(reads[111], 1);
});

test('chooseTokenSync agrees with chooseToken', async () => {
  const board = { 3: { t: NOW - MIN, r: 0, c: 0 }, 4: { t: NOW - MIN, r: 0, c: 0 } };
  const get = (n) => board[n] || null;
  assert.deepEqual(TR.chooseTokenSync(3, get, NOW), await TR.chooseToken(3, get, NOW));
});
