const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const O = require('../shared/js/ota.js');
const L = require('../scripts/ota/lib.js');
const { assemble, rollbackManifest } = require('../scripts/ota/publish.js');

const SHA = 'a'.repeat(64);
function manifest(over) {
  return Object.assign({
    schema: 1, app: 'student', channel: 'prod', version: '1.1.0-ota.202611120000',
    url: 'https://github.com/Devil1716/order-board/releases/download/x/student.zip', sha256: SHA,
    minNativeVersion: '1.1.0', revoked: []
  }, over);
}
const ctx = (over) => Object.assign({ app: 'student', channel: 'prod', nativeVersion: '1.1.0', currentVersion: 'builtin', failed: [] }, over);

test('compareVersions orders dotted numbers numerically and ignores suffixes', () => {
  assert.equal(O.compareVersions('1.10.0', '1.9.2'), 1);
  assert.equal(O.compareVersions('1.0', '1.0.0'), 0);
  assert.equal(O.compareVersions('1.1.0-ota.2026', '1.1.0'), 0);
  assert.equal(O.compareVersions('0.9.9', '1.0.0'), -1);
});

test('validateManifest rejects anything unsafe or for another app/channel', () => {
  assert.equal(O.validateManifest(manifest(), 'student', 'prod'), null);
  assert.equal(O.validateManifest(manifest(), 'staff', 'prod'), 'wrong-app');
  assert.equal(O.validateManifest(manifest(), 'student', 'beta'), 'wrong-channel');
  assert.equal(O.validateManifest(manifest({ url: 'http://insecure/x.zip' }), 'student', 'prod'), 'bad-url');
  assert.equal(O.validateManifest(manifest({ sha256: 'nope' }), 'student', 'prod'), 'bad-checksum');
  assert.equal(O.validateManifest(manifest({ schema: 2 }), 'student', 'prod'), 'unknown-schema');
  assert.equal(O.validateManifest(manifest({ version: '../evil' }), 'student', 'prod'), 'bad-version');
  assert.equal(O.validateManifest(null, 'student', 'prod'), 'not-an-object');
});

test('decide: downloads a new version, ignores the one already running', () => {
  assert.deepEqual(O.decide(manifest(), ctx()), { action: 'download', reason: 'new-version', version: '1.1.0-ota.202611120000' });
  assert.equal(O.decide(manifest(), ctx({ currentVersion: '1.1.0-ota.202611120000' })).reason, 'up-to-date');
});

test('decide: native compatibility guard', () => {
  assert.equal(O.decide(manifest({ minNativeVersion: '1.2.0' }), ctx()).reason, 'native-too-old');
  assert.equal(O.decide(manifest({ maxNativeVersion: '1.0.9' }), ctx()).reason, 'native-too-new');
  assert.equal(O.decide(manifest({ minNativeVersion: '1.1.0' }), ctx({ nativeVersion: '1.1.1' })).action, 'download');
});

test('decide: rollback is just publishing an older version (equality, not "newer")', () => {
  const older = manifest({ version: '1.1.0-ota.202611110000' });
  const d = O.decide(older, ctx({ currentVersion: '1.1.0-ota.202611120000' }));
  assert.equal(d.action, 'download');
  assert.equal(d.version, '1.1.0-ota.202611110000');
});

test('decide: a bundle that failed to boot is never retried', () => {
  assert.equal(O.decide(manifest(), ctx({ failed: ['1.1.0-ota.202611120000'] })).reason, 'target-unusable');
});

test('decide: revoked running bundle falls back to builtin, or to the manifest version when usable', () => {
  const bad = '1.1.0-ota.bad';
  const revokedTarget = manifest({ version: bad, revoked: [bad] });
  assert.deepEqual(O.decide(revokedTarget, ctx({ currentVersion: bad })), { action: 'reset', reason: 'current-revoked' });
  const good = manifest({ revoked: [bad] });
  assert.equal(O.decide(good, ctx({ currentVersion: bad })).reason, 'replace-revoked');
  // Too old for the good bundle but running a revoked one: still leave the revoked one.
  assert.equal(O.decide(manifest({ minNativeVersion: '9.0.0', revoked: [bad] }), ctx({ currentVersion: bad })).action, 'reset');
});

