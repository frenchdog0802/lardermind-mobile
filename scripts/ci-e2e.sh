#!/usr/bin/env bash
# Runs inside the Android emulator in CI: install the release APK (embedded JS bundle) and run Maestro.
# Env: E2E_EMAIL / E2E_PASSWORD (optional, enables flows tagged "auth"),
#      E2E_EXCLUDE_TAGS (default "needs-new-backend").
set -euo pipefail

APK="android/app/build/outputs/apk/release/app-release.apk"

# A slow CI emulator can raise "X isn't responding" system dialogs that cover the app and hide it from Maestro.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global package_verifier_enable 0 || true
adb shell input keyevent KEYCODE_HOME || true

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

set +e
maestro test "${ENV_ARGS[@]}" "${TAG_ARGS[@]}"   --format=junit --output=maestro-out/report.xml   --debug-output=maestro-out/debug   .maestro
STATUS=$?
set -e

if [ "$STATUS" -ne 0 ]; then
  echo "[ci-e2e] Maestro failed (exit $STATUS); collecting diagnostics"
  adb exec-out screencap -p > maestro-out/final-screen.png || true
  adb logcat -d -t 3000 > maestro-out/logcat.txt || true
  adb shell dumpsys activity activities 2>/dev/null | grep -E "mResumedActivity|topResumedActivity" > maestro-out/resumed-activity.txt || true
  cp -r "$HOME/.maestro/tests" maestro-out/maestro-tests 2>/dev/null || true
fi
exit "$STATUS"
