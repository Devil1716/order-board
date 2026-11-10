/**
 * Token rules shared by the Android web apps. Mirrors
 * ios/CueCore/Sources/CueCore/Models/TokenRules.swift so iOS and Android
 * pick the same token for the same board state.
 *
 *  - Token pool 1–150 (document ids "1".."150" in Firestore `orders`)
 *  - Orders older than 4 h (from `t`) are stale
 *  - A ready order stops holding its token 20 min after `r`
 *  - A collected order (`c` > 0) frees its token
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBTokenRules = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var MAX_TOKEN = 150;
  var STALE_MS = 4 * 3600000;
  var EXPIRY_MS = 20 * 60000;

  function isValidToken(n) {
    return typeof n === 'number' && n === Math.floor(n) && n >= 1 && n <= MAX_TOKEN;
  }

  /** Stored counter value → usable start (invalid values fall back to 1). */
  function normalizeStart(v) {
    v = +v;
    return isValidToken(v) ? v : 1;
  }

  /** True while an order doc still holds its token (same test as the iOS transaction). */
  function isTaken(order, now) {
    if (!order) return false;
    var t = +order.t || 0, r = +order.r || 0, c = +order.c || 0;
    if (now - t > STALE_MS || c !== 0) return false;
    return r === 0 || now - r <= EXPIRY_MS;
  }

  /**
   * Scan candidates start, start+1, … (wrapping) and return the first free token.
   * `getOrder(n)` may return a value or a Promise (Firestore transaction reads).
   * Resolves { token, nextStart } or null when all 150 tokens are in use.
   */
  async function chooseToken(start, getOrder, now) {
    var s = normalizeStart(start);
    for (var k = 0; k < MAX_TOKEN; k++) {
      var candidate = (s - 1 + k) % MAX_TOKEN + 1;
      var order = await getOrder(candidate);
      if (!isTaken(order, now)) {
        return { token: candidate, nextStart: (candidate % MAX_TOKEN) + 1 };
      }
    }
    return null;
  }

  /** Synchronous variant for UI previews against the in-memory board. */
  function chooseTokenSync(start, getOrder, now) {
    var s = normalizeStart(start);
    for (var k = 0; k < MAX_TOKEN; k++) {
      var candidate = (s - 1 + k) % MAX_TOKEN + 1;
      if (!isTaken(getOrder(candidate), now)) {
        return { token: candidate, nextStart: (candidate % MAX_TOKEN) + 1 };
      }
    }
    return null;
  }

  return {
    MAX_TOKEN: MAX_TOKEN,
    STALE_MS: STALE_MS,
    EXPIRY_MS: EXPIRY_MS,
    isValidToken: isValidToken,
    normalizeStart: normalizeStart,
    isTaken: isTaken,
    chooseToken: chooseToken,
    chooseTokenSync: chooseTokenSync
  };
});
