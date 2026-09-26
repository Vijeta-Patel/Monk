"""Speech to text for Telegram voice notes: `transcribe.py <audio-file>` prints the transcript.

Local faster-whisper on the CPU (model from STT_MODEL, default "base"); the audio never leaves
this machine. Set up with scripts/setup-stt.sh.
"""
import os
import sys

from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("STT_MODEL", "base"), device="cpu", compute_type="int8")
segments, _info = model.transcribe(sys.argv[1], vad_filter=True)
print(" ".join(s.text.strip() for s in segments).strip())
