#!/usr/bin/env node
/**
 * One command to ship a web-bundle update to the Android apps:
 *   npm run release:ota -- --channel prod [--apps student|staff|both] [--min-native 1.1.0] [--notes "..."] [--dry-run] [--skip-tests]
 *
 * 1. npm test            2. build bundle zip + manifest per app
 * 3. upload zip+manifest as a GitHub Release (needs `gh` auth / GH_TOKEN)
 * 4. assemble hosting-public/ (new manifests + carried-over ones)
 * 5. firebase deploy --only hosting (needs a Firebase login or GOOGLE_APPLICATION_CREDENTIALS)
 *
 * --dry-run builds and assembles everything locally but uploads and deploys nothing.
 */
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const L = require('./ota/lib');
const { buildBundle } = require('./ota/build-bundle');
const { assemble } = require('./ota/publish');

const a = L.parseArgs(process.argv.slice(2));
const dry = !!a['dry-run'];

function run(cmd, args, opts) {
  console.log('$', cmd, args.join(' '));
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', cwd: L.root }, opts));
  if (r.status !== 0) throw new Error(cmd + ' failed (exit ' + r.status + ')');
}

(async () => {
  const channel = L.requireChannel(a.channel);
  const apps = L.pickApps(a.apps);
  const repo = process.env.GITHUB_REPOSITORY || L.DEFAULT_REPO;
  const project = process.env.FIREBASE_PROJECT || 'cue-orderboard-sharan';

  if (!a['skip-tests']) run('npm', ['test']);

  const built = apps.map((app) => {
    const r = buildBundle({ app, channel, minNative: a['min-native'], notes: a.notes, repo });
    console.log('Built ' + app + ' ' + r.version + ' (sha256 ' + r.manifest.sha256.slice(0, 12) + '…, needs native >= ' + r.manifest.minNativeVersion + ')');
    return r;
  });

  if (!dry) {
    for (const b of built) {
      const tag = L.releaseTag(b.app, b.version);
      const args = ['release', 'create', tag, b.zip, b.manifestFile, '--repo', repo, '--title', 'OTA ' + b.app + ' ' + b.version + ' (' + channel + ')',
        '--notes', (a.notes && a.notes !== true ? a.notes : 'Web bundle for the Cue ' + b.app + ' Android app, channel ' + channel + '.'), '--latest=false'];
      if (channel !== 'prod') args.push('--prerelease');
      run('gh', args);
    }
  }

  const r = await assemble({ manifests: built.map((b) => b.manifest), repo });
  console.log('Hosting folder ready:', path.relative(L.root, r.site), '| carried over:', r.carried.join(', ') || 'none');

  if (dry) {
    console.log('\nDry run: nothing uploaded or deployed.');
    return;
  }
  run('npx', ['--yes', 'firebase-tools@latest', 'deploy', '--only', 'hosting', '--project', project, '--non-interactive']);
  console.log('\nPublished ' + built.map((b) => b.app + '@' + b.version).join(', ') + ' to channel "' + channel + '".');
})().catch((e) => { console.error('\nrelease:ota failed: ' + e.message); process.exit(1); });
