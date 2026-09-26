#!/usr/bin/env bash
# Local speech to text for Telegram voice notes: a venv with faster-whisper under data/stt-venv.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
python3 -m venv "$root/data/stt-venv"
"$root/data/stt-venv/bin/pip" install -q faster-whisper
"$root/data/stt-venv/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('${STT_MODEL:-base}', device='cpu', compute_type='int8')"
echo "✓ speech to text ready; restart monk up (pnpm monk stack restart)"
