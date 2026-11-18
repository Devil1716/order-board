#!/usr/bin/env bash
# Picks an available iPhone simulator (small = SE/16e/mini class, large = Pro Max/Plus), boots it,
# cleans the status bar, and writes udid/tag to $GITHUB_OUTPUT.
set -euo pipefail
SIZE="${1:-large}"
JSON=$(xcrun simctl list devices available -j)
pick() {
  SIM_JSON="$JSON" python3 - "$SIZE" <<'PY'
import json, os, sys, re
size = sys.argv[1]
data = json.loads(os.environ["SIM_JSON"])
devs = []
for runtime, items in data["devices"].items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m: continue
    ver = (int(m.group(1)), int(m.group(2)))
    for d in items:
        if d["name"].startswith("iPhone"):
            devs.append((ver, d["name"], d["udid"]))
prefs = {"small": ["iPhone SE (3rd generation)", "iPhone 16e", "iPhone 13 mini", "iPhone 12 mini"],
         "large": ["iPhone 17 Pro Max", "iPhone 16 Pro Max", "iPhone 15 Pro Max", "iPhone 16 Plus", "iPhone 17 Pro"]}[size]
for name in prefs:
    hits = sorted([d for d in devs if d[1] == name], reverse=True)
    if hits:
        print(hits[0][2], hits[0][1], sep="|"); sys.exit(0)
devs.sort(reverse=True)
print(devs[0][2], devs[0][1], sep="|")
PY
}
OUT=$(pick)
UDID="${OUT%%|*}"; NAME="${OUT#*|}"
TAG="${SIZE}-$(echo "$NAME" | tr -cs 'A-Za-z0-9' '-' | sed 's/-$//')"
echo "Using $NAME ($UDID) tag=$TAG"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl status_bar "$UDID" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularBars 4 || true
echo "udid=$UDID" >> "$GITHUB_OUTPUT"
echo "tag=$TAG" >> "$GITHUB_OUTPUT"
echo "name=$NAME" >> "$GITHUB_OUTPUT"
