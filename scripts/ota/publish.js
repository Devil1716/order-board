#!/usr/bin/env node
/**
 * Assembles the Firebase Hosting folder (hosting-public/) that serves the channel manifests.
 * A Hosting deploy replaces the whole site, so manifests we are NOT publishing now are fetched from the live
 * site first and carried over.
 *
 *   node scripts/ota/publish.js --channel prod [--bundles dist/ota] [--site hosting-public]
 *   node scripts/ota/publish.js --channel prod --rollback --app student --to 1.1.0-ota.202611112359
 *
 * Rollback re-publishes an earlier release's manifest (its zip is still on GitHub Releases).
 */
const fs = require('fs');
const path = require('path');
const L = require('./lib');

async function fetchJson(url) {
  try {
    const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

function writeManifest(site, m) {
  const dir = path.join(site, 'ota', m.app);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, m.channel + '.json'), JSON.stringify(m, null, 2) + '\n');
}

async function assemble(opts) {
  const site = opts.site || path.join(L.root, 'hosting-public');
  const siteUrl = (opts.siteUrl || process.env.OTA_SITE_URL || L.DEFAULT_SITE).replace(/\/+$/, '');
  const repo = opts.repo || process.env.GITHUB_REPOSITORY || L.DEFAULT_REPO;
  fs.rmSync(site, { recursive: true, force: true });
  fs.mkdirSync(site, { recursive: true });
  fs.copyFileSync(path.join(L.root, 'hosting', 'index.html'), path.join(site, 'index.html'));

  const publishing = {};
  for (const m of opts.manifests || []) {
    publishing[m.app + '/' + m.channel] = m;
    writeManifest(site, m);
  }
  const carried = [];
  if (!opts.noFetch) {
    for (const app of L.APPS) for (const ch of L.CHANNELS) {
      if (publishing[app + '/' + ch]) continue;
      const existing = await fetchJson(siteUrl + '/ota/' + app + '/' + ch + '.json');
      if (existing && existing.app === app && existing.channel === ch) { writeManifest(site, existing); carried.push(app + '/' + ch); }
    }
  }
  return { site, carried, published: Object.keys(publishing), repo };
}

async function rollbackManifest(app, channel, version, repo) {
  const tag = L.releaseTag(app, version);
  const url = L.assetUrl(repo, tag, app + '-' + version + '.manifest.json');
  const m = await fetchJson(url);
  if (!m) throw new Error('Could not read ' + url + ' (does release ' + tag + ' exist?)');
  // Same zip, republished on the requested channel.
  return Object.assign({}, m, { channel, released: new Date().toISOString() });
}

module.exports = { assemble, rollbackManifest, writeManifest };

if (require.main === module) {
  (async () => {
    const a = L.parseArgs(process.argv.slice(2));
    const channel = L.requireChannel(a.channel || 'prod');
    const repo = process.env.GITHUB_REPOSITORY || L.DEFAULT_REPO;
    let manifests = [];
    if (a.rollback) {
      const app = L.pickApps(a.app)[0];
      if (!a.to || a.to === true) throw new Error('--to <version> is required for --rollback');
      manifests = [await rollbackManifest(app, channel, a.to, repo)];
    } else {
      const dir = path.resolve(a.bundles || path.join(L.root, 'dist', 'ota'));
      manifests = fs.readdirSync(dir).filter((f) => f.endsWith('.manifest.json'))
        .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))).filter((m) => m.channel === channel);
    }
    const r = await assemble({ site: a.site && path.resolve(a.site), manifests, noFetch: !!a['no-fetch'] });
    console.log('Hosting folder:', r.site, '\n  published:', r.published.join(', ') || '(none)', '\n  carried over:', r.carried.join(', ') || '(none)');
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
