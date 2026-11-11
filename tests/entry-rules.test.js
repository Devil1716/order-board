const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../shared/js/entry-rules.js');

const live = { t: 1, r: 0, c: 0 };

test('empty and non-numeric input asks for the receipt number', () => {
  for (const raw of ['', '   ', 'abc', null, undefined]) {
    const r = E.validateToken(raw, { mines: [], order: live });
    assert.equal(r.ok, false, String(raw));
    assert.equal(r.code, 'empty');
  }
});

test('range is 1 to 200 with a clear message', () => {
  for (const raw of ['0', '00', '201', '999', '1000']) {
    const r = E.validateToken(raw, { mines: [], order: live });
    assert.equal(r.ok, false, raw);
    assert.equal(r.code, 'range');
    assert.equal(r.message, 'Token numbers run from 1 to 200.');
  }
  for (const raw of ['1', '7', '42', '200', '007']) {
    assert.equal(E.validateToken(raw, { mines: [], order: live }).ok, true, raw);
  }
});

test('stray characters are ignored, so “4 2” is token 42', () => {
  const r = E.validateToken('4 2', { mines: [], order: live });
  assert.equal(r.ok, true);
  assert.equal(r.token, 42);
});

test('already tracking the same token is rejected inline', () => {
  const r = E.validateToken('42', { mines: [42, 7], order: live });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'duplicate');
  assert.match(r.message, /already tracking token 42/);
});

test('tracking more than the limit is rejected', () => {
  const r = E.validateToken('9', { mines: [1, 2, 3, 4, 5], order: live });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'limit');
  assert.equal(E.validateToken('9', { mines: [1, 2, 3, 4], order: live }).ok, true);
});

test('a token staff have not added yet still works, with a heads-up', () => {
  const r = E.validateToken('88', { mines: [], order: null });
  assert.equal(r.ok, true);
  assert.equal(r.token, 88);
  assert.match(r.note, /isn’t on the board yet/);
});

test('an already collected token works but warns', () => {
  const r = E.validateToken('12', { mines: [], order: { t: 1, r: 2, c: 3 } });
  assert.equal(r.ok, true);
  assert.match(r.note, /already shows as collected/);
});

test('a normal preparing token has no note', () => {
  const r = E.validateToken('40', { mines: [], order: live });
  assert.deepEqual(r, { ok: true, token: 40 });
});
