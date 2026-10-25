(function () {
  var EXP = 20;
  var snd = false, ac = null, alertsOn = false;
  var wasReady = false, pingT = 0, lastKey = null, dismissed = false, repeat = null;
  var first = true;
  var mineCache = null;

  var $ = function (i) { return document.getElementById(i); };

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

  function buzz() {
    if (window.OBNative) OBNative.buzz();
    else if (navigator.vibrate) {
      try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }
  }

  function write(n, f) { OBStore.write(n, f); }
  function find(n) { return OBStore.find(n); }
  function view() { return OBStore.view(EXP); }
  function myTok() { return mineCache; }

  function setMine(n) {
    mineCache = n;
    OBStore.setMine(n);
  }

  function handOver(n) {
    write(n, { c: Date.now() });
  }

  function startAlert(n) {
    dismissed = false;
    $('alN').textContent = n;
    $('alert').hidden = false;
    document.title = 'Order ready: ' + n;
    chime(); buzz();
    if (window.OBNative) OBNative.notifyReady(n);
    clearInterval(repeat);
    var k = 0;
    repeat = setInterval(function () {
      if (dismissed || ++k > 5) { clearInterval(repeat); return; }
      chime(); buzz();
    }, 5000);
  }

  function stopAlert() {
    dismissed = true;
    $('alert').hidden = true;
    clearInterval(repeat);
    document.title = 'Order Board';
  }

  function render() {
    var V = view(), P = V.prep, R = V.rd, mine = myTok(), now = Date.now();
    var hn = $('heroNum'), has = R.length > 0;
    hn.textContent = has ? R[0].n : '…';
    $('heroLbl').textContent = has ? 'Latest order ready' : 'No orders ready yet';
    $('heroCtr').textContent = has ? 'Please collect from the counter' : '';
    var key = has ? R[0].n + '|' + R[0].r : null;
    if (!first && key !== null && key !== lastKey) {
      hn.classList.remove('pop'); void hn.offsetWidth; hn.classList.add('pop');
      if (mine === null || R[0].n !== mine) chime();
    }
    lastKey = key;

    var pb = $('prepbar');
    pb.hidden = !P.length;
    pb.innerHTML = '<span>Preparing</span>' + P.slice(0, 14).map(function (x) {
      return '<i>' + x.n + '</i>';
    }).join('');

    var o = mine === null ? null : find(mine);
    var isReady = !!(o && o.r && !o.c && now - o.r <= EXP * 60000);
    $('noTok').hidden = mine !== null;
    $('hasTok').hidden = mine === null;
    $('mine').className = 'mine' + (isReady ? ' isready' : '');
    var ab = $('alertsBtn'), cb = $('collBtn'), ag = $('againBtn');
    ab.hidden = true; cb.hidden = !isReady; ag.hidden = true;

    if (o) {
      $('myNum').textContent = o.n;
      var s = $('mStatus'), u = $('mSub');
      if (o.c) {
        s.textContent = 'Collected';
        u.textContent = 'Enjoy your order.';
        ag.hidden = false; ag.textContent = 'Track another order';
      } else if (isReady) {
        s.textContent = 'Your order is ready';
        u.textContent = 'Please collect it from the counter.';
      } else if (o.r) {
        s.textContent = 'Order timed out';
        u.textContent = 'Please ask at the counter.';
        ag.hidden = false; ag.textContent = 'Track another order';
      } else {
        var pi = P.findIndex(function (x) { return x.n === mine; });
        s.textContent = 'Being prepared';
        u.textContent = (pi <= 0 ? 'You’re next. ' : pi + (pi === 1 ? ' order' : ' orders') + ' ahead of you. ') +
          (alertsOn ? 'We will alert you.' : 'We can alert you when it’s ready.');
        ab.hidden = alertsOn;
      }
    } else if (mine !== null) {
      $('myNum').textContent = mine;
      $('mStatus').textContent = 'Not on the board yet';
      $('mSub').textContent = 'It shows here once staff add your token.';
      ag.hidden = false; ag.textContent = 'Change token';
    }

    if (isReady) {
      if (!wasReady || o.r !== pingT) startAlert(mine);
      pingT = o.r;
    } else if (!$('alert').hidden) stopAlert();
    wasReady = isReady;

    var g = $('grid'); g.innerHTML = '';
    if (!R.length) {
      g.style.columns = '1';
      g.innerHTML = '<div class="empty">Ready orders will appear here.</div>';
    } else {
      g.style.columns = '';
      var hs = [100, 150, 120, 180, 110, 140];
      R.forEach(function (h, i) {
        var c = document.createElement('div');
        c.className = 'pin' + (mine === h.n ? ' me' : '');
        c.style.background = 'var(--p' + (i % 6) + ')';
        c.style.minHeight = hs[i % 6] + 'px';
        var m = Math.floor((now - h.r) / 60000);
        c.innerHTML = '<span>' + (mine === h.n ? 'That’s you. ' : '') +
          (m < 1 ? 'Just now' : m + ' min ago') + '</span><b>' + h.n + '</b>';
        g.appendChild(c);
      });
    }

    $('sync').textContent = OBStore.getSyncLabel();
    first = false;
  }

  function track() {
    var n = parseInt($('tokIn').value, 10);
    if (!n || n < 1) return;
    setMine(n);
    $('tokIn').value = '';
    wasReady = false;
    render();
  }

  function wireUi() {
    $('getTok').onclick = track;
    $('tokIn').addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
    $('tokIn').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') track(); });
    $('againBtn').onclick = function () { setMine(null); render(); };
    $('collBtn').onclick = function () { var n = myTok(); if (n) handOver(n); };
    $('gotit').onclick = stopAlert;
    $('snd').onclick = function () {
      snd = !snd;
      this.setAttribute('aria-pressed', snd);
      this.textContent = snd ? 'Sound on' : 'Sound off';
      if (snd) chime();
    };
    $('alertsBtn').onclick = function () {
      alertsOn = true;
      snd = true;
      $('snd').setAttribute('aria-pressed', 'true');
      $('snd').textContent = 'Sound on';
      try {
        if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
      } catch (e) {}
      if (window.OBNative) OBNative.keepAwake(true);
      else {
        try {
          if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {});
        } catch (e) {}
      }
      chime();
      render();
    };
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && alertsOn && window.OBNative) OBNative.keepAwake(true);
    });
  }

  async function boot() {
    if (window.OBNative) await OBNative.setupChrome();
    wireUi();
    mineCache = await OBStore.getMine();
    OBStore.onChange(function () { render(); });
    await OBStore.init();
    render();
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
