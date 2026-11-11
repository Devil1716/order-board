/** Shared helpers for the OTA release scripts. No secrets are read or written here. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const APPS = ['student', 'staff'];
const CHANNELS = ['prod', 'beta'];
const DEFAULT_REPO = 'Devil1716/order-board';
const DEFAULT_SITE = 'https://cue-orderboard-sharan.web.app';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function pickApps(value) {
  const list = !value || value === true || value === 'both' ? APPS : String(value).split(',').map((s) => s.trim());
  for (const a of list) if (!APPS.includes(a)) throw new Error('Unknown app "' + a + '" (use student, staff or both)');
  return list;
}

function requireChannel(value) {
  if (!CHANNELS.includes(value)) throw new Error('--channel must be one of: ' + CHANNELS.join(', '));
  return value;
}

/** The APK's versionName: the native shell version a bundle is compatible with. */
function nativeVersionName(app) {
  const gradle = fs.readFileSync(path.join(root, 'apps', app, 'android', 'app', 'build.gradle'), 'utf8');
  const m = gradle.match(/versionName\s+"([^"]+)"/);
  if (!m) throw new Error('versionName not found for ' + app);
  return m[1];
}

function stamp(date) {
  const d = date || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

/** 1.1.0-ota.202611112359 : unique, sortable, valid for the updater's bundle folder name. */
function makeVersion(app, channel, date) {
  const base = nativeVersionName(app);
  return base + '-' + (channel === 'prod' ? 'ota' : channel) + '.' + stamp(date);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function releaseTag(app, version) { return 'ota-' + app + '-' + version; }

function assetUrl(repo, tag, file) {
  return 'https://github.com/' + repo + '/releases/download/' + tag + '/' + file;
}

function buildManifest(o) {
  const m = {
    schema: 1,
    app: o.app,
    channel: o.channel,
    version: o.version,
    url: o.url,
    sha256: o.sha256,
    minNativeVersion: o.minNativeVersion,
    revoked: o.revoked || [],
    released: o.released || new Date().toISOString(),
  };
  if (o.maxNativeVersion) m.maxNativeVersion = o.maxNativeVersion;
  if (o.notes) m.notes = o.notes;
  return m;
}

module.exports = {
  root, APPS, CHANNELS, DEFAULT_REPO, DEFAULT_SITE,
  parseArgs, pickApps, requireChannel, nativeVersionName, makeVersion, sha256File, releaseTag, assetUrl, buildManifest, stamp,
};
