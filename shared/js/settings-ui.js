/**
 * Settings screen wiring shared by the student and staff apps. Each app's index.html provides
 * the markup (#v-settings and the header buttons); rows an app doesn't have are simply skipped.
 * The screen is a hash route (#settings) so the browser back button and the Android back button
 * (Capacitor App 'backButton') both return to the main screen.
 */
(function (global) {
  var HASH = '#settings';
  var $ = function (id) { return document.getElementById(id); };

  function init(opts) {
    var settings = opts.settings;
    var N = global.OBNative, S = global.OBStore;
    var pushed = false;

    function isOpen() { return document.body.classList.contains('settings-open'); }

    function paintOpen(open) {
      document.body.classList.toggle('settings-open', open);
      var logo = document.querySelector('.top .logo');
      if (logo) logo.hidden = open;
      $('settingsBtn').hidden = open;
      $('settingsBack').hidden = !open;
      $('settingsTitle').hidden = !open;
      if (open) { global.scrollTo(0, 0); refresh(); }
    }

    function open() { if (!isOpen()) { pushed = true; global.location.hash = HASH; } }

    function close() {
      if (!isOpen()) return;
      if (pushed && global.location.hash === HASH) { pushed = false; global.history.back(); return; }
      global.history.replaceState(null, '', global.location.pathname + global.location.search);
      paintOpen(false);
    }

    function paintSwitch(id, on) {
      var b = $(id);
      if (b) b.setAttribute('aria-checked', on ? 'true' : 'false');
    }

    async function paintTheme() {
      var seg = $('themeSeg');
      if (!seg || !N) return;
      var mode = await N.getThemeMode();
      Array.prototype.forEach.call(seg.querySelectorAll('[data-mode]'), function (b) {
        b.setAttribute('aria-checked', b.getAttribute('data-mode') === mode ? 'true' : 'false');
      });
    }

    function paintSync() {
      if ($('setSync') && S) $('setSync').textContent = S.getSyncLabel();
    }

    function paintAccount() {
      if (!$('setAccount') || !S) return;
      var email = S.staffEmail ? S.staffEmail() : '';
      $('setAccount').textContent = email || 'Not signed in';
      $('rowSignOut').hidden = !email;
    }

    var attention = false;
    async function paintAlerts() {
      var needs = false;
      if ($('rowNotify') && N) {
        var st = await N.notifyStatus();
        var sub = $('notifyState'), btn = $('notifyBtn');
        $('rowNotify').hidden = false;
        btn.hidden = false;
        btn.setAttribute('data-state', st);
        if (st === 'granted') { sub.textContent = 'On — you’ll hear when your order is ready.'; btn.hidden = true; }
        else if (st === 'denied') { sub.textContent = 'Off — allow them in system settings.'; btn.textContent = 'Open settings'; needs = true; }
        else if (st === 'prompt') { sub.textContent = 'Not allowed yet.'; btn.textContent = 'Allow'; }
        else { sub.textContent = 'Not available here.'; btn.hidden = true; }
      }
      if ($('rowBg')) {
        var show = !!(N && N.hasWatcher());
        $('rowBg').hidden = !show;
        if (show) {
          var r = await N.batteryStatus();
          var ok = !!(r && r.unrestricted);
          $('bgState').textContent = ok ? 'Allowed — alerts arrive even when Cue is closed.' : 'Restricted — alerts may be late when Cue is closed.';
          $('bgBtn').hidden = ok;
          if (!ok) needs = true;
        }
      }
      attention = needs;
      $('settingsBtn').classList.toggle('dot', attention);
    }

    function refresh() {
      paintTheme();
      paintSwitch('setSound', settings.get('sound'));
      paintSwitch('setVibration', settings.get('vibration'));
      paintSync();
      paintAccount();
      return paintAlerts();
    }

    // header + navigation
    $('settingsBtn').onclick = open;
    $('settingsBack').onclick = close;
    global.addEventListener('hashchange', function () { paintOpen(global.location.hash === HASH); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && isOpen()) close(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
    var App = N && N.isNative && N.plugin('App');
    if (App && App.addListener) {
      App.addListener('backButton', function () {
        if (isOpen()) close();
        else if (App.exitApp) App.exitApp();
      });
    }

    // rows
    var seg = $('themeSeg');
    if (seg) {
      seg.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('[data-mode]');
        if (!b) return;
        N.setThemeMode(b.getAttribute('data-mode')).then(paintTheme);
      });
    }
    ['sound', 'vibration'].forEach(function (key) {
      var el = $(key === 'sound' ? 'setSound' : 'setVibration');
      if (!el) return;
      el.onclick = function () {
        var on = !settings.get(key);
        settings.set(key, on).then(function () {
          paintSwitch(el.id, on);
          if (opts.onChange) opts.onChange(key, on);
        });
      };
    });
    if ($('notifyBtn')) {
      $('notifyBtn').onclick = async function () {
        var st = this.getAttribute('data-state');
        if (st === 'denied') await N.openNotificationSettings();
        else await N.requestNotifyPermission();
        setTimeout(paintAlerts, 800);
      };
    }
    if ($('bgBtn')) {
      $('bgBtn').onclick = function () {
        N.requestBatteryExemption().then(function () { setTimeout(paintAlerts, 1500); });
      };
    }
    if ($('signOutBtn')) {
      $('signOutBtn').onclick = async function () {
        this.disabled = true;
        try { await S.signOutStaff(); } catch (e) {}
        global.location.replace(global.location.pathname + global.location.search);
      };
    }
    if (S) S.onChange(function () { paintSync(); });

    // about
    if ($('aboutName')) $('aboutName').textContent = opts.appName;
    if ($('aboutVersion')) {
      $('aboutVersion').textContent = opts.version;
      if (App && App.getInfo) App.getInfo().then(function (i) { if (i && i.version) $('aboutVersion').textContent = i.version; }).catch(function () {});
    }

    paintOpen(global.location.hash === HASH);
    paintAlerts();
    return { open: open, close: close, isOpen: isOpen, refresh: refresh };
  }

  global.OBSettingsUI = { init: init };
})(window);
