/**
 * Token rules shared by the Android web apps. Mirrors
 * ios/CueCore/Sources/CueCore/Models/TokenRules.swift so iOS and Android
 * agree on which tokens are still in use.
 *
 *  - Token pool 1–200 (document ids "1".."200" in Firestore `orders`)
 *  - Orders older than 4 h (from `t`) are stale
 *  - A ready order stops holding its token 20 min after `r`
 *  - A collected order (`c` > 0) frees its token
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBTokenRules = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var MAX_TOKEN = 200;
  var STALE_MS = 4 * 3600000;
  var EXPIRY_MS = 20 * 60000;
  var RECENT_MS = 2 * 60000;     // "just handed over" warning window (UI only, never blocks)

  function isValidToken(n) {
    return typeof n === 'number' && n === Math.floor(n) && n >= 1 && n <= MAX_TOKEN;
  }

  /** True while an order doc still holds its token (same test as the iOS transaction). */
  function isTaken(order, now) {
    if (!order) return false;
    var t = +order.t || 0, r = +order.r || 0, c = +order.c || 0;
    if (now - t > STALE_MS || c !== 0) return false;
    return r === 0 || now - r <= EXPIRY_MS;
  }

  /** Handed over / cancelled in the last 2 minutes (still inside the 4 h window). */
  function isRecentlyHandedOver(order, now) {
    if (!order) return false;
    var t = +order.t || 0, c = +order.c || 0;
    return c > 0 && now - t <= STALE_MS && now - c >= 0 && now - c <= RECENT_MS;
  }

  function clock(ms) {
    try {
      return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /**
   * What the keypad should show for the typed number `n` given the current order doc.
   *  kind: empty | invalid | free | recent (warn, can still add) | preparing | ready (in use: cannot add)
   * `blocked` is the single source of truth for "Add must not be offered".
   */
  function entryState(n, order, now, fmt) {
    fmt = fmt || clock;
    if (!n) return { kind: 'empty', blocked: false };
    if (!isValidToken(n)) return { kind: 'invalid', blocked: true, n: n, message: 'Check the token number.' };
    if (isTaken(order, now)) {
      var ready = (+order.r || 0) > 0;
      var since = ready ? +order.r : +order.t;
      return {
        kind: ready ? 'ready' : 'preparing',
        blocked: true,
        n: n,
        since: since,
        title: 'Token ' + n + ' is already in use',
        message: ready
          ? 'Ready since ' + fmt(since) + ' — waiting for pickup. Hand it over, or pick a free number.'
          : 'Preparing since ' + fmt(since) + '. Mark it ready, or pick a free number.'
      };
    }
    if (isRecentlyHandedOver(order, now)) {
      return {
        kind: 'recent',
        blocked: false,
        n: n,
        since: +order.c,
        title: 'Just handed over',
        message: 'Token ' + n + ' left the board at ' + fmt(+order.c) + '. Add it again?'
      };
    }
    return { kind: 'free', blocked: false, n: n };
  }

  /** Up to `count` free numbers nearest to `n` (alternating above/below), skipping in-use and just-handed-over ones. */
  function nearestFree(n, getOrder, now, count) {
    var out = [];
    count = count || 3;
    for (var d = 1; d < MAX_TOKEN && out.length < count; d++) {
      var pair = [n + d, n - d];
      for (var i = 0; i < pair.length && out.length < count; i++) {
        var c = pair[i];
        if (!isValidToken(c)) continue;
        var o = getOrder(c);
        if (!isTaken(o, now) && !isRecentlyHandedOver(o, now)) out.push(c);
      }
    }
    return out;
  }

  return {
    MAX_TOKEN: MAX_TOKEN,
    STALE_MS: STALE_MS,
    EXPIRY_MS: EXPIRY_MS,
    RECENT_MS: RECENT_MS,
    isValidToken: isValidToken,
    isTaken: isTaken,
    isRecentlyHandedOver: isRecentlyHandedOver,
    entryState: entryState,
    nearestFree: nearestFree
  };
});
