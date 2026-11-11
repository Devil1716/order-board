(function () {
  var EXP = 20;
  var POOL = 200;
  var snd = false, ac = null;
  var undoFn = null, toastT = null;
  var typed = '', showAllP = false, showAllR = false;

  var $ = function (i) { return document.getElementById(i); };

  function paintThemeBtn(mode) {
    var b = $('themeBtn');
    if (!b) return;
    b.textContent = mode === 'dark' ? 'Dark' : 'Light';
    b.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
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

    e.textContent = typed || 'Type a token';
    e.className = 'entry' + (typed ? '' : ' ph') + (inUse || st.kind === 'invalid' ? ' bad' : warn ? ' warn' : '') +
      (e.classList.contains('shake') ? ' shake' : '');

    mb.disabled = !n || st.kind === 'invalid' || st.kind === 'conflict';
    mb.textContent = !n ? 'Add token'
      : st.kind === 'preparing' ? 'Mark ' + n + ' ready'
      : st.kind === 'ready' ? 'Hand over ' + n
      : warn ? 'Add ' + n + ' again'
      : st.kind === 'free' ? 'Add token ' + n
      : 'Add token';
    $('handRem').hidden = st.kind !== 'preparing';

    var card = $('inuse');
    card.hidden = !(inUse || warn);
    card.className = 'inuse' + (warn ? ' warn' : '');
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

    $('keyHint').hidden = !(!n || st.kind === 'free');
    $('keyHint').textContent = !n
      ? 'The red button changes based on the number.'
      : 'Free — tap Add.';
  }

  function render() {
    var V = view(), P = V.prep, R = V.rd;
    var q = typed, LIM = 8;
    function mt(h) { return !q || String(h.n).indexOf(q) >= 0; }
    var PP = P.filter(mt), RR = R.filter(mt);
    $('prepH').textContent = P.length ? ('Up next · ' + P.length) : 'Up next';
    $('prepHint').textContent = q
      ? 'Filtered to “' + q + '”.'
      : (P.length ? 'Oldest first — tap a token when it is ready.' : 'Quiet for now.');
    var tl = $('tiles'); tl.innerHTML = '';
    if (!PP.length) {
      tl.innerHTML = '<p class="hint" style="grid-column:1/-1;margin:0">' +
        (q ? 'No match for ' + q + '.' : 'No orders preparing.') +
        '</p>';
    }
    var now = Date.now();
    (q || showAllP ? PP : PP.slice(0, LIM)).forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'tile' + (h === P[0] ? ' first' : '');
      var b = document.createElement('button');
      b.className = 'tnum'; b.textContent = h.n;
      b.setAttribute('aria-label', 'Token ' + h.n + ' is ready');
      b.onclick = function () { callReady(h.n); };
      var ageMin = Math.floor((now - h.t) / 60000);
      var ageEl = document.createElement('span');
      ageEl.className = 'tage';
      ageEl.textContent = ageMin < 1 ? '<1m' : ageMin + 'm';
      var x = document.createElement('button');
      x.className = 'tx'; x.textContent = 'Cancel order';
      x.setAttribute('aria-label', 'Cancel order for token ' + h.n);
      x.onclick = function () { handOver(h.n); };
      d.appendChild(b); d.appendChild(ageEl); d.appendChild(x); tl.appendChild(d);
    });
    var mp = $('moreP');
    mp.hidden = !!q || PP.length <= LIM;
    mp.textContent = showAllP ? 'Show fewer' : 'Show all ' + PP.length;

    $('offWrap').hidden = !R.length;
    $('readyH').textContent = R.length ? ('Ready · ' + R.length) : 'Ready';
    var ot = $('offTiles'); ot.innerHTML = '';
    (q || showAllR ? RR : RR.slice(0, LIM)).forEach(function (h) {
      var b = document.createElement('button');
      b.className = 'tile ok tbtn'; b.textContent = h.n;
      b.setAttribute('aria-label', 'Token ' + h.n + ' handed over, take off the board');
      b.onclick = function () { handOver(h.n); };
      ot.appendChild(b);
    });
    var mr = $('moreR');
    mr.hidden = !!q || RR.length <= LIM;
    mr.textContent = showAllR ? 'Show fewer' : 'Show all ' + RR.length;

    var qo = $('quickOldest');
    if (qo) {
      if (P.length && !typed) {
        var ageMin0 = Math.floor((Date.now() - P[0].t) / 60000);
        var ageLbl = ageMin0 < 1 ? '<1m' : ageMin0 + 'm';
        qo.hidden = false;
        qo.textContent = 'Mark ' + P[0].n + ' ready · ' + ageLbl;
      } else {
        qo.hidden = true;
      }
    }

    drawEntry();
    $('sync').textContent = OBStore.getSyncLabel();
  }

  function press(k) {
    if (k === 'Clear') typed = '';
    else if (k === 'Delete') typed = typed.slice(0, -1);
    else if (typed.length < 3) {
      var cand = (typed + k).replace(/^0+(?=\d)/, '');
      var num = parseInt(cand, 10);
      if (!isNaN(num) && num <= POOL) typed = cand;
      else if (!isNaN(num) && num > POOL) {
        toast('Token range is 1 to ' + POOL);
      }
    }
    render();
  }

  function act() {
    var n = parseInt(typed, 10);
    if (!n) return;
    var st = stateFor(n);
    if (st.kind === 'invalid') {
      toast('Token must be between 1 and ' + POOL);
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

  function wireTheme() {
    if ($('themeBtn')) {
      $('themeBtn').onclick = async function () {
        var mode = window.OBNative ? await OBNative.toggleTheme() : (function () {
          var cur = document.documentElement.getAttribute('data-theme') ||
            (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
          var next = cur === 'dark' ? 'light' : 'dark';
          document.documentElement.setAttribute('data-theme', next);
          try { localStorage.setItem('ob-theme', next); } catch (e) {}
          return next;
        })();
        paintThemeBtn(mode);
      };
    }
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
      if (ev.metaKey || ev.ctrlKey || ev.target.tagName === 'INPUT') return;
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
    $('snd').onclick = function () {
      snd = !snd;
      this.setAttribute('aria-pressed', snd);
      this.textContent = snd ? 'Sound on' : 'Sound off';
      if (snd) chime();
    };

  }

  async function initTheme() {
    wireTheme();
    if (window.OBNative) {
      paintThemeBtn(await OBNative.initTheme());
    } else {
      var saved = null;
      try { saved = localStorage.getItem('ob-theme'); } catch (e) {}
      paintThemeBtn(saved === 'dark' || (!saved && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    }
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
    await initTheme();
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
