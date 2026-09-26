// The OpenTUI shell: one full-screen box whose renderAfter blits the painted canvas. State lives
// in a ref updated by the reducer, the key handler and the wheel; the single 25 fps ticker drives repaints.
import { TextAttributes, type OptimizedBuffer } from '@opentui/core';
import { useKeyboard, usePaste, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Ticker } from './anim/ticker.ts';
import type { MonkBackend } from './backend/types.ts';
import { paintScreen } from './paint/screen.ts';
import type { Canvas } from './render/canvas.ts';
import { width } from './render/text.ts';
import type { Action } from './state/actions.ts';
import { handleKey, handleWheel, type Effect, type Key, type Screen } from './state/keys.ts';
import { initialState, reduce } from './state/reducer.ts';
import type { AppState } from './state/types.ts';
import type { Theme } from './theme.ts';

export function drawCanvas(buffer: OptimizedBuffer, canvas: Canvas, theme: Theme): void {
  const ink = theme.color('ink');
  const bg = theme.color('bg');
  for (let y = 0; y < canvas.h; y++) {
    let x = 0;
    for (const run of canvas.runs(y)) {
      const attrs = (run.bold ? TextAttributes.BOLD : 0) | (run.underline ? TextAttributes.UNDERLINE : 0);
      buffer.drawText(run.text, x, y, run.fg ? theme.color(run.fg) : ink, run.bg ? theme.color(run.bg) : bg, attrs);
      x += width(run.text);
    }
  }
}

export function App(props: { backend: MonkBackend; ticker: Ticker; theme: Theme; reduced: boolean; onQuit: () => void }) {
  const { backend, ticker, theme, reduced, onQuit } = props;
  const renderer = useRenderer();
  const { width: w, height: h } = useTerminalDimensions();
  const stateRef = useRef<AppState>(initialState(Date.now()));
  const [, setVersion] = useState(0);
  const [now, setNow] = useState(() => ticker.now());
  const screen: Screen = { w: Math.max(20, w), h: Math.max(10, h) };

  const dispatch = useCallback((a: Action) => {
    stateRef.current = reduce(stateRef.current, a);
    setVersion((v) => v + 1);
  }, []);

  const runEffects = useCallback(
    (effects: Effect[]) => {
      for (const e of effects) {
        if (e.kind === 'quit') {
          onQuit();
          return;
        }
        void backend.run(e).catch((err: unknown) =>
          dispatch({ type: 'extra', ev: { kind: 'note', glyph: '✗', text: err instanceof Error ? err.message : String(err), tone: 'fail' }, at: Date.now() }),
        );
      }
    },
    [backend, dispatch, onQuit],
  );

  useEffect(() => {
    void backend.start(dispatch, () => stateRef.current);
    return () => void backend.stop();
  }, [backend, dispatch]);

  useEffect(() => ticker.subscribe(setNow), [ticker]);

  useKeyboard((k) => {
    const key: Key = { name: k.name, ctrl: k.ctrl, shift: k.shift, meta: k.meta, sequence: k.sequence };
    const r = handleKey(stateRef.current, key, Date.now(), screen);
    if (r.state !== stateRef.current) {
      stateRef.current = r.state;
      setVersion((v) => v + 1);
    }
    runEffects(r.effects);
  });

  usePaste((e) => {
    const text = new TextDecoder().decode(e.bytes).replace(/\r\n?/g, '\n');
    const s = stateRef.current;
    stateRef.current = { ...s, ui: { ...s.ui, input: { text: s.ui.input.text + text, cursor: s.ui.input.text.length + text.length } } };
    setVersion((v) => v + 1);
  });

  const canvas = useMemo(
    () => paintScreen(stateRef.current, { now, still: false, reduced }, screen.w, screen.h),
    // Repaint on every tick and on any state change (version bumps rerender this component).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [now, w, h, reduced, stateRef.current],
  );

  useEffect(() => {
    renderer.requestRender();
  }, [canvas, renderer]);

  return (
    <box
      width={w}
      height={h}
      renderAfter={function (this: unknown, buffer: OptimizedBuffer) {
        drawCanvas(buffer, canvas, theme);
      }}
      onMouseScroll={(e) => {
        const dir = e.scroll?.direction;
        if (dir !== 'up' && dir !== 'down') return;
        const next = handleWheel(stateRef.current, dir, screen, Date.now(), e.scroll?.delta ?? 1);
        if (next === stateRef.current) return;
        stateRef.current = next;
        setVersion((v) => v + 1);
      }}
    />
  );
}
