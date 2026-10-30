#!/usr/bin/env node
/**
 * Copy shared CSS/JS/vendor into each app's www/ before cap sync / APK build.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shared = path.join(root, 'shared');
const apps = ['student', 'staff'];

function cpDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) cpDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

for (const app of apps) {
  const www = path.join(root, 'apps', app, 'www');
  if (!fs.existsSync(www)) {
    console.error('Missing', www);
    process.exit(1);
  }
  cpDir(path.join(shared, 'css'), path.join(www, 'css'));
  cpDir(path.join(shared, 'js'), path.join(www, 'js'));
  // app-specific app.js must win over shared (shared has no app.js)
  // shared/js has store/native/firebase only — good
  cpDir(path.join(shared, 'vendor'), path.join(www, 'vendor'));
  console.log('Synced shared → apps/' + app + '/www');
}

// Also keep live-demo shells in sync (phones.html demo host)
const liveRoot = path.join(root, '..', 'order-board-live-demo');
if (fs.existsSync(liveRoot)) {
  for (const app of apps) {
    const dest = path.join(liveRoot, app);
    if (!fs.existsSync(dest)) continue;
    cpDir(path.join(shared, 'css'), path.join(dest, 'css'));
    cpDir(path.join(shared, 'js'), path.join(dest, 'js'));
    cpDir(path.join(shared, 'vendor'), path.join(dest, 'vendor'));
    // Mirror www HTML/img when present so demo matches apps
    const www = path.join(root, 'apps', app, 'www');
    for (const name of ['index.html']) {
      const src = path.join(www, name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dest, name));
    }
    const imgSrc = path.join(www, 'img');
    if (fs.existsSync(imgSrc)) cpDir(imgSrc, path.join(dest, 'img'));
    console.log('Synced shared → order-board-live-demo/' + app);
  }
}
