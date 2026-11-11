# Releasing Cue

Most changes ship **over the air**. Only native changes need a new APK / App Store build.

## What can and can't go OTA

| Change | Android apps (Capacitor) | iOS apps (native SwiftUI) |
|---|---|---|
| UI, copy, CSS, JS logic in `shared/` and `apps/*/www` | **OTA web bundle** (`npm run release:ota`) | n/a (iOS UI is Swift) |
| Firestore rules / indexes | Deploy (instant, both platforms) | same |
| Flags, announcement banner, ready-expiry / stale thresholds, minimum-version force-update | Ship with the web bundle | **Firebase Remote Config** (instant, no App Store) |
| New Capacitor plugin, Java/Kotlin code, permissions, `AndroidManifest`, `minSdk`, new app icon | **New APK** (`build_apks`) | n/a |
| Any Swift code, new capability, Info.plist, Firebase SDK upgrade | n/a | **App Store / TestFlight release** (Apple does not allow downloading native code) |

Apple only allows changing *data* the shipped code reads (Remote Config), not downloading new code. The iOS apps therefore
read their knobs from Remote Config and can force an update with a minimum-version screen.

`remoteconfig.template.json` holds the keys: `min_version_student`, `min_version_staff`, `update_url`, `update_message`,
`announcement`, `ready_expiry_minutes`, `stale_window_hours`.
Thresholds are clamped in the app to **at least** today's values (20 min / 4 h): `firestore.rules` holds a token for
those periods, so a shorter client window would have re-issue writes rejected. Shortening needs a rules deploy plus an app release.

## How Android OTA works

* Plugin: self-hosted `@capgo/capacitor-updater` in **manual mode** (`autoUpdate: false`), no third-party update server.
* Each build ships a **manifest** per app and channel at
  `https://cue-orderboard-sharan.web.app/ota/<student|staff>/<prod|beta>.json` (Firebase Hosting, no-cache, CORS open).
  The **zip** lives in a GitHub Release `ota-<app>-<version>` (public repo; downloaded natively, verified with sha256).
* The app confirms its bundle booted (`notifyAppReady`), checks the manifest ~5 s after launch (at most every 30 min),
  downloads in the background and queues it with `next()`: it takes over when the app is backgrounded or restarted,
  never mid-order.
* **Rollback on a bad bundle**: if a bundle doesn't call `notifyAppReady` within 10 s of booting, the plugin reverts
  to the previous one and the app remembers that version as failed and won't retry it.
* **Remote rollback**: versions are compared by *equality*, so publishing an older version rolls everyone back to it
  (`npm run release:ota:rollback -- --channel prod --app student --to <version>`). Add a bad version to `revoked`
  in the manifest to force devices running it back to the built-in bundle.
* **Native compatibility guard**: every manifest has `minNativeVersion` (default: the APK's `versionName`) and optional
  `maxNativeVersion`. A device whose APK is outside the range ignores the bundle. Bump `--min-native` whenever a bundle
  needs a native feature that older APKs lack. `resetWhenUpdate` drops downloaded bundles after an APK update.
* **Channels**: `prod` and `beta`. A build follows the channel baked in at build time (`OTA_CHANNEL`, default `prod`);
  the beta APK from the *Release* workflow follows `beta`. `OBOta.setChannel('beta')` switches a device at runtime.
  Promote beta to prod by publishing to `prod` (it is rebuilt, not copied).
* `minSdk` is 23 (Android 6.0), required by the updater plugin.

## Ship an OTA update

One command (needs `gh` logged in, and a Firebase login or `GOOGLE_APPLICATION_CREDENTIALS`):

```bash
npm run release:ota -- --channel beta            # test first
npm run release:ota -- --channel prod            # then everyone
npm run release:ota -- --channel prod --apps student --notes "Fix ready alert" --min-native 1.2.0
npm run release:ota -- --channel prod --dry-run  # build + assemble locally, upload nothing
```

Or in GitHub: **Actions > Release > Run workflow**, choose the channel and switches (`publish_ota`, `deploy_firebase`,
`build_apks`, `build_ios`). Pushing a tag does it all: `git tag v1.2.0 && git push origin v1.2.0` (prod),
`v1.2.0-beta.1` (beta); the tag run also attaches the APKs to a GitHub Release.

Workflows: `.github/workflows/release.yml` (this pipeline) and `.github/workflows/ios.yml` (build + tests on every PR,
also reused by the Release workflow for iOS). Scripts: `scripts/release-ota.js`, `scripts/ota/*`.

## iOS config

* Firebase plists are **never committed**. Locally put `ios/GoogleService-Info-student.plist` and
  `ios/GoogleService-Info-staff.plist` (git-ignored) next to `project.yml`; each target copies its own and
  fails the build if the plist's bundle id doesn't match the target.
* CI writes them from base64 secrets. Without the secrets (e.g. a fork) the build runs in **local mode** and logs
  `Firebase config missing`; with them CI checks the built app contains the plist with project `cue-orderboard-sharan`.

## GitHub secrets to add (Settings > Secrets and variables > Actions)

| Secret | Used by | What |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Release: `ota`, `firebase` | Service-account **JSON** for project `cue-orderboard-sharan` with roles *Firebase Hosting Admin*, *Firebase Rules Admin* and *Firebase Remote Config Admin* (plus *Cloud Datastore Index Admin* if you deploy indexes). |
| `IOS_GOOGLE_SERVICE_INFO_STUDENT_BASE64` | `ios.yml` | `base64 -i GoogleService-Info-student.plist` (bundle id `in.sharan.orderboard`) |
| `IOS_GOOGLE_SERVICE_INFO_STAFF_BASE64` | `ios.yml` | `base64 -i GoogleService-Info-staff.plist` (bundle id `in.sharan.orderboard.staff`) |
| `IOS_BUILD_CERTIFICATE_BASE64`, `IOS_BUILD_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_TEAM_ID` | `ios.yml` signing probe | Optional, only for future signed IPAs |

`GITHUB_TOKEN` is automatic (the workflow requests `contents: write` for releases). Do not paste secret values anywhere in the repo.

## One-time setup

1. Firebase console > Build > Hosting > *Get started* (the default site `cue-orderboard-sharan.web.app` must exist).
2. Add the secrets above.
3. Publish Remote Config once (`deploy_firebase` in the Release workflow) so the keys exist.
4. Ship APKs built with this pipeline once (they contain the updater); after that web changes go OTA.
5. Android release signing is **not** set up: CI builds debug-signed APKs, whose signature changes per runner. Sign with a
   fixed keystore before handing APKs to customers who will install updates over them.
