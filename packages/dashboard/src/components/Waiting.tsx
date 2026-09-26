import { API_PORT } from '../data/source.ts';
import { Cmd } from './ui.tsx';

const WORDMARK = ['█▀▄▀█ █▀▀█ █▀▀▄ █ ▄▀', '█ ▀ █ █  █ █  █ █▀▄ ', '▀   ▀ ▀▀▀▀ ▀  ▀ ▀  ▀'];
const MONK = ['    ___    ', '   (- -)   ', '  __) (__  ', ' /  \\_/  \\ ', '(____|____)'];

/** Calm full-page state while nothing answers on the API port. Retries on its own. */
export function Waiting(props: { retryIn: number; connecting: boolean }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 text-center">
      <pre className="text-[1.4rem] leading-[1.05] font-bold text-saffron" aria-hidden>
        {WORDMARK.join('\n')}
      </pre>
      <div>
        <pre className="breathe text-[1.3rem] leading-tight text-saffron" aria-hidden>
          {MONK.join('\n')}
        </pre>
        <pre className="text-[1.3rem] leading-tight text-ghost" aria-hidden>
          ~~~~~~~~~~~
        </pre>
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-[1.4rem] text-ink">waiting for monk up on :{API_PORT}</p>
        <p className="text-muted" role="status">
          {props.connecting ? (
            <>
              <span className="text-saffron">⠹</span> trying now…
            </>
          ) : (
            <>
              <span className="text-faint">○</span> trying again in {props.retryIn}s
            </>
          )}
        </p>
        <div className="mt-2 flex flex-col items-center gap-2 text-[0.95rem] text-faint">
          <span>start it in another terminal:</span>
          <Cmd>monk up</Cmd>
          <span className="mt-2">
            or look around with fake data: <a className="text-saffron underline underline-offset-4" href="?demo=1">?demo=1</a>
          </span>
        </div>
      </div>
    </main>
  );
}
