import type { Action } from '../state/actions.ts';
import type { Effect } from '../state/keys.ts';
import type { AppState } from '../state/types.ts';

export type Dispatch = (a: Action) => void;

/** Where state comes from. `live` talks to TrueForge + the Monk API; `demo` plays a script. */
export interface MonkBackend {
  readonly kind: 'live' | 'demo';
  start(dispatch: Dispatch, getState: () => AppState): Promise<void>;
  run(effect: Effect): Promise<void>;
  stop(): Promise<void>;
}
