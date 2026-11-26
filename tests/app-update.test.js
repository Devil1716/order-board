const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../shared/js/app-update.js');
const O = require('../shared/js/ota.js');

const DAY = 24 * 60 * 60 * 1000;
const cfg = (over) => Object.assign({ min: '', latest: '', url: 'https://example.com/cue.apk', message: '' }, over);
const ctx = (over) => Object.assign({ installed: '1.2.0', now: 1000, later: null, canUpdate: true }, over);

test('compareVersions: numeric parts, missing parts are zero, suffixes ignored', () => {
  assert.equal(U.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(U.compareVersions('1.2', '1.2.0'), 0);
  assert.equal(U.compareVersions('1.2.0-beta.1', '1.2.0'), 0);
  assert.equal(U.compareVersions('1.1.9', '1.2.0'), -1);
  assert.equal(U.compareVersions('2', '1.99.99'), 1);
});

test('cleanVersion accepts real versions only', () => {
  assert.equal(U.cleanVersion(' 1.2.0 '), '1.2.0');
  assert.equal(U.cleanVersion('1.2.0+7'), '1.2.0+7');
  assert.equal(U.cleanVersion(''), '');
  assert.equal(U.cleanVersion('latest'), '');
  assert.equal(U.cleanVersion('1..2'), '');
  assert.equal(U.cleanVersion(null), '');
});

test('readConfig picks the app keys and drops unsafe links', () => {
  const entries = {
    min_version_student_android: '1.2.0', latest_version_student_android: '1.3.0',
    min_version_staff_android: '9.9.9', update_url_android: 'https://play.google.com/store/apps/details?id=in.quicko.cue',
    update_message: 'Please update.'
  };
  assert.deepEqual(U.readConfig(entries, 'student'), {
    min: '1.2.0', latest: '1.3.0', url: 'https://play.google.com/store/apps/details?id=in.quicko.cue', message: 'Please update.'
  });
  assert.equal(U.readConfig(entries, 'staff').min, '9.9.9');
  assert.equal(U.readConfig(entries, 'staff').latest, '');
  assert.equal(U.readConfig({ update_url_android: 'http://insecure/cue.apk' }, 'student').url, '');
  assert.equal(U.readConfig({ update_url_android: 'javascript:alert(1)' }, 'student').url, '');
  assert.equal(U.readConfig({ update_url_android: 'market://details?id=in.quicko.cue' }, 'student').url, 'market://details?id=in.quicko.cue');
  assert.deepEqual(U.readConfig(null, 'student'), { min: '', latest: '', url: '', message: '' });
});

test('decide: empty keys mean off', () => {
  assert.deepEqual(U.decide(cfg(), ctx()), { kind: 'none', reason: 'up-to-date' });
});

test('decide: below min forces, at or above min does not', () => {
  assert.equal(U.decide(cfg({ min: '1.3.0' }), ctx()).kind, 'force');
  assert.equal(U.decide(cfg({ min: '1.2.0' }), ctx()).kind, 'none');
  assert.equal(U.decide(cfg({ min: '1.1.0' }), ctx()).kind, 'none');
});

test('decide: force targets the newest of min and latest', () => {
  assert.equal(U.decide(cfg({ min: '1.3.0', latest: '1.4.0' }), ctx()).target, '1.4.0');
  assert.equal(U.decide(cfg({ min: '1.3.0', latest: '1.2.5' }), ctx()).target, '1.3.0');
});

test('decide: force ignores "Later"', () => {
  const later = { version: '1.3.0', until: 1000 + DAY };
  assert.equal(U.decide(cfg({ min: '1.3.0', latest: '1.3.0' }), ctx({ later })).kind, 'force');
});

test('decide: below latest is a soft prompt, snoozed for 24 h for that version only', () => {
  const c = cfg({ latest: '1.3.0' });
  assert.deepEqual(U.decide(c, ctx()), { kind: 'soft', reason: 'below-latest', target: '1.3.0' });
  const later = { version: '1.3.0', until: 1000 + DAY };
  assert.equal(U.decide(c, ctx({ later })).reason, 'snoozed');
  assert.equal(U.decide(c, ctx({ later, now: 1000 + DAY })).kind, 'soft');            // snooze over
  assert.equal(U.decide(cfg({ latest: '1.4.0' }), ctx({ later })).kind, 'soft');      // a newer release asks again
});

test('decide: never prompts without a way to update or a known installed version', () => {
  assert.equal(U.decide(cfg({ min: '9.0.0' }), ctx({ canUpdate: false })).reason, 'no-update-path');
  assert.equal(U.decide(cfg({ min: '9.0.0' }), ctx({ installed: '' })).reason, 'unknown-version');
  assert.equal(U.decide(cfg({ min: '9.0.0' }), ctx({ installed: undefined })).reason, 'unknown-version');
});

function memPrefs(init) {
  const m = Object.assign({}, init);
  return { m, get: async (k) => (k in m ? m[k] : null), set: async (k, v) => { m[k] = v; } };
}
function harness(over) {
  const shown = [];
  let hidden = 0;
  const opened = [];
  const deps = Object.assign({
    app: 'student',
    prefs: memPrefs(),
    getInstalled: async () => '1.2.0',
    fetchConfig: async () => ({}),
    play: null,
    openUrl: (u) => opened.push(u),
    ui: { show: (v) => shown.push(v), hide: () => { hidden++; } },
    now: () => 5000
  }, over);
  const ctl = U.create(deps);
  return { ctl, shown, opened, deps, hidden: () => hidden };
}

test('check: shows the force screen from Remote Config and opens the update link', async () => {
  const h = harness({ fetchConfig: async () => ({ min_version_student_android: '1.3.0', update_url_android: 'https://x.example/cue.apk', update_message: 'Needed for the counter.' }) });
  const d = await h.ctl.check();
  assert.equal(d.kind, 'force');
  assert.equal(h.shown.length, 1);
  assert.equal(h.shown[0].title, 'Update required');
  assert.equal(h.shown[0].text, 'Needed for the counter.');
  assert.equal(h.shown[0].onLater, null);            // nothing to dismiss
  assert.equal(h.ctl.handleBack(), false);            // back can't close it
  assert.equal(await h.shown[0].onUpdate(), 'url');
  assert.deepEqual(h.opened, ['https://x.example/cue.apk']);
});

test('check: soft sheet, Later snoozes 24 h and is remembered across launches', async () => {
  const prefs = memPrefs();
  const fetchConfig = async () => ({ latest_version_student_android: '1.3.0', update_url_android: 'https://x.example/cue.apk' });
  const h = harness({ prefs, fetchConfig });
  assert.equal((await h.ctl.check()).kind, 'soft');
  assert.ok(await h.shown[0].onLater());
  assert.deepEqual(JSON.parse(prefs.m[U.KEYS.later]), { version: '1.3.0', until: 5000 + DAY });
  const again = harness({ prefs, fetchConfig });
  assert.equal((await again.ctl.check()).reason, 'snoozed');
  assert.equal(again.shown.length, 0);
});

test('check: back button closes the soft sheet without snoozing', async () => {
  const prefs = memPrefs();
  const h = harness({ prefs, fetchConfig: async () => ({ latest_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' }) });
  await h.ctl.check();
  assert.equal(h.ctl.handleBack(), true);
  assert.equal(h.hidden(), 1);
  assert.equal(prefs.m[U.KEYS.later], undefined);
});

test('check: offline falls back to the last good config, and to nothing on first run', async () => {
  const prefs = memPrefs();
  const ok = harness({ prefs, fetchConfig: async () => ({ min_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' }) });
  await ok.ctl.check();
  const offline = harness({ prefs, fetchConfig: async () => { throw new Error('offline'); } });
  assert.equal((await offline.ctl.check()).kind, 'force');
  const fresh = harness({ fetchConfig: async () => { throw new Error('offline'); } });
  assert.deepEqual(await fresh.ctl.check(), { kind: 'none', reason: 'no-config' });
  assert.equal(fresh.shown.length, 0);
});

test('check: never throws, even when every dependency fails', async () => {
  const h = harness({
    prefs: { get: async () => { throw new Error('x'); }, set: async () => { throw new Error('x'); } },
    getInstalled: async () => { throw new Error('no plugin'); },
    fetchConfig: async () => ({ min_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' })
  });
  assert.equal((await h.ctl.check()).reason, 'unknown-version');
});

test('check: clearing the key in Remote Config removes a showing prompt', async () => {
  let entries = { min_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' };
  const h = harness({ fetchConfig: async () => entries });
  await h.ctl.check();
  entries = {};
  assert.equal((await h.ctl.check()).reason, 'off');
  assert.equal(h.hidden(), 1);
});

test('update: Play in-app update when Play has it; a cancel in Play does not fall through to the link', async () => {
  const calls = [];
  const play = {
    getAppUpdateInfo: async () => ({ updateAvailability: 2, immediateUpdateAllowed: true }),
    performImmediateUpdate: async () => { calls.push('immediate'); return { code: 1 }; }
  };
  const h = harness({ play, fetchConfig: async () => ({ min_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' }) });
  await h.ctl.check();
  assert.equal(await h.shown[0].onUpdate(), 'play');
  assert.deepEqual(calls, ['immediate']);
  assert.deepEqual(h.opened, []);
});

test('update: Play alone is enough of an update path; Play failure falls back to the link', async () => {
  const play = {
    getAppUpdateInfo: async () => ({ updateAvailability: 2, immediateUpdateAllowed: true }),
    performImmediateUpdate: async () => ({ code: 2 })
  };
  const noUrl = harness({ play, fetchConfig: async () => ({ latest_version_student_android: '1.3.0' }) });
  assert.equal((await noUrl.ctl.check()).kind, 'soft');
  const withUrl = harness({ play, fetchConfig: async () => ({ latest_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' }) });
  await withUrl.ctl.check();
  assert.equal(await withUrl.shown[0].onUpdate(), 'url');
});

test('update: a sideloaded APK (Play throws) uses the link', async () => {
  const play = { getAppUpdateInfo: async () => { throw new Error('ERROR_APP_NOT_OWNED'); } };
  const h = harness({ play, fetchConfig: async () => ({ min_version_student_android: '1.3.0', update_url_android: 'https://x.example/a.apk' }) });
  await h.ctl.check();
  assert.equal(await h.shown[0].onUpdate(), 'url');
});

test('remoteconfig.template.json declares every Android update key, all off by default', () => {
  const t = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'remoteconfig.template.json'), 'utf8'));
  for (const k of ['min_version_student_android', 'min_version_staff_android', 'latest_version_student_android',
    'latest_version_staff_android', 'update_url_android', 'update_message']) {
    assert.ok(t.parameters[k], k + ' missing');
    assert.equal(t.parameters[k].valueType, 'STRING');
  }
  for (const k of ['min_version_student_android', 'min_version_staff_android', 'latest_version_student_android',
    'latest_version_staff_android', 'update_url_android']) {
    assert.equal(t.parameters[k].defaultValue.value, '', k + ' must default to off');
  }
  // Remote Config rejects the whole publish if any description is over 256 characters.
  for (const [k, v] of Object.entries(t.parameters)) assert.ok((v.description || '').length <= 256, k + ' description too long');
});

test('both apps load app-update.js and both APK versions are a valid, matching 1.3.0', () => {
  for (const app of ['student', 'staff']) {
    const root = path.join(__dirname, '..', 'apps', app);
    assert.match(fs.readFileSync(path.join(root, 'www', 'index.html'), 'utf8'), /js\/app-update\.js/);
    const gradle = fs.readFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'utf8');
    assert.equal(U.cleanVersion(gradle.match(/versionName\s*=?\s*"([^"]+)"/)[1]), '1.3.0');
    assert.match(fs.readFileSync(path.join(root, 'www', 'js', 'app.js'), 'utf8'), /APP_VERSION = '1\.3\.0'/);
  }
});

/* OTA hold: a queued web bundle waits while a student tracks an order. */
function fakeUpdater() {
  const calls = [];
  return {
    calls,
    setMultiDelay: async (o) => { calls.push(['delay', o.delayConditions[0].kind]); },
    cancelDelay: async () => { calls.push(['cancel']); }
  };
}

test('ota.setHold: holds with a kill delay, releases with cancelDelay, and only calls on change', async () => {
  const up = fakeUpdater();
  const ota = O.create({ updater: up, prefs: memPrefs(), config: {} });
  await ota.setHold(true);
  await ota.setHold(true);
  await ota.setHold(false);
  await ota.setHold(false);
  assert.deepEqual(up.calls, [['delay', 'kill'], ['cancel']]);
});

test('ota.setHold: never throws, and is a no-op outside the native app', async () => {
  const ota = O.create({ updater: { setMultiDelay: async () => { throw new Error('x'); }, cancelDelay: async () => { throw new Error('x'); } }, prefs: memPrefs(), config: {} });
  await ota.setHold(true);
  await ota.setHold(false);
  await O.create({ updater: null, prefs: memPrefs(), config: {} }).setHold(true);
});
