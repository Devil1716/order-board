/**
 * Orders store: always local-first. Optionally mirrors to Firestore when
 * window.ORDER_BOARD_FIREBASE is configured.
 *
 * Order shape: { n: number, t: createdMs, r: readyMs|0, c: collectedMs|0 }
 * Firestore docs keyed by String(n) with fields { t, r, c }.
 */
(function (global) {
  var ORDERS_KEY = 'ob-orders-v1';
  var NEXT_KEY = 'ob-next';
  var MINE_KEY = 'ob-mine';
  var MINES_KEY = 'ob-mines-v1';
  var H4 = 4 * 3600000;

  var orders = [];
  var listeners = [];
  var col = null;
  var firebaseReady = false;
  var syncLabel = 'On this phone only — connect Firebase to sync with the counter.';
  var unsub = null;

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(orders.slice()); } catch (e) {}
    });
  }

  function persistLocal() {
    try {
      localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
    } catch (e) {}
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(ORDERS_KEY);
      if (!raw) return;
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        orders = arr.map(function (o) {
          return { n: +o.n, t: +o.t || 0, r: +o.r || 0, c: +o.c || 0 };
        }).filter(function (o) { return o.n > 0; });
      }
    } catch (e) {}
  }

  function pruneStale() {
    var now = Date.now();
    orders = orders.filter(function (o) { return now - o.t <= H4; });
  }

  function writeLocal(n, fields) {
    var o = null, i;
    for (i = 0; i < orders.length; i++) if (orders[i].n === n) o = orders[i];
    if (!o) {
      o = { n: n, t: Date.now(), r: 0, c: 0 };
      orders.push(o);
    }
    Object.keys(fields).forEach(function (k) { o[k] = fields[k]; });
    pruneStale();
    persistLocal();
    emit();
    if (col) {
      col.doc(String(n)).set({ t: o.t, r: o.r, c: o.c }).catch(function () {
        // Surface via sync label; UI may toast
        syncLabel = 'Could not sync. Check connection — local copy is safe.';
        emit();
      });
    }
    return o;
  }

  async function initFirebase() {
    var cfg = global.ORDER_BOARD_FIREBASE;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
    try {
      // Dynamic import from CDN so web+Capacitor both work without bundler
      var appMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js');
      var fsMod = await import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js');
      var app = appMod.initializeApp(cfg);
      var db = fsMod.getFirestore(app);
      var collection = fsMod.collection;
      var doc = fsMod.doc;
      var setDoc = fsMod.setDoc;
      var onSnapshot = fsMod.onSnapshot;

      // Adapter mimicking { doc(id).set(data), onSnapshot }
      var collectionRef = collection(db, 'orders');
      col = {
        doc: function (id) {
          return {
            set: function (data) {
              return setDoc(doc(collectionRef, id), data, { merge: true });
            }
          };
        },
        onSnapshot: function (ok, err) {
          return onSnapshot(collectionRef, function (snap) {
            ok({
              docs: snap.docs.map(function (d) {
                return { id: d.id, data: function () { return d.data(); } };
              })
            });
          }, err || function () {});
        }
      };

      unsub = col.onSnapshot(function (q) {
        orders = q.docs.map(function (d) {
          var v = d.data() || {};
          return { n: +d.id, t: +v.t || 0, r: +v.r || 0, c: +v.c || 0 };
        });
        pruneStale();
        persistLocal();
        firebaseReady = true;
        syncLabel = 'Live with the counter.';
        emit();
      }, function () {
        syncLabel = 'Firestore error — using local copy.';
        emit();
      });
      return true;
    } catch (e) {
      console.warn('Firebase init failed', e);
      syncLabel = 'Couldn’t reach the cloud — still works on this phone.';
      return false;
    }
  }

  var Store = {
    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (x) { return x !== fn; });
      };
    },
    getOrders: function () { return orders.slice(); },
    getSyncLabel: function () { return syncLabel; },
    isFirebase: function () { return !!col; },
    write: function (n, fields) { return writeLocal(n, fields); },
    find: function (n) {
      var now = Date.now();
      for (var i = 0; i < orders.length; i++) {
        if (orders[i].n === n && now - orders[i].t <= H4) return orders[i];
      }
      return null;
    },
    view: function (expMin) {
      var EXP = (expMin || 20) * 60000;
      var now = Date.now(), prep = [], rd = [];
      orders.forEach(function (o) {
        if (now - o.t > H4 || o.c) return;
        if (o.r) {
          if (now - o.r <= EXP) rd.push(o);
        } else prep.push(o);
      });
      prep.sort(function (a, b) { return a.t - b.t; });
      rd.sort(function (a, b) { return b.r - a.r; });
      return { prep: prep, rd: rd };
    },
    async getMines() {
      var raw = await global.OBNative.prefsGet(MINES_KEY);
      if (raw === null || raw === undefined || raw === '') {
        try { raw = localStorage.getItem(MINES_KEY); } catch (e) { raw = null; }
      }
      if (raw) {
        try {
          var arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            return arr.map(function (x) { return +x; }).filter(function (n) {
              return n >= 1 && n === n;
            }).filter(function (n, i, a) { return a.indexOf(n) === i; });
          }
        } catch (e) {}
      }
      // Migrate legacy single ob-mine
      var legacy = await global.OBNative.prefsGet(MINE_KEY);
      if (legacy === null || legacy === undefined || legacy === '') {
        try { legacy = localStorage.getItem(MINE_KEY); } catch (e) { legacy = null; }
      }
      if (legacy) {
        var n = +legacy;
        if (n >= 1) {
          await Store.setMines([n]);
          return [n];
        }
      }
      return [];
    },
    async setMines(arr) {
      var list = (arr || []).map(function (x) { return +x; }).filter(function (n) {
        return n >= 1 && n === n;
      }).filter(function (n, i, a) { return a.indexOf(n) === i; });
      if (!list.length) {
        await global.OBNative.prefsRemove(MINES_KEY);
        await global.OBNative.prefsRemove(MINE_KEY);
        try {
          localStorage.removeItem(MINES_KEY);
          localStorage.removeItem(MINE_KEY);
        } catch (e) {}
        return [];
      }
      var payload = JSON.stringify(list);
      await global.OBNative.prefsSet(MINES_KEY, payload);
      await global.OBNative.prefsSet(MINE_KEY, String(list[0]));
      try {
        localStorage.setItem(MINES_KEY, payload);
        localStorage.setItem(MINE_KEY, String(list[0]));
      } catch (e) {}
      return list;
    },
    async addMine(n) {
      n = +n;
      if (!n || n < 1) return Store.getMines();
      var list = await Store.getMines();
      if (list.indexOf(n) === -1) list.push(n);
      return Store.setMines(list);
    },
    async removeMine(n) {
      n = +n;
      var list = await Store.getMines();
      return Store.setMines(list.filter(function (x) { return x !== n; }));
    },
    async getMine() {
      var list = await Store.getMines();
      return list.length ? list[0] : null;
    },
    async setMine(n) {
      if (n === null || n === undefined) return Store.setMines([]);
      return Store.setMines([+n]);
    },
    async getNextStart() {
      var raw = await global.OBNative.prefsGet(NEXT_KEY);
      if (!raw) {
        try { raw = localStorage.getItem(NEXT_KEY); } catch (e) {}
      }
      try {
        var v = raw ? JSON.parse(raw) : null;
        return v && v.n >= 1 && v.n <= 150 ? v.n : 1;
      } catch (e) { return 1; }
    },
    async setNext(n) {
      var payload = JSON.stringify({ n: n > 150 ? 1 : n });
      await global.OBNative.prefsSet(NEXT_KEY, payload);
      try { localStorage.setItem(NEXT_KEY, payload); } catch (e) {}
    },
    init: async function () {
      loadLocal();
      pruneStale();
      emit();
      await initFirebase();
      if (!col) {
        syncLabel = 'On this phone only — connect Firebase to sync with the counter.';
        emit();
      }
    }
  };

  global.OBStore = Store;
})(window);
