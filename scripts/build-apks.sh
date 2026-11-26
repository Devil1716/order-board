#!/usr/bin/env bash
# Builds the student + staff APKs into OUT_DIR (default: out) as Cue-<app><SUFFIX>.apk, plus signed
# Play Store bundles (Cue-<app><SUFFIX>.aab) when a release key is available.
#
# Signing: with ANDROID_KEYSTORE_BASE64 + ANDROID_KEYSTORE_PASSWORD (CI secrets), or CUE_KEYSTORE_FILE +
# CUE_KEYSTORE_PASSWORD (a local keystore), it builds *release* APKs signed with the fixed Cue key, so each
# new APK installs over the last one. Without a key it builds debug APKs signed with this machine's debug key
# (fine for testing, but they will NOT install over APKs signed elsewhere).
set -euo pipefail
OUT_DIR="${1:-out}"
SUFFIX="${2:-}"
mkdir -p "$OUT_DIR"

VARIANT=debug
if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ]; then
  KS="${RUNNER_TEMP:-/tmp}/cue-release-$$.jks"
  printf '%s' "$ANDROID_KEYSTORE_BASE64" | base64 --decode > "$KS"
  trap 'rm -f "$KS"' EXIT
  export CUE_KEYSTORE_FILE="$KS"
  export CUE_KEYSTORE_PASSWORD="$ANDROID_KEYSTORE_PASSWORD"
  export CUE_KEY_ALIAS="${ANDROID_KEY_ALIAS:-cue}"
  export CUE_KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}"
  VARIANT=release
elif [ -n "${CUE_KEYSTORE_FILE:-}" ] && [ -f "${CUE_KEYSTORE_FILE}" ] && [ -n "${CUE_KEYSTORE_PASSWORD:-}" ]; then
  VARIANT=release
else
  echo "::warning title=APK signing::No Cue signing key (ANDROID_KEYSTORE_BASE64 secret). Building debug APKs signed with this runner's throwaway debug key: they will not install over earlier APKs."
fi
TASK="assemble$(tr '[:lower:]' '[:upper:]' <<< "${VARIANT:0:1}")${VARIANT:1}"

for a in student staff; do
  TASKS=("$TASK")
  [ "$VARIANT" = release ] && TASKS+=(bundleRelease)
  (cd "apps/$a" && npx cap sync android && cd android && chmod +x gradlew && ./gradlew "${TASKS[@]}" --no-daemon)
  cp "apps/$a/android/app/build/outputs/apk/$VARIANT/app-$VARIANT.apk" "$OUT_DIR/Cue-$a$SUFFIX.apk"
  echo "Built $OUT_DIR/Cue-$a$SUFFIX.apk ($VARIANT)"
  if [ "$VARIANT" = release ]; then
    cp "apps/$a/android/app/build/outputs/bundle/release/app-release.aab" "$OUT_DIR/Cue-$a$SUFFIX.aab"
    echo "Built $OUT_DIR/Cue-$a$SUFFIX.aab (Play Store bundle)"
  fi
  keytool -printcert -jarfile "$OUT_DIR/Cue-$a$SUFFIX.apk" 2>/dev/null | grep -m1 'SHA256:' || true
done
