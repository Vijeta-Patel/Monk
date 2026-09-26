import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { localTranscriber } from '../src/stt.ts';

afterEach(() => {
  delete process.env.STT_PYTHON;
});

describe('localTranscriber', () => {
  it('returns null when speech to text is not set up', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monk-stt-'));
    expect(await localTranscriber(root)(Buffer.from('x'), 'v.ogg')).toBeNull();
  });

  it('runs the transcriber on the audio and returns its output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'monk-stt-'));
    mkdirSync(join(root, 'scripts'));
    writeFileSync(join(root, 'scripts', 'transcribe.py'), '');
    const fake = join(root, 'fake-python');
    // Stands in for python: echoes the audio file's contents as the "transcript".
    writeFileSync(fake, '#!/bin/sh\ncat "$2"\n');
    chmodSync(fake, 0o755);
    process.env.STT_PYTHON = fake;
    expect(await localTranscriber(root)(Buffer.from('merge PR 23\n'), 'voice note.ogg')).toBe('merge PR 23');
  });
});
