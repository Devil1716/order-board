(function () {
  var EXP = 20;
  var POOL = 150;
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

  function write(n, f) { OBStore.write(n, f); }
  function view() { return OBStore.view(EXP); }

  function callReady(n) {
    write(n, { r: Date.now() });
    toast('Token ' + n + ' is ready', function () { write(n, { r: 0 }); });
    chime();
  }

  function handOver(n) {
    write(n, { c: Date.now() });
    toast('Token ' + n + ' taken off', function () { write(n, { c: 0 }); });
  }

  function nextNumSync() {
    var start = window.__obNextStart || 1;
    var V = view(), used = {};
    V.prep.concat(V.rd).forEach(function (x) { used[x.n] = 1; });
    for (var k = 0; k < POOL; k++) {
      var n = (start - 1 + k) % POOL + 1;
      if (!used[n]) return n;
    }
    return 0;
  }

  async function refreshNextStart() {
    window.__obNextStart = await OBStore.getNextStart();
  }

  async function setNext(n) {
    await OBStore.setNext(n);
    window.__obNextStart = n > POOL ? 1 : n;
  }

  function modeOf(n) {
    var V = view();
    if (V.prep.some(function (x) { return x.n === n; })) return 'prep';
    if (V.rd.some(function (x) { return x.n === n; })) return 'ready';
    return 'none';
  }

  function drawEntry() {
    var e = $('entry');
    e.textContent = typed || 'Type a token number';
    e.className = 'entry' + (typed ? '' : ' ph');
    var n = parseInt(typed, 10), m = n ? modeOf(n) : 'none', mb = $('mainBtn');
    mb.disabled = !n;
    mb.textContent = !n ? 'Add token' : m === 'prep' ? 'Ready: ' + n : m === 'ready' ? 'Hand over: ' + n : 'Add token ' + n;
    $('handRem').hidden = !(n && m === 'prep');
    var nn = nextNumSync();
    $('genNum').textContent = nn || 'Full';
    $('genBtn').disabled = !nn;
    $('keyHint').textContent = !n
      ? 'Type a number. The big button shows what it will do.'
      : m === 'prep'
        ? 'This order is being prepared. Tap Ready when it is done.'
        : m === 'ready'
          ? 'This order is on the board. Tap Hand over to remove it.'
          : 'This token isn’t on the board yet. Tap Add to put it there.';
  }

  function render() {
    var V = view(), P = V.prep, R = V.rd;
    var q = typed, LIM = 8;
    function mt(h) { return !q || String(h.n).indexOf(q) >= 0; }
    var PP = P.filter(mt), RR = R.filter(mt);
    $('prepH').textContent = 'Preparing (' + P.length + ')';
    $('prepHint').textContent = q
      ? 'Showing tokens with “' + q + '”.'
      : 'Tap a token when its order is ready. The red one is the oldest.';
    var tl = $('tiles'); tl.innerHTML = '';
    if (!PP.length) {
      tl.innerHTML = '<p class="hint" style="grid-column:1/-1;margin:0">' +
        (q ? 'No preparing token matches ' + q + '.' : 'No orders preparing. New orders appear here.') +
        '</p>';
    }
    (q || showAllP ? PP : PP.slice(0, LIM)).forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'tile' + (h === P[0] ? ' first' : '');
      var b = document.createElement('button');
      b.className = 'tnum'; b.textContent = h.n;
      b.setAttribute('aria-label', 'Token ' + h.n + ' is ready');
      b.onclick = function () { callReady(h.n); };
      var x = document.createElement('button');
      x.className = 'tx'; x.textContent = 'Cancel order';
      x.setAttribute('aria-label', 'Cancel order for token ' + h.n);
      x.onclick = function () { handOver(h.n); };
      d.appendChild(b); d.appendChild(x); tl.appendChild(d);
    });
    var mp = $('moreP');
    mp.hidden = !!q || PP.length <= LIM;
    mp.textContent = showAllP ? 'Show fewer' : 'Show all ' + PP.length + ' preparing';

    $('offWrap').hidden = !R.length;
    $('readyH').textContent = 'Ready on the board (' + R.length + ')';
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
    mr.textContent = showAllR ? 'Show fewer' : 'Show all ' + RR.length + ' ready';

    drawEntry();
    $('sync').textContent = OBStore.getSyncLabel();
  }

  function press(k) {
    if (k === 'Clear') typed = '';
    else if (k === 'Delete') typed = typed.slice(0, -1);
    else if (typed.length < 4) typed = (typed + k).replace(/^0+(?=\d)/, '');
    render();
  }

  function act() {
    var n = parseInt(typed, 10);
    if (!n) return;
    var m = modeOf(n);
    typed = '';
    if (m === 'prep') callReady(n);
    else if (m === 'ready') handOver(n);
    else {
      write(n, { t: Date.now(), r: 0, c: 0 });
      toast('Token ' + n + ' added', function () { write(n, { c: Date.now() }); });
    }
  }

  function remHand() {
    var n = parseInt(typed, 10);
    if (!n) return;
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
    $('genBtn').onclick = async function () {
      var n = nextNumSync();
      if (!n) { toast('All ' + POOL + ' tokens are in use'); return; }
      write(n, { t: Date.now(), r: 0, c: 0 });
      await setNext(n + 1);
      toast('Give the customer token ' + n, function () {
        write(n, { c: Date.now() });
        setNext(n);
      });
      render();
    };
    $('genReset').onclick = async function () {
      await setNext(1);
      render();
      toast('Numbering restarts at 1');
    };
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

  async function boot() {
    if (window.OBNative) await OBNative.setupChrome();
    wireKeys();
    wireUi();

    if (window.OBNative) {
      var mode = await OBNative.initTheme();
      paintThemeBtn(mode);
    } else {
      var saved = null;
      try { saved = localStorage.getItem('ob-theme'); } catch (e) {}
      paintThemeBtn(saved === 'dark' || (!saved && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    }
    await refreshNextStart();
    OBStore.onChange(function () { render(); });
    await OBStore.init();
    render();
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
