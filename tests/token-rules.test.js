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

test('isValidToken accepts whole numbers 1–150 only', () => {
  assert.equal(TR.isValidToken(1), true);
  assert.equal(TR.isValidToken(150), true);
  for (const bad of [0, 151, -1, 2.5, NaN, '5', null, undefined]) assert.equal(TR.isValidToken(bad), false, String(bad));
});
