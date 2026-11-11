/**
 * Small persisted preferences (alert sound, vibration) plus theme-mode helpers.
 * Storage is injected ({ get(key), set(key, value) } returning promises) so it works with
 * Capacitor Preferences, localStorage, or a fake in tests. The theme itself is saved by native.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBSettings = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var KEYS = { sound: 'ob-sound', vibration: 'ob-vibration' };

  function parseBool(raw, fallback) {
    if (raw === true || raw === '1' || raw === 'true') return true;
    if (raw === false || raw === '0' || raw === 'false') return false;
    return fallback;
  }

  /** Saved theme value -> 'system' | 'light' | 'dark'. Anything unknown follows the phone. */
  function normalizeTheme(v) { return v === 'light' || v === 'dark' ? v : 'system'; }

  /** The theme actually shown for a mode, given whether the phone is in dark mode. */
  function resolveTheme(mode, systemDark) {
    if (mode === 'light' || mode === 'dark') return mode;
    return systemDark ? 'dark' : 'light';
  }

  function create(store, defaults) {
    var values = { sound: true, vibration: true };
    Object.keys(defaults || {}).forEach(function (k) { if (k in KEYS) values[k] = !!defaults[k]; });
    var listeners = [];

    return {
      /** Reads saved values; missing or unreadable ones keep their defaults. */
      load: async function () {
        for (var k of Object.keys(KEYS)) {
          var raw = null;
          try { raw = await store.get(KEYS[k]); } catch (e) {}
          values[k] = parseBool(raw, values[k]);
        }
        return Object.assign({}, values);
      },
      get: function (key) { return values[key]; },
      set: async function (key, on) {
        if (!(key in KEYS)) throw new Error('Unknown setting: ' + key);
        values[key] = !!on;
        listeners.forEach(function (fn) { try { fn(key, values[key]); } catch (e) {} });
        await store.set(KEYS[key], values[key] ? '1' : '0');
        return values[key];
      },
      onChange: function (fn) { listeners.push(fn); }
    };
  }

  return { create: create, normalizeTheme: normalizeTheme, resolveTheme: resolveTheme, KEYS: KEYS };
});
