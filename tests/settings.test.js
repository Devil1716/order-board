const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/js/settings.js');

function memoryStore(initial) {
  const data = Object.assign({}, initial);
  return { data, get: async (k) => (k in data ? data[k] : null), set: async (k, v) => { data[k] = v; } };
}

test('defaults apply when nothing is saved', async () => {
  const s = S.create(memoryStore(), { sound: false, vibration: true });
  assert.deepEqual(await s.load(), { sound: false, vibration: true });
  assert.equal(S.create(memoryStore()).get('sound'), true, 'sound defaults on');
});

test('choices persist and load back in a new session', async () => {
  const store = memoryStore();
  const a = S.create(store);
  await a.load();
  await a.set('sound', false);
  await a.set('vibration', false);
  assert.equal(store.data['ob-sound'], '0');
  assert.equal(store.data['ob-vibration'], '0');
  const b = S.create(store);
  await b.load();
  assert.equal(b.get('sound'), false);
  assert.equal(b.get('vibration'), false);
  await b.set('sound', true);
  assert.equal(store.data['ob-sound'], '1');
});

test('unreadable or junk saved values fall back to the default', async () => {
  const s = S.create({ get: async (k) => { if (k === 'ob-sound') throw new Error('boom'); return 'maybe'; }, set: async () => {} }, { sound: true, vibration: false });
  assert.deepEqual(await s.load(), { sound: true, vibration: false });
});

test('set rejects unknown keys and notifies listeners', async () => {
  const s = S.create(memoryStore());
  const seen = [];
  s.onChange((k, v) => seen.push([k, v]));
  await s.set('sound', false);
  assert.deepEqual(seen, [['sound', false]]);
  await assert.rejects(s.set('nope', true), /Unknown setting/);
});

test('theme modes: unknown -> system; system follows the phone', () => {
  assert.equal(S.normalizeTheme('dark'), 'dark');
  assert.equal(S.normalizeTheme('light'), 'light');
  for (const v of [null, undefined, '', 'system', 'blue']) assert.equal(S.normalizeTheme(v), 'system');
  assert.equal(S.resolveTheme('system', true), 'dark');
  assert.equal(S.resolveTheme('system', false), 'light');
  assert.equal(S.resolveTheme('light', true), 'light');
  assert.equal(S.resolveTheme('dark', false), 'dark');
});
