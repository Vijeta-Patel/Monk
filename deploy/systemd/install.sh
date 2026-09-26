#!/usr/bin/env bash
# Installs Monk's stack as systemd user services: runs in the background, restarts on failure,
# starts at login. After this, `pnpm tui` is all you need.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.config/systemd/user
node_bin="$(dirname "$(command -v node)")"
# Units shipped here, plus any a local plugin brings (.local/<name>/systemd/*.service, not in the repo).
for f in "$here"/monk-*.service "$here"/../../.local/*/systemd/monk-*.service; do
  [[ -f "$f" ]] || continue
  sed "s#@NODE_BIN@#$node_bin#g" "$f" > ~/.config/systemd/user/"$(basename "$f")"; done
systemctl --user daemon-reload
units=(monk-trueforge.service monk-up.service)
for f in "$here"/../../.local/*/systemd/monk-*.service; do [[ -f "$f" ]] && units=("$(basename "$f")" "${units[@]}"); done
# The phone half only when an AVD named monk exists (scripts/emulator.sh setup).
if [[ -d ~/.android/avd/monk.avd ]]; then units=(monk-emulator.service "${units[@]}"); fi
systemctl --user enable --now "${units[@]}"
systemctl --user --no-pager status "${units[@]}" | grep -E "●|Active:"
