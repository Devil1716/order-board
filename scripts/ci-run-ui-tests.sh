#!/usr/bin/env bash
# Runs the Cue UI tests on one simulator with a screen recording.
# Usage: ci-run-ui-tests.sh <small|large> <local|firebase> <only-testing...>
set -uo pipefail
SIZE="$1"; MODE="$2"; shift 2
OUT="$GITHUB_WORKSPACE/out"
mkdir -p "$OUT/shots"
GITHUB_OUTPUT=/tmp/sim-$SIZE.env bash scripts/ci-pick-simulator.sh "$SIZE"
UDID=$(grep '^udid=' /tmp/sim-$SIZE.env | cut -d= -f2)
TAG=$(grep '^tag=' /tmp/sim-$SIZE.env | cut -d= -f2)
[ "$MODE" = firebase ] && TAG="$TAG-firebase"
ONLY=()
for t in "$@"; do ONLY+=("-only-testing:$t"); done

xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$OUT/$TAG-run.mp4" &
REC=$!
sleep 2
TEST_RUNNER_CUE_SHOT_DIR="$OUT/shots" TEST_RUNNER_CUE_DEVICE_TAG="$TAG" TEST_RUNNER_CUE_MODE="$MODE" \
xcodebuild -project ios/CueUITests.xcodeproj -scheme CueAllUITests \
  -destination "id=$UDID" -derivedDataPath build \
  -resultBundlePath "$OUT/$TAG.xcresult" "${ONLY[@]}" \
  test-without-building > "$OUT/$TAG-xcodebuild.log" 2>&1
STATUS=$?
kill -INT $REC; wait $REC 2>/dev/null || true
grep -E "Test Case .*(passed|failed)|error: " "$OUT/$TAG-xcodebuild.log" || true
xcrun simctl shutdown "$UDID" || true
echo "== $TAG: xcodebuild exit $STATUS"
exit $STATUS
