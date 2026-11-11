/**
 * Where a "your order is ready" signal should go. Mirrored in Java by
 * apps/student/android/.../OrderWatchService.java (the background watcher), keep them in step.
 *
 *  - app visible (foreground, screen on)  -> in-app full-screen alert, NO system notification
 *  - app hidden / screen off / killed     -> normal system notification (heads-up, not full-screen)
 *  - once per transition to ready (keyed by the order's ready time `r`)
 *  - never for an order the student already acknowledged in the app
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBNotifyRules = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var EXPIRY_MS = 20 * 60000;     // a ready order stops counting 20 min after `r`
  var STALE_MS = 4 * 3600000;     // orders older than 4 h are stale

  /** Ready, not collected, and not yet expired. */
  function isReady(order, now) {
    if (!order) return false;
    var t = +order.t || 0, r = +order.r || 0, c = +order.c || 0;
    return r > 0 && c === 0 && now - t <= STALE_MS && now - r <= EXPIRY_MS;
  }

  /** Still worth watching: waiting for ready, or ready and uncollected. */
  function isActive(order, now) {
    if (!order) return true;                 // staff may not have added it yet
    var t = +order.t || 0, r = +order.r || 0, c = +order.c || 0;
    if (c !== 0 || now - t > STALE_MS) return false;
    return r === 0 || now - r <= EXPIRY_MS;
  }

  /**
   * @param s { order, now, visible, ackedR, notifiedR }
   *   ackedR    = ready time the student already acknowledged in the app (Got it / collected)
   *   notifiedR = ready time we already posted a system notification for
   * @returns 'alert' | 'notify' | 'none'
   */
  function deliveryFor(s) {
    if (!isReady(s.order, s.now)) return 'none';
    var r = +s.order.r;
    if (s.ackedR === r) return 'none';
    if (s.visible) return 'alert';
    return s.notifiedR === r ? 'none' : 'notify';
  }

  /** A posted notification should disappear once the order is collected/expired or acknowledged. */
  function shouldClear(order, now, ackedR) {
    if (!isReady(order, now)) return true;
    return ackedR === +order.r;
  }

  return { isReady: isReady, isActive: isActive, deliveryFor: deliveryFor, shouldClear: shouldClear,
    EXPIRY_MS: EXPIRY_MS, STALE_MS: STALE_MS };
});
