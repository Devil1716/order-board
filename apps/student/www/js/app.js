(function () {
  var EXP = 20;
  var snd = true, ac = null, alertsOn = false;
  var settings = null, settingsUI = null;
  var uiReady = false, prevKinds = {};
  var notifyState = 'unsupported', notifyDismissed = false, NOTIFY_DISMISS_KEY = 'ob-notify-dismissed';
  var MAX_TOKEN = 200;
  var APP_VERSION = '1.1.0';
  var first = true, lastReadySig = null;
  var minesCache = [];
  /** Map token → readyMs already acknowledged (no re-alert until readyMs changes) */
  var ackedReady = {};
  var alertToken = null;
  var dismissed = false, repeat = null;

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
    if (settings && !settings.get('vibration')) return;
    if (window.OBNative) OBNative.buzz();
    else if (navigator.vibrate) {
      try { navigator.vibrate([300, 150, 300, 150, 300]); } catch (e) {}
    }
  }

  var toastT = null, undoFn = null;
  function toast(msg, fn) {
    $('toastMsg').textContent = msg;
    undoFn = fn || null;
    $('undo').hidden = !fn;
    $('toast').classList.toggle('has-undo', !!fn);
    $('toast').hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { $('toast').hidden = true; undoFn = null; }, fn ? 8000 : 6000);
  }

  /** Screen-reader announcement for a status change (kept out of the visual UI). */
  function announce(msg) {
    var el = $('announce');
    el.textContent = '';
    setTimeout(function () { el.textContent = msg; }, 50);
  }

  /** Resolves when the counter confirms; on rejection the store has rolled back, so just say so. */
  function write(n, f) {
    return OBStore.write(n, f).catch(function (err) {
      toast((err && err.message) || 'Could not save. Try again.');
      render();
    });
  }
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
    // The rules only let a student set `c` (never before the order's `r`) on a ready order.
    var o = find(n);
    if (window.OBNative) OBNative.watchClear(n);
    write(n, { c: Math.max(Date.now(), o ? o.r : 0) });
  }

  function startAlert(n) {
    dismissed = false;
    alertToken = n;
    $('alN').textContent = n;
    $('alert').hidden = false;
    try { $('alert').focus(); } catch (e) {}
    document.title = 'Cue · Order ready: ' + n;
    chime(); buzz();
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
    syncWatch();
  }

  /** Progress step for a token: 0 Preparing, 1 Ready, 2 Collected. */
  function stepFor(kind) {
    return kind === 'ready' || kind === 'timeout' ? 1 : kind === 'done' ? 2 : 0;
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
        age: (now - o.r < 60000) ? 'Just now' : fmtAge(now - o.r) + ' ago',
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

  var STEP_LABELS = ['Preparing', 'Ready', 'Collected'];

  function stepsEl(step) {
    var ol = document.createElement('ol');
    ol.className = 'steps';
    ol.setAttribute('aria-label', 'Order progress: ' + STEP_LABELS[step]);
    STEP_LABELS.forEach(function (label, i) {
      var li = document.createElement('li');
      li.className = i < step ? 'done' : i === step ? 'current' : '';
      if (i === step) li.setAttribute('aria-current', 'step');
      li.textContent = label;
      ol.appendChild(li);
    });
    return ol;
  }

  function removeToken(n) {
    var acked = ackedReady[n];
    OBStore.removeMine(n).then(function (next) {
      minesCache = next;
      if (alertToken === n) stopAlert();
      delete ackedReady[n];
      render();
      toast('Token ' + n + ' removed.', function () {
        OBStore.addMine(n).then(function (list) {
          minesCache = list;
          if (acked !== undefined) ackedReady[n] = acked;
          render();
        });
      });
    });
  }

  function renderMineList(P, now) {
    var list = myToks();
    var wrap = $('mineList');
    wrap.innerHTML = '';

    var multi = list.length > 1;
    wrap.className = 'mine-list' + (multi ? ' multi' : '');

    list.forEach(function (n) {
      var st = tokenState(n, P, now);
      var card = document.createElement('div');
      card.className = 'mine-card kind-' + st.kind + (st.isReady ? ' isready' : '') + (multi && !st.isReady ? ' compact' : '');
      card.setAttribute('data-token', String(n));

      var top = document.createElement('div');
      top.className = 'card-top';
      var lbl = document.createElement('span');
      lbl.className = 'lbl-tok';
      lbl.textContent = 'Token';
      var rm = document.createElement('button');
      rm.className = 'rm-btn';
      rm.type = 'button';
      rm.textContent = st.kind === 'done' ? 'Done' : 'Remove';
      rm.setAttribute('aria-label', (st.kind === 'done' ? 'Done with token ' : 'Remove token ') + n);
      rm.onclick = function () { removeToken(n); };
      top.appendChild(lbl);
      top.appendChild(rm);
      card.appendChild(top);

      var num = document.createElement('div');
      num.className = 'mytok';
      num.setAttribute('aria-label', 'Token ' + n);
      num.textContent = n;
      card.appendChild(num);

      var text = document.createElement('div');
      text.className = 'card-text';
      var s1 = document.createElement('p');
      s1.className = 'status' + (st.isReady ? ' ready' : '');
      s1.textContent = st.isReady ? 'Ready — collect it now' : st.status;
      var d = document.createElement('p');
      d.className = 'detail';
      d.textContent = [String(st.sub || '').replace(/\.$/, ''), st.age].filter(Boolean).join(' · ');
      text.appendChild(s1);
      text.appendChild(d);
      card.appendChild(text);

      card.appendChild(stepsEl(stepFor(st.kind)));

      if (st.showCollect) {
        var row = document.createElement('div');
        row.className = 'btnrow';
        var cb = document.createElement('button');
        cb.className = 'btn red';
        cb.type = 'button';
        cb.textContent = 'I’ve collected it';
        cb.onclick = function () { handOver(n); };
        row.appendChild(cb);
        card.appendChild(row);
      }
      wrap.appendChild(card);

      // Tell screen readers when a token's status changes (not on every refresh).
      if (prevKinds[n] !== undefined && prevKinds[n] !== st.kind) {
        announce('Token ' + n + ': ' + (st.isReady ? 'ready. Collect it at the counter.' : st.status + '. ' + st.sub));
      }
      prevKinds[n] = st.kind;
    });

    $('mine').className = 'mine';
    var title = $('mineTitle');
    if (title) {
      title.textContent = list.length === 1 ? 'Your order' : 'Your orders';
    }
  }

  var readyOpen = null;   // null = default (open on the entry screen, collapsed while tracking)

  function renderReadyStrip(R, now, tracking) {
    var strip = $('strip');
    var ctx = $('readyContext');
    strip.innerHTML = '';

    if (!R.length) { ctx.hidden = true; return; }
    ctx.hidden = false;
    $('readyTitle').textContent = 'Ready now · ' + R.length;
    var open = readyOpen === null ? !tracking : readyOpen;
    strip.hidden = !open;
    $('readyToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    ctx.classList.toggle('open', open);

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

  /**
   * Tell the native background watcher which tokens still need watching (so it can alert when the
   * app is closed) and which ready times the student already acknowledged. It stops itself when
   * nothing is left; we only re-send when something changed.
   */
  var lastWatch = '';
  function syncWatch() {
    if (!window.OBNative || !OBNative.hasWatcher() || !window.OBNotifyRules) return;
    var cfg = window.ORDER_BOARD_FIREBASE;
    if (!cfg || !cfg.projectId) return;
    var now = Date.now(), tokens = [], acked = {};
    myToks().forEach(function (n) {
      var o = find(n);
      var ar = ackedReady[n];
      if (typeof ar === 'number') acked[n] = ar;
      if (!OBNotifyRules.isActive(o, now)) return;
      if (o && o.r && ar === o.r) return;           // already acknowledged in the app
      tokens.push(n);
    });
    var payload = { projectId: cfg.projectId, apiKey: cfg.apiKey || '', tokens: tokens, acked: acked };
    var key = JSON.stringify(payload);
    if (key === lastWatch) return;
    lastWatch = key;
    OBNative.watchSync(payload);
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

  var retrying = false;
  function renderNet() {
    var bad = OBStore.getSyncState() === 'offline';
    $('netBanner').hidden = !bad;
    if (bad && !retrying) $('retryBtn').textContent = 'Retry';
  }

  function render() {
    if (!uiReady) return;
    var V = view(), P = V.prep, R = V.rd, now = Date.now();
    var tracking = myToks().length > 0;

    $('skeleton').hidden = true;
    $('focusEmpty').hidden = tracking;
    $('mine').hidden = !tracking;
    renderNet();

    // Soft chime when a new public ready appears (not mine)
    var sig = R.length ? R[0].n + '|' + R[0].r : null;
    if (!first && sig !== null && sig !== lastReadySig && !isMine(R[0].n)) chime();
    lastReadySig = sig;

    renderMineList(P, now);
    maybeAlert(now);
    syncWatch();
    renderReadyStrip(R, now, tracking);

    $('sync').textContent = '';   // connection state lives in the offline banner and Settings
    first = false;
  }

  function fieldMsg(id, text, kind) {
    var el = $(id);
    el.textContent = text || '';
    el.className = 'field-msg' + (text ? ' ' + (kind || 'error') : '');
  }

  function checkEntry(raw) {
    var n = parseInt(OBEntryRules.digitsOf(raw), 10);
    return OBEntryRules.validateToken(raw, {
      mines: myToks(), order: n ? find(n) : null, max: MAX_TOKEN
    });
  }

  /** Digits only, three at most, and never above the largest token: extra input is simply ignored. */
  function sanitize(input) {
    input.value = OBEntryRules.clampInput(input.value, MAX_TOKEN);
  }

  /** Keeps the button honest: it is only active when the number can be tracked. */
  function liveEntry(input, msgId, btnId) {
    sanitize(input);
    input.removeAttribute('aria-invalid');
    var res = input.value ? checkEntry(input.value) : { ok: false, code: 'empty' };
    $(btnId).disabled = !res.ok;
    if (res.ok && res.note) fieldMsg(msgId, res.note, 'note');
    else if (!res.ok && (res.code === 'duplicate' || res.code === 'limit')) fieldMsg(msgId, res.message, 'error');
    else fieldMsg(msgId, '', '');
  }

  function trackFrom(inputId, msgId, btnId) {
    var input = $(inputId);
    sanitize(input);
    var res = checkEntry(input.value);
    if (!res.ok) {
      // Nothing to say for an empty or unusable number: the button stays disabled.
      if (res.code === 'duplicate' || res.code === 'limit') fieldMsg(msgId, res.message, 'error');
      return;
    }
    fieldMsg(msgId, '', '');
    var n = res.token;
    var wasEmpty = minesCache.length === 0;
    OBStore.addMine(n).then(function (list) {
      minesCache = list;
      $('tokIn').value = '';
      $('tokInEmpty').value = '';
      $('getTok').disabled = true;
      $('getTokEmpty').disabled = true;
      input.blur();
      setAddOpen(false);
      if (res.note) toast(res.note);
      if (wasEmpty || !alertsOn) enableAlerts();
      else render();
    });
  }

  function setAddOpen(open) {
    $('addForm').hidden = !open;
    $('addToggle').hidden = open;
    $('addToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { try { $('tokIn').focus(); } catch (e) {} }
    else { fieldMsg('msgAdd', '', ''); $('tokIn').value = ''; $('getTok').disabled = true; }
  }

  /* —— Notification permission: explain first, ask when it matters (after the first order). —— */
  function refreshNotifyCard() {
    if (!window.OBNative) return Promise.resolve();
    return OBNative.notifyStatus().then(function (st) {
      notifyState = st;
      var show = myToks().length > 0 && !notifyDismissed && (st === 'prompt' || st === 'denied');
      $('notifyCard').hidden = !show;
      if (show) {
        var denied = st === 'denied';
        $('notifyTitle').textContent = denied ? 'Alerts are off' : 'Turn on alerts';
        $('notifySub').textContent = denied
          ? 'Turn them on in settings so you don’t miss your order.'
          : 'Get notified when your order is ready, even if Cue is closed.';
        $('notifyAllow').textContent = denied ? 'Open settings' : 'Turn on';
      }
    });
  }

  function askNotifyPermission() {
    refreshNotifyCard();
    showBatteryHint();
  }

  /** Samsung and others stop background apps: Settings offers the one-tap "don't optimise Cue" dialog. */
  function showBatteryHint() {
    if (settingsUI) settingsUI.refresh();
  }

  function enableAlerts() {
    alertsOn = true;
    askNotifyPermission();
    if (window.OBNative) OBNative.keepAwake(true);
    else {
      try {
        if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(function () {});
      } catch (e) {}
    }
    chime();
    render();
  }

  function wireUi() {
    $('getTok').onclick = function () { trackFrom('tokIn', 'msgAdd'); };
    $('getTokEmpty').onclick = function () { trackFrom('tokInEmpty', 'msgEmpty'); };
    $('tokIn').addEventListener('input', function () { liveEntry(this, 'msgAdd', 'getTok'); });
    $('tokInEmpty').addEventListener('input', function () { liveEntry(this, 'msgEmpty', 'getTokEmpty'); });
    $('addToggle').onclick = function () { setAddOpen(true); };
    $('readyToggle').onclick = function () {
      var open = $('strip').hidden;
      readyOpen = open;
      $('strip').hidden = !open;
      $('readyContext').classList.toggle('open', open);
      this.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    $('undo').onclick = function () {
      $('toast').hidden = true;
      var fn = undoFn; undoFn = null;
      if (fn) fn();
    };
    $('retryBtn').onclick = function () {
      if (retrying) return;
      retrying = true;
      this.textContent = 'Retrying…';
      OBStore.retry().then(function () {
        setTimeout(function () { retrying = false; renderNet(); }, 1200);
      });
    };
    $('notifyAllow').onclick = function () {
      if (notifyState === 'denied') OBNative.openNotificationSettings();
      else OBNative.requestNotifyPermission().then(function () { setTimeout(refreshNotifyCard, 400); if (settingsUI) settingsUI.refresh(); });
    };
    $('notifyLater').onclick = function () {
      notifyDismissed = true;
      OBNative.prefsSet(NOTIFY_DISMISS_KEY, '1');
      $('notifyCard').hidden = true;
    };
    $('tokIn').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') trackFrom('tokIn', 'msgAdd'); });
    $('tokInEmpty').addEventListener('keydown', function (ev) { if (ev.key === 'Enter') trackFrom('tokInEmpty', 'msgEmpty'); });
    $('gotit').onclick = function () {
      stopAlert();
      render();
    };
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (alertsOn && window.OBNative) OBNative.keepAwake(true);
      // Back on screen: ready orders are shown in-app now, so drop their system notifications.
      if (window.OBNative) OBNative.watchClearAll();
      refreshNotifyCard();
      render();
    });
  }

  async function boot() {
    if (window.OBNative) await OBNative.setupChrome();
    wireUi();
    // UI is up: confirm this web bundle booted (else the updater rolls back), then look for an OTA update.
    if (window.OBOta) OBOta.init(window).start();

    await OBNative.initTheme();
    settings = OBSettings.create({ get: OBNative.prefsGet, set: OBNative.prefsSet }, { sound: true, vibration: true });
    await settings.load();
    snd = settings.get('sound');
    settingsUI = OBSettingsUI.init({
      settings: settings,
      appName: 'Cue',
      version: APP_VERSION,
      onChange: function (key, on) { if (key === 'sound') { snd = on; if (on) chime(); } }
    });
    minesCache = await OBStore.getMines();
    $('skelEntry').hidden = minesCache.length > 0;
    $('skelTrack').hidden = minesCache.length === 0;
    notifyDismissed = (await OBNative.prefsGet(NOTIFY_DISMISS_KEY)) === '1';
    if (minesCache.length && !alertsOn) {
      alertsOn = true;
      if (window.OBNative) OBNative.keepAwake(true);
    }
    OBStore.onChange(function () { render(); });
    // Show the skeleton while the counter connects, but never leave the screen blank for long.
    await Promise.race([OBStore.init(), new Promise(function (r) { setTimeout(r, 3000); })]);
    uiReady = true;
    render();
    refreshNotifyCard();
    showBatteryHint();
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
