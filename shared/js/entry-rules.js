/**
 * Validation for the token a student types. Pure, so it can be unit-tested and reused:
 * the message is shown inline under the field (not only as a toast).
 *
 *   validateToken(raw, { mines, order, max, maxTracked }) ->
 *     { ok: true,  token, note? }   note = a gentle heads-up, tracking still goes ahead
 *     { ok: false, code, message }  code: empty | range | duplicate | limit
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OBEntryRules = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  var MAX_TOKEN = 200;
  var MAX_TRACKED = 5;

  function digitsOf(raw) { return String(raw == null ? '' : raw).replace(/\D/g, ''); }

  function validateToken(raw, ctx) {
    ctx = ctx || {};
    var max = ctx.max || MAX_TOKEN;
    var maxTracked = ctx.maxTracked || MAX_TRACKED;
    var mines = ctx.mines || [];
    var digits = digitsOf(raw);
    if (!digits) return { ok: false, code: 'empty', message: 'Enter the number on your receipt.' };
    var n = parseInt(digits, 10);
    if (!(n >= 1 && n <= max)) {
      return { ok: false, code: 'range', message: 'Token numbers run from 1 to ' + max + '.' };
    }
    if (mines.indexOf(n) !== -1) {
      return { ok: false, code: 'duplicate', message: 'You’re already tracking token ' + n + '.' };
    }
    if (mines.length >= maxTracked) {
      return { ok: false, code: 'limit', message: 'You can track up to ' + maxTracked + ' orders. Remove one first.' };
    }
    var order = ctx.order;
    if (!order) {
      return { ok: true, token: n, note: 'Token ' + n + ' isn’t on the board yet. You can still track it.' };
    }
    if ((+order.c || 0) > 0) {
      return { ok: true, token: n, note: 'Token ' + n + ' already shows as collected. Double-check your receipt.' };
    }
    return { ok: true, token: n };
  }

  return { validateToken: validateToken, digitsOf: digitsOf, MAX_TOKEN: MAX_TOKEN, MAX_TRACKED: MAX_TRACKED };
});
