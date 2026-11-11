const test = require('node:test');
const assert = require('node:assert/strict');
const NR = require('../shared/js/notify-rules.js');

const NOW = 1_800_000_000_000;
const MIN = 60000;
const ready = { t: NOW - 10 * MIN, r: NOW - MIN, c: 0 };

test('foreground: full-screen alert only, never a system notification', () => {
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: true }), 'alert');
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: true, notifiedR: ready.r }), 'alert');
});

test('background / screen off / killed: system notification, once per ready transition', () => {
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: false }), 'notify');
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: false, notifiedR: ready.r }), 'none', 'no duplicate');
  const again = { t: ready.t, r: ready.r + 5 * MIN, c: 0 };
  assert.equal(NR.deliveryFor({ order: again, now: NOW + 5 * MIN, visible: false, notifiedR: ready.r }), 'notify', 'new transition notifies again');
});

test('foreground/background switching never duplicates', () => {
  // Alert shown in app, student acknowledges, then backgrounds: nothing more to say.
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: false, ackedR: ready.r }), 'none');
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: true, ackedR: ready.r }), 'none');
  // Notified in background, then app opened: in-app alert shows (notification is cleared separately).
  assert.equal(NR.deliveryFor({ order: ready, now: NOW, visible: true, notifiedR: ready.r }), 'alert');
});

test('nothing for preparing, collected, expired or missing orders', () => {
  for (const visible of [true, false]) {
    assert.equal(NR.deliveryFor({ order: null, now: NOW, visible }), 'none');
    assert.equal(NR.deliveryFor({ order: { t: NOW - MIN, r: 0, c: 0 }, now: NOW, visible }), 'none');
    assert.equal(NR.deliveryFor({ order: { ...ready, c: NOW }, now: NOW, visible }), 'none');
    assert.equal(NR.deliveryFor({ order: { t: NOW - 60 * MIN, r: NOW - 21 * MIN, c: 0 }, now: NOW, visible }), 'none');
  }
});

test('shouldClear: collected, expired or acknowledged', () => {
  assert.equal(NR.shouldClear(ready, NOW, undefined), false);
  assert.equal(NR.shouldClear({ ...ready, c: NOW }, NOW), true);
  assert.equal(NR.shouldClear(ready, NOW + 25 * MIN), true);
  assert.equal(NR.shouldClear(ready, NOW, ready.r), true);
  assert.equal(NR.shouldClear(null, NOW), true);
});

test('isActive: keeps watching until collected or expired', () => {
  assert.equal(NR.isActive(null, NOW), true, 'not added yet');
  assert.equal(NR.isActive({ t: NOW - MIN, r: 0, c: 0 }, NOW), true);
  assert.equal(NR.isActive(ready, NOW), true);
  assert.equal(NR.isActive({ ...ready, c: NOW }, NOW), false);
  assert.equal(NR.isActive(ready, NOW + 25 * MIN), false);
  assert.equal(NR.isActive({ t: NOW - 5 * 3600000, r: 0, c: 0 }, NOW), false, 'stale');
});
