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
