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

test('out-of-range numbers are refused with neutral wording (no numbers)', () => {
  for (const raw of ['0', '00', '201', '999', '1000']) {
    const r = E.validateToken(raw, { mines: [], order: live });
    assert.equal(r.ok, false, raw);
    assert.equal(r.code, 'range');
    assert.equal(r.message, 'Check the number on your receipt.');
    assert.doesNotMatch(r.message, /\d/);
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

test('typing is clamped silently: digits only, three at most, never above the top token', () => {
  assert.equal(E.clampInput('4a2'), '42');
  assert.equal(E.clampInput('1234'), '123', 'only three digits are kept');
  assert.equal(E.clampInput('300'), '30', 'drops the digit that would exceed the top token');
  assert.equal(E.clampInput('201'), '20');
  assert.equal(E.clampInput('200'), '200');
  assert.equal(E.clampInput('999'), '99');
  assert.equal(E.clampInput('250'), '25');
  assert.equal(E.clampInput('007'), '007');
  assert.equal(E.clampInput(''), '');
  assert.equal(E.clampInput('abc'), '');
});

test('no user-facing message anywhere mentions a numeric range', () => {
  for (const raw of ['', '0', '999', '42', '88']) {
    const r = E.validateToken(raw, { mines: [42], order: null });
    const msg = (r.message || '') + (r.note || '');
    assert.doesNotMatch(msg, /\b1\b.*\b200\b|between|range/i, raw);
  }
});
