#!/usr/bin/env bash
# Headless Android emulator for Monk's phone half (monk up --phone).
#   scripts/emulator.sh setup   install the system image, create the "monk" AVD (Pixel 7, API 34)
#   scripts/emulator.sh start   boot it headless and wait until it's ready
#   scripts/emulator.sh snapshot  save the clean state the eval runner restores before every task
#   scripts/emulator.sh stop
# Needs the Android command-line tools: https://developer.android.com/studio#command-tools
set -euo pipefail
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
IMAGE="system-images;android-34;google_apis;x86_64"
export PATH="$SDK/cmdline-tools/latest/bin:$SDK/platform-tools:$SDK/emulator:$PATH"

case "${1:-}" in
  setup)
    command -v sdkmanager >/dev/null || { echo "sdkmanager not found under $SDK/cmdline-tools/latest/bin"; exit 1; }
    yes | sdkmanager --licenses >/dev/null
    sdkmanager "platform-tools" "emulator" "$IMAGE"
    echo no | avdmanager create avd -n monk -k "$IMAGE" -d pixel_7 --force
    echo "✓ AVD monk created. next: scripts/emulator.sh start"
    ;;
  start)
    nohup emulator -avd monk -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot-save >/tmp/monk-emulator.log 2>&1 &
    adb wait-for-device
    until [[ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; do sleep 2; done
    adb shell settings put global window_animation_scale 0
    adb shell settings put global transition_animation_scale 0
    adb shell settings put global animator_duration_scale 0
    echo "✓ emulator booted ($(adb shell getprop ro.build.version.release | tr -d '\r'))"
    ;;
  snapshot)
    adb emu avd snapshot save monk-clean
    echo "✓ saved snapshot monk-clean (the eval runner loads it before each mobile task)"
    ;;
  stop)
    adb emu kill || true
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 2
    ;;
esac
