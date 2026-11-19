#!/usr/bin/env bash
# Runs inside the Android emulator in CI: install the release APK (embedded JS bundle) and run Maestro.
# Env: E2E_EMAIL / E2E_PASSWORD (optional, enables flows tagged "auth"),
#      E2E_EXCLUDE_TAGS (default "needs-new-backend").
set -euo pipefail

APK="android/app/build/outputs/apk/release/app-release.apk"
adb install -r "$APK"
adb shell pm clear com.lardermind.app || true

EXCLUDE="${E2E_EXCLUDE_TAGS-needs-new-backend}"
EXCLUDE="$(echo "$EXCLUDE" | tr -d '[:space:]')"
ENV_ARGS=()
if [ -n "${E2E_EMAIL:-}" ] && [ -n "${E2E_PASSWORD:-}" ]; then
  ENV_ARGS+=(-e "EMAIL=${E2E_EMAIL}" -e "PASSWORD=${E2E_PASSWORD}")
else
  EXCLUDE="${EXCLUDE:+$EXCLUDE,}auth"
fi

TAG_ARGS=()
if [ -n "$EXCLUDE" ]; then TAG_ARGS+=(--exclude-tags="$EXCLUDE"); fi

mkdir -p maestro-out
maestro test "${ENV_ARGS[@]}" "${TAG_ARGS[@]}" \
  --format=junit --output=maestro-out/report.xml \
  --debug-output=maestro-out/debug \
  .maestro
