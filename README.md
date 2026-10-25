# Order Board

Two separate Capacitor apps for a restaurant / cafe **token board**:

| App | Package / Bundle ID | Who uses it |
|---|---|---|
| **Order Board** (Student) | `in.sharan.orderboard` | Students / customers — enter token, watch the board, get ready alert |
| **Order Board Staff** | `in.sharan.orderboard.staff` | Counter staff — give tokens, mark ready, hand over |

Same design language as the original HTML prototype. **No Display/Staff tabs** — each role is its own installable app.

Repo: https://github.com/Devil1716/order-board

## Sync across phones (required for two devices)

Student and Staff only share a board when **Firebase Firestore** is configured. Without it, each app keeps a **local-only** store (fine for a single tablet demo; not for phone + counter).

1. Create a Firebase project → add a **Web** app.
2. Enable **Cloud Firestore** (test mode or rules allowing read/write on `orders`).
3. Paste the web config into **both** apps via the shared file:

```js
// shared/js/firebase-config.js  (copied into each app’s www on sync)
window.ORDER_BOARD_FIREBASE = {
  apiKey: "...",
  authDomain: "....firebaseapp.com",
  projectId: "...",
  storageBucket: "....appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

4. Run `npm run sync-shared && npx cap sync` in each app (or `npm run sync` from the repo root).

Collection: `orders`  
Document ID: token number as string (`"42"`)  
Fields: `{ t: createdMs, r: readyMs|0, c: collectedMs|0 }`

Until config is set, the UI sync label says local-only and reminds you that two phones need Firebase.

## Project layout

```
order-board/
  shared/                 # CSS, store, native bridge, firebase-config, vendor
  apps/student/           # Capacitor app — display / track only
    www/                  # index + student app.js (+ synced shared)
    android/ ios/
  apps/staff/             # Capacitor app — staff controls only
    www/ android/ ios/
  scripts/sync-shared.js  # copies shared → each www/
  dist/                   # local APK output (gitignored binaries)
  .github/workflows/ios.yml
```

## Android APKs

Needs JDK 21 + Android SDK.

```bash
export JAVA_HOME=/path/to/jdk21
export ANDROID_HOME=/path/to/android-sdk
npm install
# workspaces hoist node_modules; Gradle expects apps/*/node_modules:
ln -sfn ../../node_modules apps/student/node_modules
ln -sfn ../../node_modules apps/staff/node_modules
npm run apk
# → dist/OrderBoard-student-debug.apk
# → dist/OrderBoard-staff-debug.apk
```

Or build one:

```bash
npm run apk:student
npm run apk:staff
```

Install both on a phone (different package names coexist). Enable “Install unknown apps” for your file manager.

## iOS CI (GitHub Actions)

Workflow [`.github/workflows/ios.yml`](.github/workflows/ios.yml) builds **both** apps on `macos-latest`:

| Job | Artifact |
|---|---|
| Student simulator | `OrderBoard-student-ios-simulator` |
| Staff simulator | `OrderBoard-staff-ios-simulator` |
| Device IPA (optional) | Skipped until Apple signing secrets are set |

Triggers: push to `main`, `workflow_dispatch`.

Simulator builds need **no** Apple certs. A device IPA still needs:

| Secret | Contents |
|---|---|
| `IOS_BUILD_CERTIFICATE_BASE64` | Distribution / Ad Hoc `.p12`, base64 |
| `IOS_BUILD_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | Matching `.mobileprovision`, base64 |
| `IOS_TEAM_ID` | 10-character Apple Team ID |
| `IOS_KEYCHAIN_PASSWORD` | Optional temporary CI keychain password |

You will need **two** provisioning profiles (one per bundle ID) for device builds of both apps; the current device job is a template — extend it once certs exist.

### Local Mac + Xcode

```bash
npm install
ln -sfn ../../node_modules apps/student/node_modules
ln -sfn ../../node_modules apps/staff/node_modules
npm run sync-shared
cd apps/student && npx cap sync ios && cd ios/App && pod install && open App.xcworkspace
# similarly apps/staff
```

## Behaviour

**Student**

- Enter token → track preparing / ready
- Hero latest ready + ready grid + preparing bar
- Full-screen ready alert, sound, haptics, local notification
- Collect / track another
- No staff numpad or give-token UI

**Staff**

- Numpad add / ready / hand over
- Give next token 1–150 (reuse)
- Preparing + ready tiles, clear all, toast + undo
- No student token-entry / personal alert flow

Shared rules: ready expires after **20 minutes**; orders older than **4 hours** ignored; theme follows system light/dark.

## Capacitor plugins

- `@capacitor/haptics`, `@capacitor/local-notifications`
- `@capacitor/preferences`, `@capacitor/status-bar`, `@capacitor/splash-screen`
- `@capacitor-community/keep-awake` (student alerts)

## Known limits (v1)

- Firebase config ships as `null` — paste your project keys before using two devices.
- Staff app has no PIN gate yet.
- Debug APKs are for sideload, not Play Store.
- Google Fonts need network on first load; system UI font is the fallback.

## License

Private — for Sharan’s use.
