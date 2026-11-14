#!/usr/bin/env node
/**
 * Builds the web bundle zip for one app + its manifest.
 *   node scripts/ota/build-bundle.js --app student --channel prod [--version X] [--min-native 1.1.0] [--notes "..."]
 * Output: dist/ota/<app>-<version>.zip and dist/ota/<app>-<version>.manifest.json
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const L = require('./lib');

function buildBundle(opts) {
  const { app, channel } = opts;
  const version = opts.version || L.makeVersion(app, channel);
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || L.DEFAULT_REPO;
  const outDir = opts.outDir || path.join(L.root, 'dist', 'ota');
  fs.mkdirSync(outDir, { recursive: true });

  // Bake the channel in as this build's default, then copy the *synced* www (shared css/js/vendor included).
  execFileSync('node', [path.join(L.root, 'scripts', 'sync-shared.js')], {
    stdio: 'ignore',
    env: Object.assign({}, process.env, { OTA_CHANNEL: channel }),
  });
  const www = path.join(L.root, 'apps', app, 'www');
  if (!fs.existsSync(path.join(www, 'index.html'))) throw new Error('index.html missing in ' + www);

  const zip = path.join(outDir, app + '-' + version + '.zip');
  fs.rmSync(zip, { force: true });
  const archive = new AdmZip();
  archive.addLocalFolder(www);          // contents of www/ at the zip root (index.html must be top-level)
  archive.writeZip(zip);

  const listing = new AdmZip(zip).getEntries().map((e) => e.entryName);
  if (!listing.includes('index.html')) throw new Error('index.html must be at the zip root');

  const manifest = L.buildManifest({
    app, channel, version,
    url: L.assetUrl(repo, L.releaseTag(app, version), path.basename(zip)),
    sha256: L.sha256File(zip),
    minNativeVersion: opts.minNative || L.nativeVersionName(app),
    maxNativeVersion: opts.maxNative,
    notes: opts.notes,
  });
  const manifestFile = path.join(outDir, app + '-' + version + '.manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  return { app, channel, version, zip, manifestFile, manifest };
}

module.exports = { buildBundle };

if (require.main === module) {
  const a = L.parseArgs(process.argv.slice(2));
  const r = buildBundle({
    app: L.pickApps(a.app)[0], channel: L.requireChannel(a.channel || 'prod'), version: a.version,
    minNative: a['min-native'], maxNative: a['max-native'], notes: a.notes, outDir: a.out,
  });
  console.log('Built', r.zip, '\n  version', r.version, '\n  sha256 ', r.manifest.sha256);
}
