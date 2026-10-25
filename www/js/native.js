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

  async function notifyReady(token) {
    var N = plugin('LocalNotifications');
    if (!N) {
      try {
        if (global.Notification && Notification.permission === 'granted' && document.hidden) {
          new Notification('Your order is ready', { body: 'Token ' + token + ' is ready at the counter.' });
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
          title: 'Your order is ready',
          body: 'Token ' + token + ' is ready at the counter.',
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

  async function setupChrome() {
    if (!isNative) return;
    document.body.classList.add('native');
    var SB = plugin('StatusBar');
    var SS = plugin('SplashScreen');
    try {
      if (SB && SB.setBackgroundColor) await SB.setBackgroundColor({ color: '#e60023' });
      if (SB && SB.setStyle) await SB.setStyle({ style: 'DARK' });
    } catch (e) {}
    try {
      if (SS && SS.hide) await SS.hide();
    } catch (e) {}
  }

  global.OBNative = {
    isNative: isNative,
    buzz: buzz,
    keepAwake: keepAwake,
    notifyReady: notifyReady,
    prefsGet: prefsGet,
    prefsSet: prefsSet,
    prefsRemove: prefsRemove,
    setupChrome: setupChrome
  };
})(window);
