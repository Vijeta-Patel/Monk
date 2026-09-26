import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Transcribes a voice note; null when speech to text isn't set up (scripts/setup-stt.sh). */
export type Transcriber = (audio: Buffer, filename: string) => Promise<string | null>;

/** Local faster-whisper through data/stt-venv, so the audio never leaves the machine. */
export function localTranscriber(rootDir: string): Transcriber {
  const python = process.env.STT_PYTHON || join(rootDir, 'data', 'stt-venv', 'bin', 'python');
  const script = join(rootDir, 'scripts', 'transcribe.py');
  return async (audio, filename) => {
    if (!existsSync(python) || !existsSync(script)) return null;
    const dir = await mkdtemp(join(tmpdir(), 'monk-voice-'));
    try {
      const file = join(dir, filename.replace(/[^\w.-]/g, '_'));
      await writeFile(file, audio);
      const text = await new Promise<string>((resolve, reject) =>
        execFile(python, [script, file], { timeout: 120_000 }, (err, stdout, stderr) =>
          err ? reject(new Error(`speech to text failed: ${stderr.trim().split('\n').at(-1) || err.message}`)) : resolve(stdout.trim()),
        ),
      );
      return text;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
}