function harness(over) {
  over = over || {};
  const store = {};
  const calls = [];
  const updater = Object.assign({
    notifyAppReady: async () => { calls.push('ready'); return { bundle: { version: 'builtin' } }; },
    getBuiltinVersion: async () => ({ version: '1.1.0' }),
    current: async () => ({ bundle: { id: 'builtin', version: 'builtin' } }),
    download: async (o) => { calls.push('download:' + o.version + ':' + o.checksum); return { id: 'id-' + o.version, version: o.version }; },
    next: async (o) => { calls.push('next:' + o.id); },
    set: async (o) => { calls.push('set:' + o.id); },
    reset: async () => { calls.push('reset'); },
    list: async () => ({ bundles: [{ id: 'builtin' }, { id: 'old-1' }, { id: 'id-1.1.0-ota.202611120000' }] }),
    delete: async (o) => { calls.push('delete:' + o.id); },
    getNextBundle: async () => ({ id: 'id-next' }),
    getFailedUpdate: async () => null,
    addListener: () => {}
  }, over.updater);
  let clock = 1000000;
  const urls = [];
  const ota = O.create({
    updater,
    prefs: { get: async (k) => (k in store ? store[k] : null), set: async (k, v) => { store[k] = v; } },
    fetch: over.fetch || (async (url) => { urls.push(url); return { ok: true, json: async () => manifest() }; }),
    config: { app: 'student', baseUrl: 'https://host.example/ota/', channel: 'prod' },
    now: () => clock
  });
  return { ota, store, calls, urls, tick: (ms) => { clock += ms; } };
}

test('check: downloads with sha256, queues via next() (not set), prunes old bundles', async () => {
  const h = harness();
  const r = await h.ota.check(true);
  assert.equal(r.action, 'download');
  assert.deepEqual(h.urls, ['https://host.example/ota/student/prod.json']);
  assert.ok(h.calls.includes('download:1.1.0-ota.202611120000:' + SHA));
  assert.ok(h.calls.includes('next:id-1.1.0-ota.202611120000'));
  assert.ok(!h.calls.some((c) => c.startsWith('set:')), 'never interrupts the running session');
  assert.ok(h.calls.includes('delete:old-1'));
  assert.ok(!h.calls.includes('delete:builtin'));
  assert.equal(h.ota.getState().status, 'ready');
});

test('check: throttled between launches, but force overrides', async () => {
  const h = harness();
  await h.ota.check(true);
  assert.equal((await h.ota.check(false)).reason, 'throttled');
  h.tick(31 * 60 * 1000);
  assert.notEqual((await h.ota.check(false)).reason, 'throttled');
});

test('check: network failure never breaks the app', async () => {
  const h = harness({ fetch: async () => { throw new Error('offline'); } });
  const r = await h.ota.check(true);
  assert.equal(r.reason, 'error');
  assert.equal(h.ota.getState().status, 'idle');
  assert.ok(!h.calls.some((c) => c.startsWith('download') || c === 'reset'));
});

test('check: a manifest with a bad checksum is ignored', async () => {
  const h = harness({ fetch: async () => ({ ok: true, json: async () => manifest({ sha256: 'x' }) }) });
  const r = await h.ota.check(true);
  assert.equal(r.action, 'none');
  assert.ok(r.reason.startsWith('invalid-manifest'));
  assert.ok(!h.calls.some((c) => c.startsWith('download')));
});

test('check: revoked running bundle resets to the built-in one', async () => {
  const bad = '1.1.0-ota.bad';
  const h = harness({
    updater: { current: async () => ({ bundle: { id: 'x', version: bad } }) },
    fetch: async () => ({ ok: true, json: async () => manifest({ version: bad, revoked: [bad] }) })
  });
  assert.equal((await h.ota.check(true)).action, 'reset');
  assert.ok(h.calls.includes('reset'));
});

