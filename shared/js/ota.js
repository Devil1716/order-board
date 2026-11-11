/**
 * Over-the-air web-bundle updates for the Capacitor Android apps (self-hosted @capgo/capacitor-updater,
 * manual mode: no third-party update server).
 *
 * Flow: boot -> markReady() (tells the plugin this bundle started; if this never runs the plugin rolls back
 * to the previous bundle after appReadyTimeout) -> a few seconds later check() fetches the channel manifest
 * from Firebase Hosting, decides with decide(), downloads the zip (hosted on GitHub Releases) verified by
 * sha256, and queues it with next() so it takes over when the app is backgrounded/restarted - never
 * mid-order.
 *
 * Manifest (ota/<app>/<channel>.json):
 *   { schema:1, app, channel, version, url (https zip), sha256, minNativeVersion, maxNativeVersion?,
 *     revoked:[versions to leave], released, notes? }
 * Versions are compared by EQUALITY, not "newer than", so publishing an older version is a rollback.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBOta = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var KEY_CHANNEL = 'ob-ota-channel';
  var KEY_FAILED = 'ob-ota-failed';
  var KEY_LAST_CHECK = 'ob-ota-last-check';
  var MIN_CHECK_GAP_MS = 30 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 8000;
  var MAX_FAILED = 10;

  /** Dotted-number compare ("1.10.0" > "1.9.2"); ignores any "-prerelease"/"+build" suffix. -1 | 0 | 1. */
  function compareVersions(a, b) {
    function parts(v) {
      return String(v == null ? '' : v).split(/[-+]/)[0].split('.').map(function (x) {
        var n = parseInt(x, 10);
        return isNaN(n) ? 0 : n;
      });
    }
    var x = parts(a), y = parts(b), len = Math.max(x.length, y.length);
    for (var i = 0; i < len; i++) {
      var l = x[i] || 0, r = y[i] || 0;
      if (l !== r) return l < r ? -1 : 1;
    }
    return 0;
  }

  /** Returns null when the manifest is usable for (app, channel), otherwise a short reason. */
  function validateManifest(m, app, channel) {
    if (!m || typeof m !== 'object') return 'not-an-object';
    if (m.schema !== 1) return 'unknown-schema';
    if (m.app !== app) return 'wrong-app';
    if (m.channel !== channel) return 'wrong-channel';
    if (typeof m.version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(m.version)) return 'bad-version';
    if (typeof m.url !== 'string' || !/^https:\/\//.test(m.url)) return 'bad-url';
    if (typeof m.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(m.sha256)) return 'bad-checksum';
    if (typeof m.minNativeVersion !== 'string') return 'bad-min-native';
    if (m.revoked != null && !Array.isArray(m.revoked)) return 'bad-revoked';
    return null;
  }

  /**
   * Pure decision. ctx = { app, channel, nativeVersion, currentVersion ('builtin' when none), failed: [versions] }
   * -> { action: 'none' | 'download' | 'reset', reason, version? }
   */
  function decide(manifest, ctx) {
    var bad = validateManifest(manifest, ctx.app, ctx.channel);
    if (bad) return { action: 'none', reason: 'invalid-manifest:' + bad };
    var revoked = manifest.revoked || [];
    var current = ctx.currentVersion || 'builtin';
    var onRevoked = current !== 'builtin' && revoked.indexOf(current) !== -1;

    // Compatibility guard: never install a bundle that needs a newer (or only an older) native shell.
    var tooOld = compareVersions(ctx.nativeVersion, manifest.minNativeVersion) < 0;
    var tooNew = manifest.maxNativeVersion && compareVersions(ctx.nativeVersion, manifest.maxNativeVersion) > 0;
    var targetBad = revoked.indexOf(manifest.version) !== -1 || (ctx.failed || []).indexOf(manifest.version) !== -1;

    if (tooOld || tooNew || targetBad) {
      // Can't (or shouldn't) take the target. If what we run is revoked, fall back to the built-in bundle.
      if (onRevoked) return { action: 'reset', reason: 'current-revoked' };
      return { action: 'none', reason: tooOld ? 'native-too-old' : tooNew ? 'native-too-new' : 'target-unusable' };
    }
    if (manifest.version === current) return { action: 'none', reason: 'up-to-date' };
    return { action: 'download', reason: onRevoked ? 'replace-revoked' : 'new-version', version: manifest.version };
  }

  function pickPlugin(root) {
    var C = root.Capacitor;
    if (!C) return null;
    if (C.Plugins && C.Plugins.CapacitorUpdater) return C.Plugins.CapacitorUpdater;
    if (C.registerPlugin) {
      try { return C.registerPlugin('CapacitorUpdater'); } catch (e) { return null; }
    }
    return null;
  }

  /**
   * deps: { updater, prefs:{get,set}, fetch, config:{app, baseUrl, channel}, now, log }
   * Everything is injectable so the logic is unit-tested without a device.
   */
  function create(deps) {
    var updater = deps.updater;
    var prefs = deps.prefs;
    var cfg = deps.config || {};
    var now = deps.now || Date.now;
    var log = deps.log || function () {};
    var fetchFn = deps.fetch;
    var listeners = [];
    var state = { status: 'idle', pending: null, lastError: null };
    var checking = null;

    function emit() { listeners.slice().forEach(function (fn) { try { fn(state); } catch (e) {} }); }
    function setState(patch) { Object.keys(patch).forEach(function (k) { state[k] = patch[k]; }); emit(); }

    async function getJson(key, fallback) {
      try { var raw = await prefs.get(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
    }

    async function getChannel() {
      var saved = null;
      try { saved = await prefs.get(KEY_CHANNEL); } catch (e) {}
      return /^[a-z0-9_-]{1,24}$/.test(saved || '') ? saved : (cfg.channel || 'prod');
    }

    async function setChannel(ch) {
      if (!/^[a-z0-9_-]{1,24}$/.test(ch || '')) throw new Error('bad channel');
      await prefs.set(KEY_CHANNEL, ch);
      return ch;
    }

    async function rememberFailed(version) {
      if (!version) return;
      var list = await getJson(KEY_FAILED, []);
      if (list.indexOf(version) === -1) list.push(version);
      await prefs.set(KEY_FAILED, JSON.stringify(list.slice(-MAX_FAILED)));
    }

    /** Call as early as the app can say "this bundle started". Never throws, never waits on the network. */
    async function markReady() {
      if (!updater) return null;
      try { return await updater.notifyAppReady(); } catch (e) { log('notifyAppReady failed', e); return null; }
    }

    async function nativeVersion() {
      try {
        var b = await updater.getBuiltinVersion();
        if (b && b.version) return b.version;
      } catch (e) {}
      return '0.0.0';
    }

    async function fetchManifest(channel) {
      var url = cfg.baseUrl.replace(/\/+$/, '') + '/' + cfg.app + '/' + channel + '.json';
      var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, FETCH_TIMEOUT_MS) : null;
      try {
        var res = await fetchFn(url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        if (!res.ok) throw new Error('manifest HTTP ' + res.status);
        return await res.json();
      } finally { if (timer) clearTimeout(timer); }
    }

    async function prune(keepIds) {
      try {
        var list = await updater.list();
        var bundles = (list && list.bundles) || [];
        for (var i = 0; i < bundles.length; i++) {
          var b = bundles[i];
          if (b.id === 'builtin' || keepIds.indexOf(b.id) !== -1) continue;
          try { await updater.delete({ id: b.id }); } catch (e) {}
        }
      } catch (e) {}
    }

    async function doCheck(force) {
      if (!updater || !fetchFn || !cfg.baseUrl || !cfg.app) return { action: 'none', reason: 'not-configured' };
      var last = parseInt(await prefs.get(KEY_LAST_CHECK), 10) || 0;
      if (!force && now() - last < MIN_CHECK_GAP_MS) return { action: 'none', reason: 'throttled' };
      setState({ status: 'checking', lastError: null });
      try {
        var channel = await getChannel();
        var manifest = await fetchManifest(channel);
        await prefs.set(KEY_LAST_CHECK, String(now()));
        var cur = await updater.current();
        var ctx = {
          app: cfg.app,
          channel: channel,
          nativeVersion: await nativeVersion(),
          currentVersion: (cur && cur.bundle && cur.bundle.version) || 'builtin',
          failed: await getJson(KEY_FAILED, [])
        };
        var d = decide(manifest, ctx);
        log('ota decision', d);
        if (d.action === 'reset') {
          await updater.reset();            // back to the bundle shipped inside the APK (reloads the app)
          setState({ status: 'idle' });
          return d;
        }
        if (d.action === 'download') {
          setState({ status: 'downloading' });
          var bundle = await updater.download({ url: manifest.url, version: manifest.version, checksum: manifest.sha256 });
          await updater.next({ id: bundle.id });
          var keep = [bundle.id];
          if (cur && cur.bundle) keep.push(cur.bundle.id);
          await prune(keep);
          setState({ status: 'ready', pending: manifest.version });
          return d;
        }
        setState({ status: 'idle' });
        return d;
      } catch (e) {
        setState({ status: 'idle', lastError: String(e && e.message || e) });
        return { action: 'none', reason: 'error', error: state.lastError };
      }
    }

    function check(force) {
      if (!checking) checking = doCheck(!!force).then(function (r) { checking = null; return r; }, function (e) { checking = null; throw e; });
      return checking;
    }

    /** Applies a queued bundle right now (reloads the app). */
    async function applyNow() {
      if (!updater) return;
      var next = await updater.getNextBundle();
      if (next && next.id) await updater.set({ id: next.id });
    }

    /** Boot hook: confirm this bundle, learn about failed updates, check once shortly after launch. */
    function start(opts) {
      opts = opts || {};
      markReady();
      if (updater && updater.addListener) {
        try {
          updater.addListener('updateFailed', function (ev) {
            rememberFailed(ev && ev.bundle && ev.bundle.version);
          });
        } catch (e) {}
      }
      if (updater && updater.getFailedUpdate) {
        updater.getFailedUpdate().then(function (f) { if (f && f.bundle) rememberFailed(f.bundle.version); }, function () {});
      }
      var delay = opts.delayMs == null ? 5000 : opts.delayMs;
      var t = setTimeout(function () { check(false); }, delay);
      if (t && t.unref) t.unref();   // never keep a Node process (tests/tools) alive
      return api;
    }

    var api = {
      start: start, markReady: markReady, check: check, applyNow: applyNow,
      getChannel: getChannel, setChannel: setChannel, getState: function () { return state; },
      onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; }
    };
    return api;
  }

  /** Browser/Capacitor wiring. A no-op shell (never throws) when not running inside the native app. */
  function init(root) {
    var cfg = root.ORDER_BOARD_OTA;
    var C = root.Capacitor;
    var native = !!(C && C.isNativePlatform && C.isNativePlatform());
    var updater = native ? pickPlugin(root) : null;
    var N = root.OBNative;
    return create({
      updater: updater,
      prefs: { get: N ? N.prefsGet : async function () { return null; }, set: N ? N.prefsSet : async function () {} },
      fetch: root.fetch ? root.fetch.bind(root) : null,
      config: cfg,
      log: function () { try { console.log.apply(console, ['[ota]'].concat([].slice.call(arguments))); } catch (e) {} }
    });
  }

  return { compareVersions: compareVersions, validateManifest: validateManifest, decide: decide, create: create, init: init,
           KEYS: { channel: KEY_CHANNEL, failed: KEY_FAILED, lastCheck: KEY_LAST_CHECK } };
});
