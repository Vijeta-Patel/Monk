// Which mood monk is in, derived from state. The top-bar face and the sidebar mascot both use it.
import { FAULT_MS, MONK_FAULT_SEQUENCE, type Clock, type FaceMood } from '../anim/frames.ts';
import type { AppState } from '../state/types.ts';

export type Mood = 'idle' | 'work' | 'look' | 'fault' | 'gate' | 'phone';

export const FAULT_SEQUENCE_MS = MONK_FAULT_SEQUENCE.length * FAULT_MS;

export function moodOf(s: AppState, clock: Clock): Mood {
  if (s.approval) return 'gate';
  if (s.moodFaultAt !== null && clock.now >= s.moodFaultAt && clock.now - s.moodFaultAt < FAULT_SEQUENCE_MS) return 'fault';
  if (!s.turn.running) return 'idle';
  if (s.phone.active) return 'phone';
  const running = s.items.findLast((it) => it.kind === 'step' && it.state === 'running');
  if (running && running.kind === 'step' && running.run && s.ui.wellOpen === running.id) return 'look';
  return 'work';
}

export function faceMood(m: Mood): FaceMood {
  return m === 'look' ? 'work' : m;
}
