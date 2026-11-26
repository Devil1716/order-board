# Releasing Cue

Most changes ship **over the air**. Only native changes need a new APK / App Store build.

## How to ship an update

There are two ways to get a change onto phones. Pick the first one whenever you can.

### 1. Over-the-air (OTA) update: no store review

Use this for anything inside the web bundle: screens, text, colours, CSS, and JavaScript logic in `shared/` or `apps/*/www`.

1. Merge the change to `main` and check it in a browser or on the emulator.
2. Publish the bundle: `npm run release:ota -- --channel prod --apps student,staff --notes "What changed"`
   (or push a tag like `v1.3.1`, and the Release workflow does it). Try `--channel beta` first if you want a small test group.
3. Phones download it in the background and switch to it the next time the app goes to the background or restarts.
   A student is never interrupted while an order is being tracked.
4. If something is wrong, roll back with `npm run release:ota:rollback -- --channel prod --app student --to <older version>`.

An OTA bundle only reaches phones whose installed app is new enough (`minNativeVersion`, default: the current
`versionName`). A bundle built from 1.3.0 code never lands on a 1.2.0 app.

### 2. Store update: needed for native changes

Use this when the change touches native code or settings: Capacitor or plugin upgrades, Java code, permissions,
`AndroidManifest.xml`, SDK levels, the app icon, or a new Firebase project.

1. **Bump the version** in `apps/<app>/android/app/build.gradle`: `versionName` (for example `1.4.0`) and `versionCode`
   (+1, it must always go up). Also set `APP_VERSION` in `apps/<app>/www/js/app.js` to match.
2. **Build a signed bundle** with the Cue key `cue-release.jks`. Locally: export `CUE_KEYSTORE_FILE`, `CUE_KEYSTORE_PASSWORD`,
   `CUE_KEY_ALIAS`, `CUE_KEY_PASSWORD`, then run `npm run sync-shared && bash scripts/build-apks.sh out`. This produces
   `out/Cue-<app>.aab` (for Play) and `out/Cue-<app>.apk` (for direct installs). CI does the same from the
   `ANDROID_KEYSTORE_*` secrets. The same key must be used forever, so keep an offline backup of it.
3. **Upload the `.aab` to Google Play.** Quicko can do this as an invited user on the client's (SRT's) Play Console, so the
   apps sit in the client's account while Quicko does the releases. Go Internal testing → Production, and fill in
   "What's new".
4. **Ask people to update.** Once Play shows the new version as live, set Remote Config
   `latest_version_<app>_android` (shows a dismissible "Update available" sheet) or `min_version_<app>_android`
   (blocks the app until it is updated) to the new `versionName`, and publish. Android uses Play's in-app update when
   Play has the new version. See "Ask people to install a new app version" below.

### Moving to a client-owned Firebase project

The apps currently talk to the `cue-orderboard-sharan` Firebase project. To move to a project the client (SRT) owns:

1. The client creates the Firebase / Google Cloud project (region `asia-south1`, Mumbai) and adds Quicko's Google
   account as **Editor**, so Quicko can deploy and run it.
2. Quicko recreates the setup there: Firestore with the same rules and indexes, email sign-in for staff with the
   `staff/{uid}` records, Remote Config from `remoteconfig.template.json`, and Hosting for the privacy page and OTA manifests.
3. The new web config (`shared/js/firebase-config.js`), the OTA address (`OTA_BASE_URL`, default in
   `scripts/sync-shared.js` and `scripts/ota/lib.js`) and the CI secrets change, so this ships as a **store update**:
   a new version for all phones.
4. After that store update is installed, later OTA updates are published to and served from the client's project as usual.
   Keep the old project running until every phone is on the new version.

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

`remoteconfig.template.json` holds the keys: `min_version_student`, `min_version_staff`, `update_url`, `update_message`, the Android update keys (`min_version_*_android`, `latest_version_*_android`, `update_url_android`),
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

## Ask people to install a new app version (update pop-up)

Use this when an update needs a **new APK / App Store build** (OTA bundles install by themselves, see below).
Everything is in **Firebase console > Remote Config**: edit the key, *Save*, *Publish changes*. Phones pick it
up the next time the app opens or comes back to the screen (within about 15 minutes). Clear the value to switch it off.

**Android (Cue and Cue Staff)**

1. Put the new APK somewhere people can download it, or on Google Play.
2. Set `update_url_android` to that link (Play listing or an `https://` APK link).
3. Pick the kind of prompt, using the new APK's `versionName` (e.g. `1.3.0`):
   * **Soft** (people can tap *Later*, asked again after 24 h): `latest_version_student_android` /
     `latest_version_staff_android`.
   * **Forced** (full screen, no way past it): `min_version_student_android` / `min_version_staff_android`.
     The text comes from `update_message`.
4. Publish. Phones with an older APK see the prompt. If the app came from Google Play and Play already has the
   new version, *Update* runs Play's in-app update; otherwise it opens `update_url_android`.

No prompt is ever shown without a link (or a Play update) to send people to, or if Remote Config can't be reached
and nothing was cached.

**iOS**: set `min_version_student` / `min_version_staff` (forced) and `update_url` (App Store / TestFlight link).

**OTA web bundles** don't need any of this: they download in the background and install the next time the app
is in the background. In the student app a downloaded bundle waits while the student is tracking an order.

## Android signing (keep the same key forever)

APKs only install over each other when they are signed with the **same key**. CI signs with the fixed Cue key
from these secrets (release APKs); without them it falls back to a throwaway debug key and warns.

| Secret | What |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 cue-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `cue` |
| `ANDROID_KEY_PASSWORD` | key password (same as the keystore password) |

Keep an offline copy of `cue-release.jks` and its password. Losing it means every phone has to uninstall the app
once to move to a new key (and on Google Play you would need Play's upload-key reset).
Local build with the key: `CUE_KEYSTORE_FILE=/path/cue-release.jks CUE_KEYSTORE_PASSWORD=... bash scripts/build-apks.sh out`.

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
| `IOS_GOOGLE_SERVICE_INFO_STUDENT_BASE64` | `ios.yml` | `base64 -i GoogleService-Info-student.plist` (iOS bundle id `in.sharan.orderboard`) |
| `IOS_GOOGLE_SERVICE_INFO_STAFF_BASE64` | `ios.yml` | `base64 -i GoogleService-Info-staff.plist` (iOS bundle id `in.sharan.orderboard.staff`) |
| `IOS_BUILD_CERTIFICATE_BASE64`, `IOS_BUILD_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_TEAM_ID` | `ios.yml` signing probe | Optional, only for future signed IPAs |

`GITHUB_TOKEN` is automatic (the workflow requests `contents: write` for releases). Do not paste secret values anywhere in the repo.

## One-time setup

1. Firebase console > Build > Hosting > *Get started* (the default site `cue-orderboard-sharan.web.app` must exist).
2. Add the secrets above.
3. Publish Remote Config once (`deploy_firebase` in the Release workflow) so the keys exist.
4. Ship APKs built with this pipeline once (they contain the updater); after that web changes go OTA.
5. Add the Android signing secrets (above) so every APK is signed with the same Cue key.
