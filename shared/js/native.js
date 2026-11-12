/**
 * Thin Capacitor bridge. Falls back to web APIs when not in a native shell.
 */
(function (global) {
  var Cap = global.Capacitor || null;
  var isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

  function plugin(name) {
    var C = global.Capacitor || Cap;
    if (!C || !C.Plugins) return null;
    return C.Plugins[name] || null;
  }

  async function buzz() {
    var H = plugin('Haptics');
    if (H && H.vibrate) {
      try {
        await H.vibrate({ duration: 400 });
        await new Promise(function (r) { setTimeout(r, 150); });
        await H.vibrate({ duration: 400 });
        await new Promise(function (r) { setTimeout(r, 150); });
        await H.vibrate({ duration: 400 });
        return;
      } catch (e) {}
    }
    if (navigator.vibrate) {
      try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }
  }

  async function keepAwake(on) {
    var K = plugin('KeepAwake');
    if (!K) return;
    try {
      if (on && K.keepAwake) await K.keepAwake();
      else if (!on && K.allowSleep) await K.allowSleep();
    } catch (e) {}
  }

  /** Native background watcher (Cue student Android app only). */
  function watcher() { return isNative ? plugin('CueWatch') : null; }

  async function watchCall(method, args) {
    var W = watcher();
    if (!W || !W[method]) return null;
    try { return await W[method](args || {}); } catch (e) { return null; }
  }

  /** Ask for the Android 13+ POST_NOTIFICATIONS permission (no-op where already granted / not needed). */
  async function requestNotifyPermission() {
    var N = plugin('LocalNotifications');
    if (!N) return 'unsupported';
    try {
      var perm = await N.checkPermissions();
      if (perm.display === 'granted') return 'granted';
      perm = await N.requestPermissions();
      return perm.display;
    } catch (e) { return 'error'; }
  }

  async function notifyReady(token) {
    // On Android the background watcher owns system notifications (never while the app is open).
    if (watcher()) return;
    var N = plugin('LocalNotifications');
    if (!N) {
      try {
        if (global.Notification && Notification.permission === 'granted' && document.hidden) {
          new Notification('Cue', { body: 'Your order is ready — token ' + token + '.' });
        }
      } catch (e) {}
      return;
    }
    try {
      var perm = await N.checkPermissions();
      if (perm.display !== 'granted') {
        perm = await N.requestPermissions();
      }
      if (perm.display !== 'granted') return;
      await N.schedule({
        notifications: [{
          id: 1000 + (token % 1000),
          title: 'Cue',
          body: 'Your order is ready — token ' + token + '.',
          sound: 'default',
          extra: { token: token }
        }]
      });
    } catch (e) {}
  }

  async function prefsGet(key) {
    var P = plugin('Preferences');
    if (P && P.get) {
      try {
        var r = await P.get({ key: key });
        return r.value;
      } catch (e) {}
    }
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  async function prefsSet(key, value) {
    var P = plugin('Preferences');
    if (P && P.set) {
      try {
        await P.set({ key: key, value: value == null ? '' : String(value) });
        return;
      } catch (e) {}
    }
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (e) {}
  }

  async function prefsRemove(key) {
    var P = plugin('Preferences');
    if (P && P.remove) {
      try { await P.remove({ key: key }); return; } catch (e) {}
    }
    try { localStorage.removeItem(key); } catch (e) {}
  }


  var THEME_KEY = 'ob-theme';

  function systemTheme() {
    try {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  function applyThemeAttr(theme) {
    var root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
    else root.removeAttribute('data-theme');
    try {
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', '#e60023');
    } catch (e) {}
  }

  function resolvedTheme(saved) {
    if (saved === 'light' || saved === 'dark') return saved;
    return systemTheme();
  }

  async function getSavedTheme() {
    var t = await prefsGet(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
    try {
      t = localStorage.getItem(THEME_KEY);
      if (t === 'light' || t === 'dark') return t;
    } catch (e) {}
    return null;
  }

  async function setSavedTheme(theme) {
    if (theme === 'light' || theme === 'dark') {
      await prefsSet(THEME_KEY, theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
    } else {
      await prefsRemove(THEME_KEY);
      try { localStorage.removeItem(THEME_KEY); } catch (e) {}
    }
  }

  async function initTheme() {
    var saved = await getSavedTheme();
    applyThemeAttr(saved);
    // Keep localStorage in sync for FOUC script on next load
    if (saved === 'light' || saved === 'dark') {
      try { localStorage.setItem(THEME_KEY, saved); } catch (e) {}
    }
    return resolvedTheme(saved);
  }

  async function toggleTheme() {
    var cur = resolvedTheme(await getSavedTheme());
    var next = cur === 'dark' ? 'light' : 'dark';
    await setSavedTheme(next);
    applyThemeAttr(next);
    return next;
  }

  /** 'system' | 'light' | 'dark' as saved by the user (System = follow the phone). */
  async function getThemeMode() {
    return (await getSavedTheme()) || 'system';
  }

  async function setThemeMode(mode) {
    var saved = mode === 'light' || mode === 'dark' ? mode : null;
    await setSavedTheme(saved);
    applyThemeAttr(saved);
    return resolvedTheme(saved);
  }

  /** 'granted' | 'denied' | 'prompt' | 'unsupported' */
  async function notifyStatus() {
    function map(v) { return v === 'granted' ? 'granted' : v === 'denied' ? 'denied' : 'prompt'; }
    var N = plugin('LocalNotifications');
    if (N && N.checkPermissions) {
      try { return map((await N.checkPermissions()).display); } catch (e) {}
    }
    try {
      if (global.Notification) return map(Notification.permission);
    } catch (e) {}
    return 'unsupported';
  }

  async function setupChrome() {
    if (!isNative) return;
    document.body.classList.add('native');
    var SB = plugin('StatusBar');
    var SS = plugin('SplashScreen');
    // Independent bridge calls: run them side by side instead of one after another.
    var tasks = [];
    if (SB && SB.setBackgroundColor) tasks.push(function () { return SB.setBackgroundColor({ color: '#e60023' }); });
    if (SB && SB.setStyle) tasks.push(function () { return SB.setStyle({ style: 'DARK' }); });
    if (SS && SS.hide) tasks.push(function () { return SS.hide(); });
    await Promise.all(tasks.map(function (run) {
      return new Promise(function (resolve) {
        try { Promise.resolve(run()).then(resolve, resolve); } catch (e) { resolve(); }
      });
    }));
  }

  global.OBNative = {
    isNative: isNative,
    buzz: buzz,
    keepAwake: keepAwake,
    notifyReady: notifyReady,
    hasWatcher: function () { return !!watcher(); },
    watchSync: function (payload) { return watchCall('sync', payload); },
    watchClear: function (token) { return watchCall('clear', { token: token }); },
    watchClearAll: function () { return watchCall('clearAll'); },
    batteryStatus: function () { return watchCall('batteryStatus'); },
    requestBatteryExemption: function () { return watchCall('requestBatteryExemption'); },
    requestNotifyPermission: requestNotifyPermission,
    notifyStatus: notifyStatus,
    openNotificationSettings: function () { return watchCall('openNotificationSettings'); },
    getThemeMode: getThemeMode,
    setThemeMode: setThemeMode,
    plugin: plugin,
    prefsGet: prefsGet,
    prefsSet: prefsSet,
    prefsRemove: prefsRemove,
    setupChrome: setupChrome,
    initTheme: initTheme,
    toggleTheme: toggleTheme,
    resolvedTheme: function () { return resolvedTheme(document.documentElement.getAttribute('data-theme')); }
  };
})(window);
