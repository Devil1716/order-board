# Cue

Two separate apps for a restaurant / cafe **token board**:

| App | Package / Bundle ID | Who uses it |
|---|---|---|
| **Cue** (Student) | `in.sharan.orderboard` | Students / customers — enter token, watch the board, get ready alerts |
| **Cue Staff** | `in.sharan.orderboard.staff` | Counter staff — give tokens, mark ready, hand over |

Native **SwiftUI iOS apps** (iOS 16+, Swift 5.9+) in `ios/Cue.xcodeproj` alongside Android Capacitor apps in `apps/*/android`. **No Display/Staff tabs** — each role is its own installable app.

Repo: https://github.com/Peeyush2005/order-board

---

## Architecture & Project Layout

```
order-board/
  ios/                           # Native iOS Xcode Project & Swift Package
    Cue.xcodeproj                # Single project with Cue and CueStaff schemes
    CueCore/                     # Shared Swift package (models, stores, theme, audio, haptics)
      Sources/CueCore/           # Models, Local & Firestore stores, Theme tokens, Services
      Tests/CueCoreTests/        # Unit tests for expiry, status, token reuse, local store
    Cue/                         # Student SwiftUI app (token entry, tracking cards, alerts)
    CueStaff/                    # Staff SwiftUI app (custom numpad, live tiles, PIN gate)
    GoogleService-Info.plist.example
    project.yml                  # XcodeGen spec for project generation
  shared/                        # Shared CSS, store, native bridge, vendor for web/Android
  apps/student/                  # Student app (Capacitor Android + www)
    android/ www/
  apps/staff/                    # Staff app (Capacitor Android + www)
    android/ www/
  firestore.rules                # Production Firestore security rules
  dist/                          # Local APK output (gitignored binaries)
  .github/workflows/ios.yml      # CI workflow for native iOS schemes + Android APKs
```

---

## Sync Across Devices (Firebase Firestore)

Student and Staff share a board when **Firebase Firestore** is configured. Without it, each app keeps an **offline local-only** store (fine for a single tablet demo; not for phone + counter). When offline or unconfigured, the UI sync badge reads `"On this phone only — connect Firebase to sync with the counter."`

### 1. Firestore Data Schema
- **Collection**: `orders`
- **Document ID**: Token number as string (`"1"` through `"150"`)
- **Fields**:
  - `t` (number): Epoch timestamp (ms) when order was created
  - `r` (number): Epoch timestamp (ms) when marked ready (or `0` if preparing)
  - `c` (number): Epoch timestamp (ms) when collected / handed over (or `0`)

### 2. Business Rules
- **Token range**: 1–150 (tokens are reused as orders are completed).
- **Ready expiry**: A ready order expires **20 minutes** after `r`.
- **Stale order pruning**: Orders older than **4 hours** (based on `t`) are ignored and pruned.
- **Derived status**:
  - `Waiting`: Order not yet created by counter staff.
  - `You're next`: First in queue in preparing queue.
  - `Preparing`: In queue (`X orders ahead`).
  - `Ready`: Ready for counter collection (`Ready X min`).
  - `Collected`: Handed over to student (`c > 0`).
  - `Timed out`: Ready timestamp expired past 20 minutes without collection.

### 3. Deploy Firestore Security Rules
Deploy `firestore.rules` to your Firebase project:

```bash
firebase deploy --only firestore:rules
```

> **Security Note on Staff PIN Gate**: The 4-digit PIN gate in the Staff app is **client-side only** (stored securely in iOS Keychain via `kSecClassGenericPassword`) to prevent accidental customer touches on counter tablets. The Firestore rules allow open reads and validated writes for tokens 1–150.

### 4. iOS Firebase Configuration
1. In Firebase Console, add an **iOS App** for each bundle ID:
   - `in.sharan.orderboard` (Cue)
   - `in.sharan.orderboard.staff` (Cue Staff)
2. Download `GoogleService-Info.plist` and place it in the `ios/` folder (or copy from `GoogleService-Info.plist.example` for testing).
3. If `GoogleService-Info.plist` is absent, the app automatically falls back to the in-memory/UserDefaults store.

---

## Native iOS Build & Run

Requires macOS with Xcode 15+ (Swift 5.9+ through Swift 6+), targeting iOS 16.0+.
`SwiftProtobuf` is pinned to `< 1.29.0` for full backwards compatibility with Xcode 15 and Swift 5.9 toolchains.

### Open in Xcode
```bash
open ios/Cue.xcworkspace
```
*(Opening the `.xcworkspace` ensures the local `CueCore` package and both `Cue` / `CueStaff` app targets are resolved together in Xcode).*

1. Select the **`Cue`** scheme for the Student app, or **`CueStaff`** for the Staff counter app.
2. Select any iOS Simulator or connected physical device.
3. Press **Cmd + R** to run.

