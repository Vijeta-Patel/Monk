#!/usr/bin/env bun
// monk: the terminal UI. `--demo` (or MONK_DEMO=1) plays the showcase with no network;
// `--continue` reopens the last session.
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { loadConfig } from '@monk/shared/config';
import { isReducedMotion } from './anim/frames.ts';
import { Ticker } from './anim/ticker.ts';
import { App } from './app.tsx';
import { DemoBackend } from './backend/demo.ts';
import { LiveBackend } from './backend/live.ts';
import type { MonkBackend } from './backend/types.ts';
import { createTheme, detectColorDepth, detectThemeName } from './theme.ts';

const args = process.argv.slice(2);
const demo = args.includes('--demo') || process.env.MONK_DEMO === '1';
const cont = args.includes('--continue') || args.includes('-c');

const backend: MonkBackend = demo ? new DemoBackend() : new LiveBackend(loadConfig(), { continue: cont });
const reduced = isReducedMotion();
const ticker = new Ticker();
const theme = createTheme(detectThemeName(), detectColorDepth());

// Mouse reporting brings the wheel in to scroll the conversation; most terminals still select
// text with shift+drag. MONK_MOUSE=0 leaves the mouse to the terminal (plain drag selects again).
const mouse = process.env.MONK_MOUSE !== '0';
const renderer = await createCliRenderer({ exitOnCtrlC: false, targetFps: 25, useMouse: mouse, enableMouseMovement: false });
const root = createRoot(renderer);

let quitting = false;
async function quit(): Promise<void> {
  if (quitting) return;
  quitting = true;
  ticker.stop();
  await backend.stop().catch(() => {});
  root.unmount();
  renderer.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => void quit());
root.render(<App backend={backend} ticker={ticker} theme={theme} reduced={reduced} onQuit={() => void quit()} />);
