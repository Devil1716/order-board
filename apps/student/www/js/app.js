(function () {
  var EXP = 20;
  var snd = false, ac = null, alertsOn = false;
  var first = true, lastReadySig = null;
  var minesCache = [];
  /** Map token → readyMs already acknowledged (no re-alert until readyMs changes) */
  var ackedReady = {};
  var alertToken = null;
  var dismissed = false, repeat = null;

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

  function buzz() {
    if (window.OBNative) OBNative.buzz();
    else if (navigator.vibrate) {
      try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }
  }

  function write(n, f) { OBStore.write(n, f); }
  function find(n) { return OBStore.find(n); }
  function view() { return OBStore.view(EXP); }
  function myToks() { return minesCache.slice(); }
  function isMine(n) { return minesCache.indexOf(n) !== -1; }

  function fmtAge(ms) {
    var m = Math.floor(ms / 60000);
    if (m < 1) return 'Just now';
    if (m === 1) return '1 min';
    return m + ' min';
  }

  function handOver(n) {
    write(n, { c: Date.now() });
  }

  function startAlert(n) {
    dismissed = false;
    alertToken = n;
    $('alN').textContent = n;
    $('alert').hidden = false;
    document.title = 'Cue · Order ready: ' + n;
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
    if (alertToken != null) {
      var o = find(alertToken);
      if (o && o.r) ackedReady[alertToken] = o.r;
      else ackedReady[alertToken] = true;
    }
    alertToken = null;
    $('alert').hidden = true;
    clearInterval(repeat);
    document.title = 'Cue';
  }

  /** Primary status labels: Preparing / You’re next / Ready */
  function tokenState(n, P, now) {
    var o = find(n);
    var isReady = !!(o && o.r && !o.c && now - o.r <= EXP * 60000);
    if (!o) {
      return {
        isReady: false,
        status: 'Waiting',
        sub: 'Staff haven’t added this token yet.',
        age: '',
        showCollect: false,
        kind: 'wait'
      };
    }
    if (o.c) {
      return {
        isReady: false,
        status: 'Collected',
        sub: 'Enjoy your food.',
        age: '',
        showCollect: false,
        kind: 'done'
      };
    }
    if (isReady) {
      return {
        isReady: true,
        status: 'Ready',
        sub: 'Collect it at the counter.',
        age: 'Ready ' + fmtAge(now - o.r),
        showCollect: true,
        kind: 'ready'
      };
    }
    if (o.r) {
      return {
        isReady: false,
        status: 'Timed out',
        sub: 'Ask at the counter.',
        age: '',
        showCollect: false,
        kind: 'timeout'
      };
    }
    var pi = P.findIndex(function (x) { return x.n === n; });
    if (pi <= 0) {
      return {
        isReady: false,
        status: 'You’re next',
        sub: 'Almost there — hang tight.',
        age: fmtAge(now - o.t) + ' in queue',
        showCollect: false,
        kind: 'next'
      };
    }
    var ahead = pi === 1 ? '1 order ahead.' : pi + ' orders ahead.';
    return {
      isReady: false,
      status: 'Preparing',
      sub: ahead,
      age: fmtAge(now - o.t) + ' in queue',
      showCollect: false,
      kind: 'prep'
    };
  }

  function renderMineList(P, now) {
    var list = myToks();
    var wrap = $('mineList');
    var anyReady = false;
    wrap.innerHTML = '';

    list.forEach(function (n) {
      var st = tokenState(n, P, now);
      if (st.isReady) anyReady = true;
      var card = document.createElement('div');
      card.className = 'mine-card' + (st.isReady ? ' isready' : '');
      card.setAttribute('data-token', String(n));

      var head = document.createElement('div');
      head.className = 'mine-card-head';
      head.innerHTML = '<p class="lbl-tok">Token</p><div class="mytok">' + n + '</div>';
      card.appendChild(head);

      var s = document.createElement('p');
      s.className = 'status' + (st.isReady ? ' ready' : '');
      s.textContent = st.status;
      card.appendChild(s);

      if (st.age) {
        var age = document.createElement('p');
        age.className = 'age';
        age.textContent = st.age;
        card.appendChild(age);
      }

      var u = document.createElement('p');
      u.className = 'sub';
      u.textContent = st.sub;
      card.appendChild(u);

      var row = document.createElement('div');
      row.className = 'btnrow';

      if (st.showCollect) {
        var cb = document.createElement('button');
        cb.className = 'btn red';
        cb.type = 'button';
        cb.textContent = 'I’ve collected';
        cb.onclick = function () { handOver(n); };
        row.appendChild(cb);
      }

      var rm = document.createElement('button');
      rm.className = 'btn' + (st.showCollect ? ' ghost' : '');
      rm.type = 'button';
      rm.textContent = 'Remove';
      rm.onclick = function () {
        OBStore.removeMine(n).then(function (next) {
          minesCache = next;
          if (alertToken === n) stopAlert();
          delete ackedReady[n];
          render();
        });
      };
      row.appendChild(rm);
      card.appendChild(row);
      wrap.appendChild(card);
    });

    $('mine').className = 'mine' + (anyReady ? ' isready' : '');
    var title = $('mineTitle');
    if (title) {
      title.textContent = list.length === 1 ? 'Your order' : 'Your orders';
    }
  }

  function renderReadyStrip(R, now, tracking) {
    var strip = $('strip');
    var ctx = $('readyContext');
    var title = $('readyTitle');
    strip.innerHTML = '';

    if (!R.length) {
      if (!tracking) {
        // Empty + not tracking: hide the strip entirely — focus is enter-token
        ctx.hidden = true;
        return;
      }
      ctx.hidden = false;
      title.textContent = 'What’s ready';
      var empty = document.createElement('p');
      empty.className = 'strip-empty';
      empty.textContent = 'Nothing ready yet.';
      strip.appendChild(empty);
      return;
    }

    ctx.hidden = false;
    title.textContent = tracking ? 'Also ready' : 'What’s ready';

    R.slice(0, 12).forEach(function (h, i) {
      var chip = document.createElement('span');
      var mine = isMine(h.n);
      chip.className = 'strip-chip' + (mine ? ' me' : '') + (i === 0 && !mine ? ' latest' : '');
      chip.textContent = h.n;
      chip.title = (mine ? 'Yours · ' : '') + fmtAge(now - h.r) + ' ago';
      strip.appendChild(chip);
    });

    if (R.length > 12) {
      var more = document.createElement('span');
      more.className = 'strip-meta';
      more.textContent = '+' + (R.length - 12) + ' more';
      strip.appendChild(more);
    }
  }

  function maybeAlert(now) {
    var pending = null;
    myToks().forEach(function (n) {
      var o = find(n);
      var isReady = !!(o && o.r && !o.c && now - o.r <= EXP * 60000);
      if (!isReady) return;
      if (ackedReady[n] === o.r) return;
      if (pending === null) pending = n;
    });

    if (pending != null) {
      if (alertToken !== pending || $('alert').hidden) startAlert(pending);
    } else if (!$('alert').hidden) {
      stopAlert();
    }
  }

  function render() {
    var V = view(), P = V.prep, R = V.rd, now = Date.now();
    var tracking = myToks().length > 0;

    $('focusEmpty').hidden = tracking;
    $('mine').hidden = !tracking;

    // Soft chime when a new public ready appears (not mine)
    var sig = R.length ? R[0].n + '|' + R[0].r : null;
    if (!first && sig !== null && sig !== lastReadySig && !isMine(R[0].n)) chime();
    lastReadySig = sig;

    renderMineList(P, now);
    maybeAlert(now);
    renderReadyStrip(R, now, tracking);

    $('sync').textContent = OBStore.getSyncLabel();
    first = false;
  }

  function trackFrom(inputId) {
    var n = parseInt($(inputId).value, 10);
    if (!n || n < 1) return;
    var wasEmpty = minesCache.length === 0;
    OBStore.addMine(n).then(function (list) {
      minesCache = list;
      $(inputId).value = '';
      if ($('tokIn')) $('tokIn').value = '';
      if ($('tokInEmpty')) $('tokInEmpty').value = '';
      if (wasEmpty || !alertsOn) enableAlerts();
      else render();
    });
  }

  function enableAlerts() {
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
  }

  function wireInput(el) {
    if (!el) return;
    el.addEventListener('input', function () { this.value = this.value.replace(/\D/g, ''); });
  }

  function wireUi() {
    $('getTok').onclick = function () { trackFrom('tokIn'); };
    $('getTokEmpty').onclick = function () { trackFrom('tokInEmpty'); };
    wireInput($('tokIn'));
    wireInput($('tokInEmpty'));
    $('tokIn').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') trackFrom('tokIn'); });
    $('tokInEmpty').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') trackFrom('tokInEmpty'); });
    $('gotit').onclick = function () {
      stopAlert();
      render();
    };
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

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && alertsOn && window.OBNative) OBNative.keepAwake(true);
    });
  }

  async function boot() {
    if (window.OBNative) await OBNative.setupChrome();
    wireUi();

    if (window.OBNative) {
      var mode = await OBNative.initTheme();
      paintThemeBtn(mode);
    } else {
      var saved = null;
      try { saved = localStorage.getItem('ob-theme'); } catch (e) {}
      paintThemeBtn(saved === 'dark' || (!saved && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
    }
    minesCache = await OBStore.getMines();
    if (minesCache.length && !alertsOn) {
      alertsOn = true;
      snd = true;
      if ($('snd')) {
        $('snd').setAttribute('aria-pressed', 'true');
        $('snd').textContent = 'Sound on';
      }
      try {
        if (window.Notification && Notification.permission === 'default') Notification.requestPermission();
      } catch (e) {}
      if (window.OBNative) OBNative.keepAwake(true);
    }
    OBStore.onChange(function () { render(); });
    await OBStore.init();
    render();
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
