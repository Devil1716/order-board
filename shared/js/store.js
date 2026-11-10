/**
 * Orders store: always local-first. Optionally mirrors to Firestore when
 * window.ORDER_BOARD_FIREBASE is configured.
 *
 * Order shape: { n: number, t: createdMs, r: readyMs|0, c: collectedMs|0 }
 * Firestore docs keyed by String(n) with fields { t, r, c } (see firestore.rules).
 *
 * Firebase mode mirrors ios/CueCore/.../FirestoreBoardStore.swift:
 *  - writes resolve only after Firestore confirms; a rejected write rolls back
 *    the optimistic local change and rejects with a friendly Error
 *  - tokens are issued by a transaction on counters/token_counter
 *    ({ next, version, updatedAt }) that also creates the order document
 */
(function (global) {
  var ORDERS_KEY = 'ob-orders-v1';
  var NEXT_KEY = 'ob-next';
  var MINE_KEY = 'ob-mine';
  var MINES_KEY = 'ob-mines-v1';
  var H4 = 4 * 3600000;
  var LABEL_LOCAL = 'On this phone only — connect Firebase to sync with the counter.';
  var LABEL_LIVE = 'Live with the counter.';
  var OFFLINE_AFTER_MS = 8000;
  var ERROR_LABEL_MS = 10000;

  var TR = global.OBTokenRules;
  var orders = [];
  var listeners = [];
  var fb = null;                 // { fs, db, ordersRef, counterRef } once Firestore is attached
  var syncLabel = LABEL_LOCAL;
  var errorLabelUntil = 0;
  var unsubOrders = null;
  var unsubCounter = null;
  var firebaseModules = null;
  var nextStart = 1;             // cached counter value (Firestore or this phone)
  var localVersion = 0;          // stands in for counter `version` when local-only
  var writeSeq = {};

  function emit() {
    listeners.forEach(function (fn) {
      try { fn(orders.slice()); } catch (e) {}
    });
  }

  function setLabel(text, holdMs) {
    syncLabel = text;
    errorLabelUntil = holdMs ? Date.now() + holdMs : 0;
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

  function rawFind(n) {
    for (var i = 0; i < orders.length; i++) if (orders[i].n === n) return orders[i];
    return null;
  }

  function liveFind(n) {
    var o = rawFind(n);
    return o && Date.now() - o.t <= H4 ? o : null;
  }

  /** Optimistic local change. Returns { order, prev } (prev = copy of the old live order or null). */
  function applyLocal(n, fields) {
    var live = liveFind(n);
    var prev = live ? { n: live.n, t: live.t, r: live.r, c: live.c } : null;
    var o = rawFind(n);
    if (!o) {
      o = { n: n, t: Date.now(), r: 0, c: 0 };
      orders.push(o);
    }
    Object.keys(fields).forEach(function (k) { o[k] = fields[k]; });
    pruneStale();
    persistLocal();
    emit();
    return { order: o, prev: prev };
  }

  function rollbackLocal(n, prev, expected) {
    var o = rawFind(n);
    if (!o || o.t !== expected.t || o.r !== expected.r || o.c !== expected.c) return;
    orders = orders.filter(function (x) { return x.n !== n; });
    if (prev) orders.push({ n: prev.n, t: prev.t, r: prev.r, c: prev.c });
    persistLocal();
  }

  /** Same payload rules as FirestoreBoardStore.write: partial update for status changes. */
  function buildPayload(fields, prev, order) {
    if (fields.t != null) {
      return { t: fields.t, r: fields.r || 0, c: fields.c || 0 };
    }
    if (!prev) return { t: order.t, r: order.r, c: order.c };
    var data = {};
    if (fields.r != null) data.r = fields.r;
    if (fields.c != null) data.c = fields.c;
    return data;
  }

  function explain(err) {
    var code = err && err.code ? String(err.code).replace(/^firestore\//, '') : '';
    var msg;
    if (code === 'permission-denied') {
      msg = global.ORDER_BOARD_STAFF_APP
        ? 'Not allowed — sign in again with a staff account.'
        : 'The counter couldn’t accept that. The order may not be ready, or was already handed over.';
    } else if (code === 'unavailable' || code === 'deadline-exceeded') {
      msg = 'No connection to the counter. Try again.';
    } else {
      msg = (err && err.message) || 'Could not save. Try again.';
    }
    var e = new Error(msg);
    e.code = code;
    e.cause = err;
    return e;
  }

  /** Write one order. Resolves once confirmed (or immediately when local-only). */
  function write(n, fields) {
    var change = applyLocal(n, fields);
    var o = change.order;
    if (!fb) return Promise.resolve(o);

    var seq = writeSeq[n] = (writeSeq[n] || 0) + 1;
    var expected = { t: o.t, r: o.r, c: o.c };
    var data = buildPayload(fields, change.prev, o);
    var docRef = fb.fs.doc(fb.ordersRef, String(n));
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      setLabel('Offline — changes will sync when you reconnect.');
      emit();
    }, OFFLINE_AFTER_MS);

    return fb.fs.setDoc(docRef, data, { merge: true }).then(function () {
      settled = true;
      clearTimeout(timer);
      if (Date.now() >= errorLabelUntil) setLabel(LABEL_LIVE);
      emit();
      return o;
    }, function (err) {
      settled = true;
      clearTimeout(timer);
      // A newer write to the same token owns the local copy now.
      if (writeSeq[n] === seq) rollbackLocal(n, change.prev, expected);
      var e = explain(err);
      setLabel('Could not sync. ' + e.message, ERROR_LABEL_MS);
      emit();
      throw e;
    });
  }

  function counterData(snap) {
    return snap && snap.exists() ? (snap.data() || {}) : {};
  }

  /** Remember the counter locally so the next start survives a restart. */
  function cacheNextStart(n) {
    nextStart = TR.normalizeStart(n);
    var payload = JSON.stringify({ n: nextStart });
    try {
      if (global.OBNative) global.OBNative.prefsSet(NEXT_KEY, payload);
    } catch (e) {}
    try { localStorage.setItem(NEXT_KEY, payload); } catch (e) {}
  }

  async function readCachedNextStart() {
    var raw = null;
    try { raw = global.OBNative ? await global.OBNative.prefsGet(NEXT_KEY) : null; } catch (e) {}
    if (!raw) {
      try { raw = localStorage.getItem(NEXT_KEY); } catch (e) {}
    }
    try {
      var v = raw ? JSON.parse(raw) : null;
      return TR.normalizeStart(v && v.n);
    } catch (e) { return 1; }
  }

  async function runCounterTransaction(update) {
    var now = Date.now();
    return fb.fs.runTransaction(fb.db, async function (tx) {
      var data = counterData(await tx.get(fb.counterRef));
      var version = +data.version || 0;
      return update(tx, data, version, now);
    });
  }

  async function issueNext() {
    var now = Date.now();
    if (!fb) {
      var start = nextStart;
      var pick = TR.chooseTokenSync(start, liveFind, now);
      if (!pick) throw allInUse();
      applyLocal(pick.token, { t: now, r: 0, c: 0 });
      localVersion += 1;
      cacheNextStart(pick.nextStart);
      emit();
      return { token: pick.token, previousStart: start, nextStart: pick.nextStart, counterVersion: localVersion };
    }
    var alloc = await fb.fs.runTransaction(fb.db, async function (tx) {
      var data = counterData(await tx.get(fb.counterRef));
      var currentStart = TR.normalizeStart(data.next);
      var version = +data.version || 0;
      var pick = await TR.chooseToken(currentStart, async function (n) {
        var snap = await tx.get(fb.fs.doc(fb.ordersRef, String(n)));
        return snap.exists() ? snap.data() : null;
      }, now);
      if (!pick) throw allInUse();
      tx.set(fb.counterRef, { next: pick.nextStart, version: version + 1, updatedAt: now }, { merge: true });
      tx.set(fb.fs.doc(fb.ordersRef, String(pick.token)), { t: now, r: 0, c: 0 }, { merge: true });
      return {
        token: pick.token,
        previousStart: currentStart,
        nextStart: pick.nextStart,
        counterVersion: version + 1
      };
    }).catch(function (err) {
      throw err && err.code === 'all-in-use' ? err : explain(err);
    });
    applyLocal(alloc.token, { t: now, r: 0, c: 0 });
    cacheNextStart(alloc.nextStart);
    setLabel(LABEL_LIVE);
    emit();
    return alloc;
  }

  function allInUse() {
    var e = new Error('All ' + TR.MAX_TOKEN + ' tokens are in use');
    e.code = 'all-in-use';
    return e;
  }

  async function setNextStart(n) {
    var safe = TR.isValidToken(+n) ? +n : 1;
    if (!fb) {
      localVersion += 1;
      cacheNextStart(safe);
      return safe;
    }
    try {
      await runCounterTransaction(function (tx, data, version, now) {
        tx.set(fb.counterRef, { next: safe, version: version + 1, updatedAt: now }, { merge: true });
      });
    } catch (err) { throw explain(err); }
    cacheNextStart(safe);
    return safe;
  }

  /** Put the counter back after an undo — only if nobody else moved it since (version check). */
  async function restoreNextStart(alloc) {
    if (!fb) {
      if (localVersion !== alloc.counterVersion) return false;
      localVersion += 1;
      cacheNextStart(alloc.previousStart);
      return true;
    }
    var restored;
    try {
      restored = await runCounterTransaction(function (tx, data, version, now) {
        if (version !== alloc.counterVersion) return false;
        tx.set(fb.counterRef, { next: alloc.previousStart, version: version + 1, updatedAt: now }, { merge: true });
        return true;
      });
    } catch (err) { throw explain(err); }
    if (restored) cacheNextStart(alloc.previousStart);
    return restored;
  }

  /** Undo "Give this token": hand the order back (c = now), then roll the counter back. */
  async function undoIssue(alloc) {
    await write(alloc.token, { c: Date.now() });
    return restoreNextStart(alloc);
  }

  async function getNextStart() {
    if (!fb) {
      nextStart = await readCachedNextStart();
      return nextStart;
    }
    try {
      var snap = await fb.fs.getDocFromServer(fb.counterRef);
      cacheNextStart(counterData(snap).next);
    } catch (e) {
      nextStart = await readCachedNextStart();
    }
    return nextStart;
  }

  function previewNext() {
    var pick = TR.chooseTokenSync(nextStart, liveFind, Date.now());
    return pick ? pick.token : 0;
  }

  async function prepareFirebase() {
    var cfg = global.ORDER_BOARD_FIREBASE;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return false;
    if (firebaseModules) return true;
    var appMod, authMod, fsMod, app;
    var base = 'https://www.gstatic.com/firebasejs/10.14.1/';
    appMod = await import(base + 'firebase-app.js');
    if (global.ORDER_BOARD_STAFF_APP) {
      authMod = await import(base + 'firebase-auth.js');
    }
    fsMod = await import(base + 'firebase-firestore.js');
    var appCfg = {};
    Object.keys(cfg).forEach(function (k) { if (k !== 'emulator') appCfg[k] = cfg[k]; });
    app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(appCfg);
    var auth = authMod ? authMod.getAuth(app) : null;
    var db = fsMod.getFirestore(app);
    if (cfg.emulator) {
      // Local testing only: cfg.emulator = { auth: 'http://127.0.0.1:9099', firestore: ['127.0.0.1', 8080] }
      if (auth && cfg.emulator.auth) authMod.connectAuthEmulator(auth, cfg.emulator.auth, { disableWarnings: true });
      if (cfg.emulator.firestore) fsMod.connectFirestoreEmulator(db, cfg.emulator.firestore[0], cfg.emulator.firestore[1]);
    }
    firebaseModules = { auth: auth, authMod: authMod, db: db, firestore: fsMod };
    return true;
  }

  async function requireStaffAccount(user) {
    if (user.isAnonymous) throw new Error('Anonymous accounts cannot access staff controls.');
    var fs = firebaseModules.firestore;
    var profile = await fs.getDoc(fs.doc(firebaseModules.db, 'staff', user.uid));
    if (!profile.exists()) throw new Error('This account is not authorized for staff access.');
  }

  async function restoreStaffSession() {
    if (!await prepareFirebase()) return false;
    var user = await new Promise(function (resolve) {
      var unsubscribe = null;
      var resolved = false;
      var stopListening = function (currentUser) {
        if (unsubscribe) unsubscribe();
        else resolved = true;
        resolve(currentUser);
      };
      unsubscribe = firebaseModules.authMod.onAuthStateChanged(
        firebaseModules.auth,
        stopListening
      );
      if (resolved) unsubscribe();
    });
    if (!user) return false;
    try {
      await requireStaffAccount(user);
      return true;
    } catch (e) {
      await firebaseModules.authMod.signOut(firebaseModules.auth);
      throw e;
    }
  }

  async function signInStaff(email, password) {
    if (!await prepareFirebase()) throw new Error('Firebase is not configured.');
    try {
      var result = await firebaseModules.authMod.signInWithEmailAndPassword(
        firebaseModules.auth, email, password
      );
      await requireStaffAccount(result.user);
    } catch (e) {
      await firebaseModules.authMod.signOut(firebaseModules.auth);
      throw e;
    }
  }

  function attachFirestore(fsMod, db) {
    fb = {
      fs: fsMod,
      db: db,
      ordersRef: fsMod.collection(db, 'orders'),
      counterRef: fsMod.doc(db, 'counters', 'token_counter')
    };

    if (unsubOrders) unsubOrders();
    unsubOrders = fsMod.onSnapshot(fb.ordersRef, { includeMetadataChanges: true }, function (snap) {
      var next = [];
      snap.docs.forEach(function (d) {
        var n = +d.id;
        if (!TR.isValidToken(n)) return;
        var v = d.data() || {};
        next.push({ n: n, t: +v.t || 0, r: +v.r || 0, c: +v.c || 0 });
      });
      orders = next;
      pruneStale();
      persistLocal();
      if (Date.now() >= errorLabelUntil) {
        var meta = snap.metadata || {};
        if (meta.fromCache) {
          setLabel(meta.hasPendingWrites
            ? 'Offline — changes saved locally.'
            : 'Offline (cached) — reconnecting…');
        } else {
          setLabel(LABEL_LIVE);
        }
      }
      emit();
    }, function () {
      setLabel('Firestore error — using local copy.');
      emit();
    });

    if (global.ORDER_BOARD_STAFF_APP) {
      if (unsubCounter) unsubCounter();
      unsubCounter = fsMod.onSnapshot(fb.counterRef, function (snap) {
        cacheNextStart(counterData(snap).next);
        emit();
      }, function () {});
    }
  }

  async function initFirebase() {
    try {
      if (!await prepareFirebase()) return false;
      if (global.ORDER_BOARD_STAFF_APP && !await restoreStaffSession()) return false;
      attachFirestore(firebaseModules.firestore, firebaseModules.db);
      return true;
    } catch (e) {
      console.warn('Firebase init failed', e);
      fb = null;
      setLabel('Couldn’t reach the cloud — still works on this phone.');
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
    isFirebase: function () { return !!fb; },
    restoreStaffSession: restoreStaffSession,
    signInStaff: signInStaff,
    /** Resolves when saved; rejects (after rolling back) if the counter rejects the write. */
    write: write,
    issueNext: issueNext,
    undoIssue: undoIssue,
    restoreNextStart: restoreNextStart,
    getNextStart: getNextStart,
    setNextStart: setNextStart,
    setNext: setNextStart,
    previewNext: previewNext,
    find: liveFind,
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
    init: async function () {
      loadLocal();
      pruneStale();
      nextStart = await readCachedNextStart();
      emit();
      await initFirebase();
      if (!fb && !global.ORDER_BOARD_FIREBASE) {
        setLabel(LABEL_LOCAL);
        emit();
      }
    },
    /** Test seam: attach a Firestore-shaped module without network access. */
    _attachForTest: function (fsMod, db) { attachFirestore(fsMod, db); },
    _resetForTest: function () {
      orders = []; fb = null; nextStart = 1; localVersion = 0; writeSeq = {};
      errorLabelUntil = 0; syncLabel = LABEL_LOCAL;
    }
  };

  global.OBStore = Store;
})(typeof window !== 'undefined' ? window : globalThis);