test('channel: defaults to config, a saved valid channel wins, junk is ignored', async () => {
  const h = harness();
  assert.equal(await h.ota.getChannel(), 'prod');
  await h.ota.setChannel('beta');
  assert.equal(await h.ota.getChannel(), 'beta');
  await assert.rejects(() => h.ota.setChannel('../x'));
  h.store[O.KEYS.channel] = 'BAD CHANNEL';
  assert.equal(await h.ota.getChannel(), 'prod');
  await h.ota.setChannel('beta');
  await h.ota.check(true);
  assert.match(h.urls[0], /student\/beta\.json$/);
});

test('start: confirms the bundle immediately, before any network', async () => {
  const h = harness();
  h.ota.start({ delayMs: 60 * 60 * 1000 });
  await new Promise((r) => setImmediate(r));
  assert.equal(h.calls[0], 'ready');
  assert.deepEqual(h.urls, []);
});

test('without the native plugin everything is a harmless no-op', async () => {
  const ota = O.create({ updater: null, prefs: { get: async () => null, set: async () => {} }, fetch: null, config: { app: 'student', baseUrl: 'x', channel: 'prod' } });
  assert.equal(await ota.markReady(), null);
  assert.equal((await ota.check(true)).reason, 'not-configured');
});

// ---- release scripts ----

test('lib: manifest + version helpers', () => {
  assert.match(L.makeVersion('student', 'prod', new Date(Date.UTC(2026, 10, 12, 8, 5))), /^1\.1\.0-ota\.202611120805$/);
  assert.match(L.makeVersion('staff', 'beta', new Date(Date.UTC(2026, 10, 12, 8, 5))), /^1\.0\.0-beta\.202611120805$/);
  const m = L.buildManifest({ app: 'staff', channel: 'beta', version: 'v', url: 'https://x/y.zip', sha256: SHA, minNativeVersion: '1.0.0' });
  assert.equal(O.validateManifest(Object.assign({}, m, { version: '1.0.0-beta.1' }), 'staff', 'beta'), null);
  assert.equal(L.releaseTag('staff', '1.0.0-ota.1'), 'ota-staff-1.0.0-ota.1');
  assert.throws(() => L.pickApps('tv'));
  assert.throws(() => L.requireChannel('nightly'));
});

test('publish: assembles a hosting folder with new manifests only (offline)', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-site-'));
  const m = manifest();
  const r = await assemble({ site, manifests: [m], noFetch: true });
  assert.deepEqual(r.published, ['student/prod']);
  assert.ok(fs.existsSync(path.join(site, 'index.html')));
  const written = JSON.parse(fs.readFileSync(path.join(site, 'ota', 'student', 'prod.json'), 'utf8'));
  assert.equal(written.version, m.version);
  assert.equal(O.validateManifest(written, 'student', 'prod'), null);
});

test('publish: carries over manifests that are not being republished', async () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-site-'));
  const real = global.fetch;
  global.fetch = async (url) => {
    if (/staff\/prod\.json$/.test(url)) return { ok: true, json: async () => manifest({ app: 'staff', version: '1.0.0-ota.1' }) };
    return { ok: false };
  };
  try {
    const r = await assemble({ site, manifests: [manifest()], siteUrl: 'https://host.example' });
    assert.deepEqual(r.carried, ['staff/prod']);
    assert.ok(fs.existsSync(path.join(site, 'ota', 'staff', 'prod.json')));
  } finally { global.fetch = real; }
});

test('publish: rollback reuses an older release manifest on the requested channel', async () => {
  const real = global.fetch;
  global.fetch = async (url) => {
    assert.match(url, /releases\/download\/ota-student-1\.1\.0-ota\.old\/student-1\.1\.0-ota\.old\.manifest\.json$/);
    return { ok: true, json: async () => manifest({ version: '1.1.0-ota.old' }) };
  };
  try {
    const m = await rollbackManifest('student', 'prod', '1.1.0-ota.old', 'Devil1716/order-board');
    assert.equal(m.version, '1.1.0-ota.old');
    assert.equal(m.channel, 'prod');
  } finally { global.fetch = real; }
});
