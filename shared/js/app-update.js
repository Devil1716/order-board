/**
 * Android app-update prompt for the Cue Capacitor apps (student + staff).
 *
 * Reads Firebase Remote Config (REST fetch, no SDK) and compares the installed APK version
 * (@capacitor/app App.getInfo().version = versionName) with:
 *   min_version_<app>_android     below it -> blocking "Update required" screen (force)
 *   latest_version_<app>_android  below it -> dismissible "Update available" sheet (soft; "Later" = 24 h)
 *   update_url_android            Play Store link or APK download URL for the Update button
 *   update_message                text on the force screen
 * Empty values switch a prompt off. On Google Play installs the Update button uses Play in-app updates
 * (@capawesome/capacitor-app-update) when Play reports an update; otherwise it opens update_url_android.
 *
 * Never blocks start-up and never throws: a failed fetch falls back to the last good config (or nothing).
 * The decision logic is pure and unit-tested (tests/app-update.test.js).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBAppUpdate = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var KEY_LATER = 'ob-update-later';
  var KEY_CACHE = 'ob-update-rc';
  var KEY_IID = 'ob-update-iid';
  var SNOOZE_MS = 24 * 60 * 60 * 1000;
  var RECHECK_GAP_MS = 15 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 6000;
  var PLAY_TIMEOUT_MS = 4000;
  var PLAY_UPDATE_AVAILABLE = 2;
  var SOFT_TEXT = 'A newer Cue is ready. It takes a minute.';
  var FORCE_TEXT = 'This version of Cue no longer works with the counter. Update to keep going.';

  /** "1.2.0" style version (up to 4 numeric parts, optional -/+ suffix) or '' when unusable. */
  function cleanVersion(v) {
    var s = String(v == null ? '' : v).trim();
    return /^\d{1,6}(\.\d{1,6}){0,3}([-+][0-9A-Za-z.+-]*)?$/.test(s) ? s : '';
  }

  /** Dotted-number compare ("1.10.0" > "1.9.2"); ignores "-pre"/"+build" suffixes. -1 | 0 | 1. */
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

  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    return /^(https:\/\/|market:\/\/)[^\s"'<>]{3,2000}$/.test(s) ? s : '';
  }

  /** Remote Config entries (all strings) -> the settings for one app. Unknown/garbage values read as off. */
  function readConfig(entries, app) {
    var e = entries && typeof entries === 'object' ? entries : {};
    var msg = String(e.update_message == null ? '' : e.update_message).trim().slice(0, 240);
    return {
      min: cleanVersion(e['min_version_' + app + '_android']),
      latest: cleanVersion(e['latest_version_' + app + '_android']),
      url: safeUrl(e.update_url_android),
      message: msg
    };
  }

  /**
   * Pure decision. cfg from readConfig; ctx = { installed, now, later: {version, until} | null, canUpdate }.
   * -> { kind: 'force' | 'soft' | 'none', reason, target? }
   */
  function decide(cfg, ctx) {
    cfg = cfg || {};
    ctx = ctx || {};
    var installed = cleanVersion(ctx.installed);
    if (!installed) return { kind: 'none', reason: 'unknown-version' };
    var needForce = !!cfg.min && compareVersions(installed, cfg.min) < 0;
    var needSoft = !!cfg.latest && compareVersions(installed, cfg.latest) < 0;
    if (!needForce && !needSoft) return { kind: 'none', reason: 'up-to-date' };
    // Never trap anyone on a screen with no way forward.
    if (!ctx.canUpdate) return { kind: 'none', reason: 'no-update-path' };
    if (needForce) {
      var target = cfg.latest && compareVersions(cfg.latest, cfg.min) > 0 ? cfg.latest : cfg.min;
      return { kind: 'force', reason: 'below-min', target: target };
    }
    var later = ctx.later;
    var now = ctx.now == null ? Date.now() : ctx.now;
    if (later && later.version === cfg.latest && typeof later.until === 'number' && now < later.until) {
      return { kind: 'none', reason: 'snoozed' };
    }
    return { kind: 'soft', reason: 'below-latest', target: cfg.latest };
  }

  function withTimeout(p, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      if (t && t.unref) t.unref();
      Promise.resolve(p).then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  /**
   * deps: { app, prefs:{get,set}, getInstalled():Promise<string>, fetchConfig():Promise<entries>,
   *         play: AppUpdate plugin | null, openUrl(url), ui:{show(view), hide()}, now, log }
   */
  function create(deps) {
    var prefs = deps.prefs;
    var now = deps.now || Date.now;
    var log = deps.log || function () {};
    var ui = deps.ui || { show: function () {}, hide: function () {} };
    var current = null;       // { decision, cfg, installed, play }
    var lastCheck = 0;
    var checking = null;

    async function getJson(key) {
      try { var raw = await prefs.get(key); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
    }

    async function loadEntries() {
      try {
        var entries = await withTimeout(deps.fetchConfig(), FETCH_TIMEOUT_MS);
        if (entries && typeof entries === 'object') {
          try { await prefs.set(KEY_CACHE, JSON.stringify({ at: now(), entries: entries })); } catch (e) {}
          return entries;
        }
      } catch (e) { log('remote config fetch failed', e && e.message); }
      var cached = await getJson(KEY_CACHE);
      return cached && cached.entries ? cached.entries : null;
    }

    async function playInfo() {
      if (!deps.play || !deps.play.getAppUpdateInfo) return null;
      try {
        var info = await withTimeout(deps.play.getAppUpdateInfo(), PLAY_TIMEOUT_MS);
        return info && info.updateAvailability === PLAY_UPDATE_AVAILABLE ? info : null;
      } catch (e) { return null; }   // not installed from Play, no Play services, offline...
    }

    async function doCheck() {
      lastCheck = now();
      var entries = await loadEntries();
      if (!entries) return { kind: 'none', reason: 'no-config' };
      var cfg = readConfig(entries, deps.app);
      if (!cfg.min && !cfg.latest) { hide(); return { kind: 'none', reason: 'off' }; }
      var installed = '';
      try { installed = await deps.getInstalled(); } catch (e) {}
      var play = await playInfo();
      var d = decide(cfg, { installed: installed, now: now(), later: await getJson(KEY_LATER), canUpdate: !!(cfg.url || play) });
      log('update decision', d);
      if (d.kind === 'none') { hide(); return d; }
      current = { decision: d, cfg: cfg, installed: cleanVersion(installed), play: play };
      ui.show({
        kind: d.kind,
        title: d.kind === 'force' ? 'Update required' : 'Update available',
        text: d.kind === 'force' ? (cfg.message || FORCE_TEXT) : SOFT_TEXT,
        installed: current.installed,
        target: d.target,
        onUpdate: update,
        onLater: d.kind === 'soft' ? later : null
      });
      return d;
    }

    /** Runs a check now (deduplicated). Never rejects. */
    function check() {
      if (!checking) {
        checking = doCheck().catch(function (e) { log('update check failed', e); return { kind: 'none', reason: 'error' }; })
          .then(function (r) { checking = null; return r; });
      }
      return checking;
    }

    /** Re-check when the app comes back, at most every 15 min (so a new force-update lands within a session). */
    function maybeRecheck() {
      if (now() - lastCheck >= RECHECK_GAP_MS) return check();
      return Promise.resolve(null);
    }

    function hide() {
      if (current) { current = null; try { ui.hide(); } catch (e) {} }
    }

    async function update() {
      var c = current;
      if (!c) return 'none';
      if (c.play && c.play.immediateUpdateAllowed && deps.play && deps.play.performImmediateUpdate) {
        try {
          var r = await deps.play.performImmediateUpdate();
          // OK (0) = Play is installing; CANCELED (1) = the user backed out of Play's own screen: respect it.
          if (!r || r.code === 0 || r.code === 1) return 'play';
        } catch (e) { log('play update failed', e); }
      }
      if (c.cfg.url) { try { deps.openUrl(c.cfg.url); return 'url'; } catch (e) {} }
      if (deps.play && deps.play.openAppStore) {
        try { await deps.play.openAppStore(); return 'store'; } catch (e) {}
      }
      return 'none';
    }

    async function later() {
      var c = current;
      if (!c || c.decision.kind !== 'soft') return false;
      try { await prefs.set(KEY_LATER, JSON.stringify({ version: c.decision.target, until: now() + SNOOZE_MS })); } catch (e) {}
      hide();
      return true;
    }

    /** Android back button: closes the soft sheet (no snooze). A force screen is not dismissible. */
    function handleBack() {
      if (current && current.decision.kind === 'soft') { hide(); return true; }
      return false;
    }

    return {
      check: check, maybeRecheck: maybeRecheck, update: update, later: later, handleBack: handleBack,
      getCurrent: function () { return current; }
    };
  }

  /* ---------- browser / Capacitor wiring ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** DOM view: full-screen gate (force) or bottom sheet (soft), built from the app's design tokens. */
  function createView(doc) {
    var root = null, prevFocus = null;

    function hide() {
      if (!root) return;
      root.remove();
      root = null;
      doc.body.classList.remove('upd-open');
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
    }

    function show(v) {
      hide();
      prevFocus = doc.activeElement;
      var force = v.kind === 'force';
      root = el('div', 'upd ' + (force ? 'upd-force' : 'upd-soft'));
      root.setAttribute('role', force ? 'alertdialog' : 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-labelledby', 'updTitle');
      root.setAttribute('aria-describedby', 'updText');

      var card = el('div', 'upd-card');
      var body = el('div', 'upd-body');
      var logo = el('img', 'upd-logo');
      logo.src = 'img/logo.png';
      logo.alt = '';
      logo.width = force ? 72 : 48;
      logo.height = force ? 72 : 48;
      var title = el('h2', 'upd-title', v.title);
      title.id = 'updTitle';
      var text = el('p', 'upd-text', v.text);
      text.id = 'updText';
      body.appendChild(logo);
      body.appendChild(title);
      body.appendChild(text);
      if (v.installed && v.target) body.appendChild(el('p', 'upd-ver', 'Version ' + v.installed + ' → ' + v.target));

      var actions = el('div', 'upd-actions');
      var go = el('button', 'btn red big', 'Update');
      go.type = 'button';
      go.onclick = function () {
        go.disabled = true;
        Promise.resolve(v.onUpdate()).then(function () { go.disabled = false; }, function () { go.disabled = false; });
      };
      actions.appendChild(go);
      if (v.onLater) {
        var later = el('button', 'btn ghost', 'Later');
        later.type = 'button';
        later.onclick = function () { v.onLater(); };
        actions.appendChild(later);
      }
      card.appendChild(body);
      card.appendChild(actions);
      root.appendChild(card);
      doc.body.appendChild(root);
      doc.body.classList.add('upd-open');
      root.tabIndex = -1;   // focus the dialog itself (screen readers announce it; no ring on the button)
      try { root.focus({ preventScroll: true }); } catch (e) {}
    }

    return { show: show, hide: hide };
  }

  function remoteConfigFetcher(root) {
    var fb = root.ORDER_BOARD_FIREBASE;
    if (!fb || !fb.apiKey || !fb.appId || !fb.messagingSenderId || !root.fetch) return null;
    var N = root.OBNative;
    async function instanceId() {
      var id = null;
      try { id = N ? await N.prefsGet(KEY_IID) : null; } catch (e) {}
      if (!/^[A-Za-z0-9_-]{16,40}$/.test(id || '')) {
        var a = '';
        var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
        for (var i = 0; i < 22; i++) a += chars.charAt(Math.floor(Math.random() * chars.length));
        id = a;
        try { if (N) await N.prefsSet(KEY_IID, id); } catch (e) {}
      }
      return id;
    }
    return async function () {
      var url = 'https://firebaseremoteconfig.googleapis.com/v1/projects/' + encodeURIComponent(fb.messagingSenderId) +
        '/namespaces/firebase:fetch?key=' + encodeURIComponent(fb.apiKey);
      var res = await root.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: fb.appId, appInstanceId: await instanceId(), sdkVersion: '10.14.1' }),
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('remote config HTTP ' + res.status);
      var json = await res.json();
      return (json && json.entries) || {};   // NO_TEMPLATE / EMPTY_CONFIG -> {} (everything off)
    };
  }

  /** Opens a URL outside the app (Capacitor hands non-app links to the browser / Play Store). */
  function openExternal(doc, url) {
    var a = doc.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    doc.body.appendChild(a);
    a.click();
    a.remove();
  }

  /**
   * Wires everything for the running app ('student' | 'staff'). Only active inside the native Android app;
   * elsewhere returns an inert controller. Call start() once the UI is up.
   */
  function init(root, app) {
    var C = root.Capacitor;
    var N = root.OBNative;
    var android = !!(C && C.isNativePlatform && C.isNativePlatform() && C.getPlatform && C.getPlatform() === 'android');
    var fetchConfig = remoteConfigFetcher(root);
    var plugin = function (name) {
      if (!C) return null;
      if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
      try { return C.registerPlugin ? C.registerPlugin(name) : null; } catch (e) { return null; }
    };
    var ctl = create({
      app: app,
      prefs: { get: N ? N.prefsGet : async function () { return null; }, set: N ? N.prefsSet : async function () {} },
      getInstalled: async function () {
        var A = plugin('App');
        var info = A && A.getInfo ? await A.getInfo() : null;
        return info && info.version;
      },
      fetchConfig: fetchConfig || function () { return Promise.resolve(null); },
      play: android ? plugin('AppUpdate') : null,
      openUrl: function (url) { openExternal(root.document, url); },
      ui: createView(root.document),
      log: function () { try { console.log.apply(console, ['[update]'].concat([].slice.call(arguments))); } catch (e) {} }
    });
    var api = {
      start: function (opts) {
        opts = opts || {};
        if (!android || !fetchConfig) return api;
        var delay = opts.delayMs == null ? 1500 : opts.delayMs;
        setTimeout(function () { ctl.check(); }, delay);
        root.document.addEventListener('visibilitychange', function () {
          if (!root.document.hidden) ctl.maybeRecheck();
        });
        return api;
      },
      check: ctl.check,
      handleBack: ctl.handleBack,
      /** Renders a prompt without any checks (design previews / screenshots). */
      preview: function (kind) {
        var force = kind === 'force';
        createView(root.document).show({
          kind: force ? 'force' : 'soft',
          title: force ? 'Update required' : 'Update available',
          text: force ? FORCE_TEXT : SOFT_TEXT,
          installed: '1.1.0', target: '1.2.0',
          onUpdate: function () {}, onLater: force ? null : function () {}
        });
      }
    };
    return api;
  }

  return {
    cleanVersion: cleanVersion, compareVersions: compareVersions, readConfig: readConfig, decide: decide,
    create: create, init: init, KEYS: { later: KEY_LATER, cache: KEY_CACHE, iid: KEY_IID }, SNOOZE_MS: SNOOZE_MS
  };
});