### Build from Command Line (Simulator)
```bash
# Build Student app
xcodebuild \
  -project ios/Cue.xcodeproj \
  -scheme Cue \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO

# Build Staff app
xcodebuild \
  -project ios/Cue.xcodeproj \
  -scheme CueStaff \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO
```

### Run Unit Tests
```bash
# Run unit tests via Swift Package Manager
swift test --package-path ios/CueCore

# Or via xcodebuild
xcodebuild \
  -project ios/Cue.xcodeproj \
  -scheme CueCoreTests \
  -destination 'generic/platform=iOS Simulator' \
  test CODE_SIGNING_ALLOWED=NO
```

### Regenerating the Xcode Project (Optional)
The Xcode project is declaratively maintained with `project.yml`. If you modify targets or packages:
```bash
brew install xcodegen
xcodegen generate --spec ios/project.yml --project ios
```

---

## Features & Behavior

### Cue (Student App)
- **Token entry**: Clean numeric input validating 1–150.
- **Multi-order tracking**: Track one or multiple tokens simultaneously with status badges ("You're next", "Preparing: X orders ahead", "Ready", "Collected", "Timed out").
- **View Switcher**: Toggle between **My Orders** (user-centric cards + compact "What's ready" strip) and **Board View** (hero card for latest ready token + ready grid + preparing bar).
- **Full-screen ready alert**: Pops up when a tracked order becomes ready with sound chime (880Hz + 1175Hz), haptic vibration pattern, and background local notification.
- **Keep awake**: Prevents the screen from sleeping while an alert is active or while orders are being tracked.
- **Actions**: "I've collected" and "Remove" order controls. Strictly no staff controls.

### Cue Staff
- **Custom numpad**: 3-column layout (1–9, Clear, 0, Delete) with tactile haptic feedback.
- **Adaptive action button**: Automatically adapts to typed token ("Add token", "Ready: N", "Hand over: N").
- **Quick Mark Ready**: Instant one-tap button to mark the oldest preparing order ready.
- **Token suggestion generator**: Automatically recommends the next available token within 1–150 (reusing freed numbers) with a "Restart at 1" shortcut.
- **Live sections**:
  - **Up next** (Preparing tiles): Oldest order highlighted in red with "Up next" badge, elapsed time (`<1m` / `Xm`), and "Cancel order" link.
  - **Ready** (Ready tiles): Tap to hand over, with "Clear all" confirmation dialog.
- **Toast with Undo**: 6-second floating toast with an instant "Undo" button.
- **PIN Gate**: Optional 4-digit PIN stored in iOS Keychain, prompted on first launch and configurable in Staff Settings.
- **Responsive design**: Works on iPhone and iPad (2-column layout in landscape or portrait for counter stands).

---

## Migration from Capacitor iOS Apps

1. **Native SwiftUI**: The legacy Capacitor/Cordova webview wrapper in `apps/*/ios` has been archived and replaced with pure native SwiftUI in `ios/Cue.xcodeproj`.
2. **Backward Compatibility**: The backend Firestore collection `orders` and document schema `{ t, r, c }` are 100% identical. An Android phone running the Capacitor build and an iPhone running the native SwiftUI build can connect to the same Firebase project simultaneously.
3. **Android**: Android Capacitor builds in `apps/*/android` remain untouched and continue to build with `./gradlew assembleDebug`.

---

## iOS CI & TestFlight / Signing

GitHub Actions workflow [`.github/workflows/ios.yml`](.github/workflows/ios.yml) runs on `macos-latest`:
- **`unit-tests`**: Runs all 19 `CueCore` domain and store unit tests.
- **`simulator`**: Builds both `Cue` and `CueStaff` simulator packages and uploads `.zip` artifacts.
- **`android`**: Builds debug APKs for Student and Staff on Ubuntu.
- **`signing-gate`**: Checks for Apple distribution certificate secrets.

### Device IPA / TestFlight Signing (Template)
The CI workflow currently produces simulator artifacts. Signed IPA export and TestFlight distribution require provisioning profiles per bundle ID. When ready for signed builds, extend the device job template with these repository secrets:
| Secret | Contents |
|---|---|
| `IOS_BUILD_CERTIFICATE_BASE64` | Distribution / Ad Hoc `.p12`, base64 |
| `IOS_BUILD_CERTIFICATE_PASSWORD` | Password for the `.p12` |
| `IOS_PROVISIONING_PROFILE_STUDENT_BASE64` | Provisioning profile for `in.sharan.orderboard` |
| `IOS_PROVISIONING_PROFILE_STAFF_BASE64` | Provisioning profile for `in.sharan.orderboard.staff` |
| `IOS_TEAM_ID` | 10-character Apple Team ID |

> **Notifications Note**: Foreground and active alert notifications are dispatched locally by the app with screen keep-awake enabled while tracking orders. For background push notifications while the app is completely suspended by iOS, connect Firebase Cloud Functions to Apple Push Notification service (APNs).

---

## License

Private — for Sharan’s use.
