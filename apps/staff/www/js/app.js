(function () {
  var EXP = 20;
  var POOL = 200;
  var snd = false, ac = null;
  var settings = null;
  var APP_VERSION = '1.0.0';
  var undoFn = null, toastT = null;
  var typed = '', showAllP = false, showAllR = false;

  var $ = function (i) { return document.getElementById(i); };

  /** Assigning textContent replaces the text node and dirties layout even when the text is the same. */
  function setText(id, text) {
    var el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }
  function setHidden(id, hidden) {
    var el = $(id);
    if (el.hidden !== hidden) el.hidden = hidden;
  }

  function chime() {
    if (!snd) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.resume) ac.resume();
      [880, 1175].forEach(function (f, i) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(ac.destination);
        var t = ac.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.start(t); o.stop(t + 0.55);
      });
    } catch (e) {}
  }

  function toast(msg, fn) {
    $('toastMsg').textContent = msg;
    undoFn = fn;
    $('undo').hidden = !fn;
    $('toast').hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { $('toast').hidden = true; }, 6000);
  }

  function fail(err) {
    toast((err && err.message) || 'Could not save. Try again.');
    render();
  }

  /** Saves via the store; a rejected write has already been rolled back, so just tell the staff. */
  function write(n, f) { return OBStore.write(n, f).catch(fail); }
  function view() { return OBStore.view(EXP); }

  function callReady(n) {
    write(n, { r: Date.now() });
    toast('Token ' + n + ' is ready', function () { write(n, { r: 0 }); });
    chime();
    try {
      var H = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics;
      if (H && H.impact) H.impact({ style: 'Medium' });
      else if (navigator.vibrate) navigator.vibrate(35);
    } catch (e) {}
  }

  function handOver(n) {
    write(n, { c: Date.now() });
    toast('Token ' + n + ' taken off', function () { write(n, { c: 0 }); });
  }

  var TR = window.OBTokenRules;
  var conflictN = 0, shakeKey = '';

  /** Keypad state for token n: free / recent / preparing / ready / invalid / conflict. */
  function stateFor(n) {
    var st = TR.entryState(n, n ? OBStore.find(n) : null, Date.now());
    if (n && !st.blocked && n === conflictN) {
      return {
        kind: 'conflict', blocked: true, n: n,
        title: 'Token ' + n + ' was just taken',
        message: 'Another phone added token ' + n + ' a moment ago. Pick a free number.'
      };
    }
    return st;
  }

  /** Shake/haptic only once the number looks intended (2+ digits), not on the first digit of e.g. 12 or 125. */
  function typedComplete() {
    return typed.length >= 2;
  }

  function shakeEntry() {
    var e = $('entry');
    e.classList.remove('shake');
    void e.offsetWidth;
    e.classList.add('shake');
    try {
      var H = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.Haptics;
      if (H && H.notification) H.notification({ type: 'WARNING' });
      else if (H && H.impact) H.impact({ style: 'Heavy' });
      else if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    } catch (e2) {}
  }

  function addToken(n) {
    return OBStore.issueToken(n).then(function () {
      toast('Token ' + n + ' added', function () { write(n, { c: Date.now() }); });
    }, function (err) {
      if (err && err.code === 'in-use') {
        // Lost a race with another phone: keep the number on the keypad and explain inline.
        conflictN = n;
        typed = String(n);
        render();
        shakeKey = typed + ':conflict';
        shakeEntry();
      }
      fail(err);
    });
  }

  function drawEntry() {
    var e = $('entry');
    var n = parseInt(typed, 10) || 0;
    if (conflictN && n !== conflictN) conflictN = 0;
    var st = stateFor(n), mb = $('mainBtn');
    var inUse = st.kind === 'preparing' || st.kind === 'ready' || st.kind === 'conflict';
    var warn = st.kind === 'recent';

    setText('entry', typed || 'Type a token');
    var entryCls = 'entry' + (typed ? '' : ' ph') + (inUse || st.kind === 'invalid' ? ' bad' : warn ? ' warn' : '') +
      (e.classList.contains('shake') ? ' shake' : '');
    if (e.className !== entryCls) e.className = entryCls;

    mb.disabled = !n || st.kind === 'invalid' || st.kind === 'conflict';
    var mbText = !n ? 'Add token'
      : st.kind === 'preparing' ? 'Mark ' + n + ' ready'
      : st.kind === 'ready' ? 'Hand over ' + n
      : warn ? 'Add ' + n + ' again'
      : st.kind === 'free' ? 'Add token ' + n
      : 'Add token';
    setText('mainBtn', mbText);
    setHidden('handRem', st.kind !== 'preparing');

    var card = $('inuse');
    card.hidden = !(inUse || warn);
    var cardCls = 'inuse' + (warn ? ' warn' : '');
    if (card.className !== cardCls) card.className = cardCls;
    if (!card.hidden) {
      $('inuseTitle').textContent = st.title;
      $('inuseMsg').textContent = st.message;
      var free = inUse ? TR.nearestFree(n, OBStore.find, Date.now(), 3) : [];
      $('freeWrap').hidden = !free.length;
      var chips = $('freeChips');
      chips.innerHTML = '';
      free.forEach(function (f) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip';
        b.textContent = f;
        b.setAttribute('aria-label', 'Add token ' + f + ' instead');
        b.onclick = function () { typed = ''; addToken(f); render(); };
        chips.appendChild(b);
      });
    }

    var key = typed + ':' + st.kind;
    if ((st.kind === 'preparing' || st.kind === 'ready') && typedComplete() && key !== shakeKey) shakeEntry();
    shakeKey = key;

    setHidden('keyHint', !(!n || st.kind === 'free'));
    setText('keyHint', !n
      ? 'The red button changes based on the number.'
      : 'Free — tap Add.');
  }

  var lastTilesSig = '', lastReadySig = '';

  function render() {
    var V = view(), P = V.prep, R = V.rd;
    var q = typed, LIM = 8;
    function mt(h) { return !q || String(h.n).indexOf(q) >= 0; }
    var PP = P.filter(mt), RR = R.filter(mt);
    setText('prepH', P.length ? ('Up next · ' + P.length) : 'Up next');
    setText('prepHint', q
      ? 'Filtered to “' + q + '”.'
      : (P.length ? 'Oldest first — tap a token when it is ready.' : 'Quiet for now.'));
    var now = Date.now();
    var ageOf = function (h) {
      var m = Math.floor((now - h.t) / 60000);
      return m < 1 ? '<1m' : m + 'm';
    };

    // The keypad calls render() on every key press; only rebuild a tile list when what it shows changed.
    var shownP = q || showAllP ? PP : PP.slice(0, LIM);
    var pSig = [q, showAllP, P.length ? P[0].n : 0].concat(shownP.map(function (h) { return h.n + ':' + ageOf(h); })).join('|');
    if (pSig !== lastTilesSig) {
      lastTilesSig = pSig;
      var tl = $('tiles');
      var frag = document.createDocumentFragment();
      if (!PP.length) {
        var none = document.createElement('p');
        none.className = 'hint';
        none.style.cssText = 'grid-column:1/-1;margin:0';
        none.textContent = q ? 'No match for ' + q + '.' : 'No orders preparing.';
        frag.appendChild(none);
      }
      shownP.forEach(function (h) {
        var d = document.createElement('div');
        d.className = 'tile' + (h === P[0] ? ' first' : '');
        var b = document.createElement('button');
        b.className = 'tnum'; b.textContent = h.n;
        b.setAttribute('aria-label', 'Token ' + h.n + ' is ready');
        b.onclick = function () { callReady(h.n); };
        var ageEl = document.createElement('span');
        ageEl.className = 'tage';
        ageEl.textContent = ageOf(h);
        var x = document.createElement('button');
        x.className = 'tx'; x.textContent = 'Cancel order';
        x.setAttribute('aria-label', 'Cancel order for token ' + h.n);
        x.onclick = function () { handOver(h.n); };
        d.appendChild(b); d.appendChild(ageEl); d.appendChild(x); frag.appendChild(d);
      });
      tl.textContent = '';
      tl.appendChild(frag);
    }
    setHidden('moreP', !!q || PP.length <= LIM);
    setText('moreP', showAllP ? 'Show fewer' : 'Show all ' + PP.length);

    setHidden('offWrap', !R.length);
    setText('readyH', R.length ? ('Ready · ' + R.length) : 'Ready');
    var shownR = q || showAllR ? RR : RR.slice(0, LIM);
    var rSig = [q, showAllR].concat(shownR.map(function (h) { return h.n; })).join('|');
    if (rSig !== lastReadySig) {
      lastReadySig = rSig;
      var ot = $('offTiles');
      var rf = document.createDocumentFragment();
      shownR.forEach(function (h) {
        var b = document.createElement('button');
        b.className = 'tile ok tbtn'; b.textContent = h.n;
        b.setAttribute('aria-label', 'Token ' + h.n + ' handed over, take off the board');
        b.onclick = function () { handOver(h.n); };
        rf.appendChild(b);
      });
      ot.textContent = '';
      ot.appendChild(rf);
    }
    setHidden('moreR', !!q || RR.length <= LIM);
    setText('moreR', showAllR ? 'Show fewer' : 'Show all ' + RR.length);

    var qo = $('quickOldest');
    if (qo) {
      if (P.length && !typed) {
        qo.hidden = false;
        setText('quickOldest', 'Mark ' + P[0].n + ' ready · ' + ageOf(P[0]));
      } else {
        qo.hidden = true;
      }
    }

    drawEntry();
    var syncLbl = OBStore.getSyncLabel();
    setText('sync', /^Live/.test(syncLbl) ? '' : syncLbl);
  }

  function press(k) {
    if (k === 'Clear') typed = '';
    else if (k === 'Delete') typed = typed.slice(0, -1);
    else if (typed.length < 3) {
      var cand = (typed + k).replace(/^0+(?=\d)/, '');
      var num = parseInt(cand, 10);
      // Digits that would go past the largest token are simply not accepted.
      if (!isNaN(num) && num <= POOL) typed = cand;
    }
    render();
  }

  function act() {
    var n = parseInt(typed, 10);
    if (!n) return;
    var st = stateFor(n);
    if (st.kind === 'invalid') {
      toast('Check the token number.');
      typed = '';
      render();
      return;
    }
    if (st.kind === 'conflict') return;
    typed = '';
    if (st.kind === 'preparing') callReady(n);
    else if (st.kind === 'ready') handOver(n);
    else addToken(n);
  }

  function remHand() {
    var n = parseInt(typed, 10);
    if (!n || n < 1 || n > POOL) return;
    typed = '';
    handOver(n);
  }

  function wireKeys() {
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Clear', '0', 'Delete'].forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'key' + (k.length > 1 ? ' s' : '');
      b.textContent = k;
      b.setAttribute('aria-label', k);
      b.onclick = function () { this.blur(); press(k); };
      $('keys').appendChild(b);
    });
  }

  function wireUi() {
    $('mainBtn').onclick = act;
    if ($('quickOldest')) {
      $('quickOldest').onclick = function () {
        var P = view().prep;
        if (P.length) callReady(P[0].n);
      };
    }
    $('handRem').onclick = remHand;
    $('moreP').onclick = function () { showAllP = !showAllP; render(); };
    $('moreR').onclick = function () { showAllR = !showAllR; render(); };
    $('clearReady').onclick = function () {
      var L = view().rd;
      if (!L.length) return;
      var t = Date.now();
      L.forEach(function (h) { write(h.n, { c: t }); });
      toast(
        L.length === 1 ? 'Token ' + L[0].n + ' taken off' : L.length + ' ready tokens taken off',
        function () { L.forEach(function (h) { write(h.n, { c: 0 }); }); }
      );
    };
    $('undo').onclick = function () {
      $('toast').hidden = true;
      if (undoFn) undoFn();
      undoFn = null;
    };
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.target.tagName === 'INPUT' || document.body.classList.contains('settings-open')) return;
      if (/^\d$/.test(ev.key)) press(ev.key);
      else if (ev.key === 'Backspace') press('Delete');
      else if (ev.key === 'Escape') press('Clear');
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (typed) act();
        else {
          var P = view().prep;
          if (P.length) callReady(P[0].n);
        }
      }
    });
  }

  async function initSettings() {
    await OBNative.initTheme();
    settings = OBSettings.create({ get: OBNative.prefsGet, set: OBNative.prefsSet }, { sound: false });
    await settings.load();
    snd = settings.get('sound');
    OBSettingsUI.init({
      settings: settings,
      appName: 'Cue Staff',
      version: APP_VERSION,
      onChange: function (key, on) { if (key === 'sound') { snd = on; if (on) chime(); } }
    });
  }

  var boardStarted = false;
  async function startBoard() {
    if (boardStarted) return;
    boardStarted = true;
    wireKeys();
    wireUi();
    OBStore.onChange(function () { render(); });
    // Keep the counter hidden until Firestore is attached; otherwise a token added in the first
    // second after sign-in would only be saved on this phone and never reach the live board.
    await OBStore.init();
    $('staff-auth').hidden = true;
    $('v-admin').hidden = false;
    render();
    setInterval(render, 30000);
  }

  function authMessage(error) {
    var code = error && error.code ? String(error.code) : '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(code)) return 'Wrong email or password.';
    if (/invalid-email/.test(code)) return 'Enter a valid email address.';
    if (/too-many-requests/.test(code)) return 'Too many tries. Wait a minute and try again.';
    if (/network-request-failed/.test(code)) return 'No connection. Check the internet and try again.';
    if (/user-disabled/.test(code)) return 'This account has been disabled.';
    if (/operation-not-allowed|admin-restricted/.test(code)) return 'Email sign-in is not turned on for this Firebase project.';
    if (/permission-denied/.test(code)) return 'This account is not authorized for staff access.';
    return (error && error.message && error.code === undefined ? error.message : '') || 'Could not sign in. Try again.';
  }

  function showAuth(message) {
    $('staff-auth').hidden = false;
    $('staff-auth-error').textContent = message || '';
  }

  async function boot() {
    if (window.OBNative) await OBNative.setupChrome();
    await initSettings();
    if (window.ORDER_BOARD_STAFF_APP && window.ORDER_BOARD_FIREBASE) {
      showAuth('');
      $('staff-auth-form').onsubmit = async function (event) {
        event.preventDefault();
        var button = this.querySelector('button[type="submit"]');
        var email = $('staff-email').value.trim();
        var password = $('staff-password').value;
        if (!email || !password) {
          showAuth('Enter your email and password.');
          return;
        }
        button.disabled = true;
        $('staff-auth-error').textContent = 'Signing in…';
        try {
          await OBStore.signInStaff(email, password);
          $('staff-password').value = '';
          await startBoard();
        } catch (error) {
          showAuth(authMessage(error));
        } finally {
          button.disabled = false;
        }
      };
      try {
        if (await OBStore.restoreStaffSession()) {
          await startBoard();
          return;
        }
      } catch (error) {
        showAuth(authMessage(error));
      }
      return;
    }
    await startBoard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
