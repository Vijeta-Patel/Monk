#!/usr/bin/env bash
# Installs Monk's stack as systemd user services: runs in the background, restarts on failure,
# starts at login. After this, `pnpm tui` is all you need.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p ~/.config/systemd/user
node_bin="$(dirname "$(command -v node)")"
for f in "$here"/monk-*.service; do sed "s#@NODE_BIN@#$node_bin#g" "$f" > ~/.config/systemd/user/"$(basename "$f")"; done
systemctl --user daemon-reload
units=(monk-agenteye.service monk-trueforge.service monk-up.service)
# The phone half only when an AVD named monk exists (scripts/emulator.sh setup).
if [[ -d ~/.android/avd/monk.avd ]]; then units=(monk-emulator.service "${units[@]}"); fi
systemctl --user enable --now "${units[@]}"
systemctl --user --no-pager status monk-trueforge monk-up monk-agenteye monk-emulator | grep -E "●|Active:"
