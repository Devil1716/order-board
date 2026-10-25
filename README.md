# Order Board

Cross-platform restaurant / cafe **token board** for customers and staff.

- **Display** — customers enter their token, see preparing + ready boards, and get a full-screen alert (sound + haptics) when their order is ready.
- **Staff** — numpad to add tokens, mark ready, hand over; sequential tokens 1–150 (reuse); clear-all with undo toast.

Built with **Capacitor 6** + plain HTML/CSS/JS so the UI matches the original prototype.

| | |
|---|---|
| App ID / package | `in.sharan.orderboard` |
| Platforms | Android, iOS, web |
| Sync | Local-first; optional Firebase Firestore |
| Repo | https://github.com/Devil1716/order-board |

## Quick start (web)

```bash
cd order-board
npm install
npm start          # serves www/ on http://localhost:5173
```

Open the URL on a phone or desktop browser. Staff and Display tabs share the same local store on that device.

## Android APK

Rebuild locally (needs JDK 21 + Android SDK):

```bash
export JAVA_HOME=/path/to/jdk21
export ANDROID_HOME=/path/to/android-sdk
npm run sync
npm run apk
# → dist/OrderBoard-debug.apk
adb install -r dist/OrderBoard-debug.apk
```

Or copy the APK to the phone and open it (enable “Install unknown apps” for your file manager).

## iOS CI (GitHub Actions)

This repo builds **iOS on macOS runners** so you do not need a local Mac for a compile check.

Workflow: [`.github/workflows/ios.yml`](.github/workflows/ios.yml)

| Trigger | What runs |
|---|---|
| Push to `main` | Simulator Debug build (no Apple signing) |
| `workflow_dispatch` | Same |
| Device IPA job | Only if Apple signing **secrets** are set (otherwise skipped with a notice) |

### Download the simulator artifact

1. Open **Actions** → latest **iOS** run → **Artifacts**.
2. Download **`OrderBoard-ios-simulator`** (zip of `App.app`).
3. That proves the iOS project **compiles**. It is for the **Simulator**, not for installing on a physical iPhone.

```bash
# After downloading the zip from Actions:
unzip OrderBoard-ios-simulator.zip
# On a Mac with Xcode:
xcrun simctl boot "iPhone 16"   # or any available simulator
xcrun simctl install booted App.app
xcrun simctl launch booted in.sharan.orderboard
```

### What a real device IPA still needs

A device-installable IPA requires an **Apple Developer Program** membership and signing material stored as **GitHub Actions secrets** (never commit certs to git):

| Secret | Contents |
|---|---|
| `IOS_BUILD_CERTIFICATE_BASE64` | Distribution (or Ad Hoc) `.p12` certificate, base64-encoded |
| `IOS_BUILD_CERTIFICATE_PASSWORD` | Password for that `.p12` |
| `IOS_PROVISIONING_PROFILE_BASE64` | Matching `.mobileprovision`, base64-encoded |
| `IOS_TEAM_ID` | 10-character Apple Team ID |
| `IOS_KEYCHAIN_PASSWORD` | Optional; temporary CI keychain password |

Encode files on a Mac:

```bash
base64 -i YourCert.p12 | pbcopy          # → IOS_BUILD_CERTIFICATE_BASE64
base64 -i YourProfile.mobileprovision | pbcopy  # → IOS_PROVISIONING_PROFILE_BASE64
```

Add them under **Settings → Secrets and variables → Actions**. When all four required secrets are present, the **Device IPA** job runs and uploads artifact **`OrderBoard-ios-device-ipa`**.

Without those secrets, CI still produces the simulator build; the device job is skipped on purpose.

### Local Mac + Xcode (optional)

```bash
npm install
npx cap sync ios
cd ios/App
pod install
open App.xcworkspace
```

In Xcode: select a simulator or device, set your Team under Signing & Capabilities, then Run. Bundle ID is `in.sharan.orderboard`.

## Project layout

```
order-board/
  www/                 # web assets (Capacitor webDir)
    index.html
    css/styles.css
    js/
      app.js           # UI + modes
      store.js         # local + optional Firestore
      native.js        # Capacitor plugins bridge
      firebase-config.js
  android/             # Capacitor Android project
  ios/                 # Capacitor iOS project (built in CI on macOS)
  .github/workflows/   # iOS simulator (+ optional signed IPA)
  dist/                # local APK output (binaries gitignored)
  capacitor.config.json
```

## Behaviour (preserved from prototype)

- Ready tokens expire after **20 minutes** on the board.
- Orders older than **4 hours** are ignored.
- Sequential give: next free number in **1–150**, wraps / reuses.
- Sound toggle; full-screen mode; wake lock when “Alert me” is on.
- Toast + Undo for ready / hand-over / clear-all.
- Theme follows system light/dark (CSS `prefers-color-scheme`).

## Optional Firebase sync

By default the app is **local-only** (SharedPreferences / localStorage). Staff + Display on the same device stay in sync.

To sync across phones/tablets:

1. Create a Firebase project and a **web app**.
2. Enable **Cloud Firestore** (start in test mode or add rules that allow read/write on `orders`).
3. Edit `www/js/firebase-config.js`:

```js
window.ORDER_BOARD_FIREBASE = {
  apiKey: "...",
  authDomain: "....firebaseapp.com",
  projectId: "...",
  storageBucket: "....appspot.com",
  messagingSenderId: "...",
  appId: "..."
};
```

4. Re-sync natives: `npx cap sync`

Firestore collection: `orders`  
Document ID: token number as string (`"42"`)  
Fields: `{ t: createdMs, r: readyMs|0, c: collectedMs|0 }`

## Capacitor plugins used

- `@capacitor/haptics` — ready buzz
- `@capacitor/local-notifications` — alert when backgrounded
- `@capacitor/preferences` — mine-token / next-number
- `@capacitor/status-bar`, `@capacitor/splash-screen`
- `@capacitor-community/keep-awake` — screen on while alerts enabled

## Known limits (v1)

- Staff tab is always visible (no PIN). Add a long-press / PIN gate later if needed.
- Firebase is optional; without config, sync label shows “Local only”.
- Device IPA needs Apple Developer signing secrets (see above); simulator CI needs none.
- Debug APK is unsigned for Play; use a release keystore for store distribution.
- Google Fonts (Bricolage Grotesque) needs network on first load; system UI font is the fallback.

## License

Private — for Sharan’s use.
