import { useEffect, useRef, useState } from 'react';
import type { ApiClient, SkillDetail } from '@monk/shared/api';
import { ago, pct } from '../lib/format.ts';

export function SkillDrawer(props: { api: ApiClient; name: string; version: number | undefined; onClose: () => void }) {
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    props.api
      .skill(props.name)
      .then((d) => live && setDetail(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // Refetch when a new version lands while the drawer is open.
  }, [props.api, props.name, props.version]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);

  const d = detail?.name === props.name ? detail : null;
  const verification = d?.verification ?? null;
  const vnum = (k: string) => (verification && typeof verification[k] === 'number' ? (verification[k] as number) : null);

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`skill ${props.name}`}>
      <button aria-label="close" className="absolute inset-0 cursor-default bg-bg/70" onClick={props.onClose} tabIndex={-1} />
      <aside className="drawer-in relative flex h-full w-[min(52rem,62vw)] min-w-[34rem] flex-col border-l border-ghost bg-raised shadow-2xl">
        <header className="flex items-start gap-4 border-b border-ghost px-6 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-[0.8rem] text-faint">skill</div>
            <h2 className="truncate text-[1.5rem] font-extrabold text-ink">{props.name}</h2>
            {d ? (
              <div className="mt-1 flex flex-wrap gap-x-3 text-[0.9rem] text-muted">
                <span>{d.type.replace('_', ' ')}</span>·<span>v{d.version}</span>·
                <span>
                  {d.status === 'retired' || d.status === 'discarded' ? (
                    <>
                      <span className="text-fail">✗</span> {d.status}
                    </>
                  ) : d.verified ? (
                    <>
                      <span className="text-ok">✓</span> verified
                    </>
                  ) : (
                    <>
                      <span className="text-faint">○</span> draft
                    </>
                  )}
                </span>
                ·<span>wins {d.wins} of {d.uses}{d.winRate !== null ? ` (${pct(d.winRate)})` : ''}</span>·<span>learned in gen {d.generation}</span>
              </div>
            ) : null}
          </div>
          <button ref={closeRef} onClick={props.onClose} className="rounded-md px-3 py-1 text-muted ring-1 ring-ghost hover:text-ink">
            esc close
          </button>
        </header>

        {error ? (
          <p className="px-6 py-6 text-muted">
            <span className="text-fail">✗</span> couldn't load this skill. <span className="text-faint">{error}</span>
          </p>
        ) : !d ? (
          <p className="px-6 py-6 text-faint">loading SKILL.md…</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[1fr_auto] overflow-hidden">
            <div className="min-h-0 overflow-y-auto px-6 py-5">
              <div className="mb-2 text-[0.8rem] font-bold text-faint">SKILL.md</div>
              <Markdown text={d.markdown || d.body} />
            </div>
            <div className="max-h-[38vh] overflow-y-auto border-t border-ghost bg-sunken/60 px-6 py-4">
              {vnum('baselinePass') !== null || vnum('withSkillPass') !== null ? (
                <div className="mb-4">
                  <div className="mb-1 text-[0.8rem] font-bold text-faint">verification</div>
                  <div className="flex flex-wrap gap-x-8 text-[0.95rem] text-muted tabular">
                    <span>
                      without skill <span className="font-bold text-ink">{vnum('baselinePass') ?? '–'}</span> passed
                      {vnum('baselineSteps') !== null ? `, ${vnum('baselineSteps')} steps` : ''}
                    </span>
                    <span>
                      with skill <span className="font-bold text-ink">{vnum('withSkillPass') ?? '–'}</span> passed
                      {vnum('withSkillSteps') !== null ? `, ${vnum('withSkillSteps')} steps` : ''}
                    </span>
                  </div>
                </div>
              ) : null}
              <div className="mb-1 text-[0.8rem] font-bold text-faint">git history</div>
              {d.history.length === 0 ? (
                <p className="text-faint">no commits yet.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {d.history.map((h) => (
                    <li key={h.sha} className="grid grid-cols-[6.5rem_7rem_1fr] gap-3 text-[0.9rem]">
                      <code className="text-skill">{h.sha.slice(0, 7)}</code>
                      <span className="text-faint tabular" title={h.date}>
                        {ago(h.date)}
                      </span>
                      <span className="text-ink">{h.message}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

/** SKILL.md as monospace text with just enough emphasis: frontmatter quiet, headings bold. */
function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let inFront = lines[0]?.trim() === '---';
  let fence = 0;
  let inCode = false;
  return (
    <pre className="text-[0.95rem] leading-relaxed whitespace-pre-wrap break-words text-ink">
      {lines.map((l, i) => {
        let cls = 'text-ink';
        if (l.trim() === '---' && inFront) {
          fence++;
          if (fence === 2) inFront = false;
          cls = 'text-ghost';
        } else if (inFront) {
          const m = /^(\s*[\w-]+:)(.*)$/.exec(l);
          if (m)
            return (
              <div key={i}>
                <span className="text-faint">{m[1]}</span>
                <span className="text-muted">{m[2]}</span>
              </div>
            );
          cls = 'text-muted';
        } else if (l.startsWith('```')) {
          inCode = !inCode;
          cls = 'text-faint';
        } else if (inCode) cls = 'text-muted bg-sunken';
        else if (/^#\s/.test(l)) cls = 'font-extrabold text-ink text-[1.1em]';
        else if (/^#{2,}\s/.test(l)) cls = 'font-bold text-ink mt-2';
        else if (/^\s*([-*]|\d+\.)\s/.test(l)) {
          const m = /^(\s*(?:[-*]|\d+\.)\s)(.*)$/.exec(l)!;
          return (
            <div key={i}>
              <span className="text-faint">{m[1]}</span>
              <Inline text={m[2]!} />
            </div>
          );
        }
        return (
          <div key={i} className={cls}>
            {l === '' ? ' ' : cls === 'text-ink' ? <Inline text={l} /> : l}
          </div>
        );
      })}
    </pre>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('`') && p.endsWith('`') && p.length > 1 ? (
          <code key={i} className="rounded bg-sunken px-1 text-ink">
            {p.slice(1, -1)}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
