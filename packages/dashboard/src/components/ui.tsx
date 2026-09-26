import type { ReactNode } from 'react';

export function Panel(props: {
  title: string;
  caption?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={props.id}
      aria-label={props.title}
      className={`flex min-w-0 flex-col rounded-xl bg-raised px-5 pt-4 pb-5 ${props.className ?? ''}`}
    >
      <header className="mb-3 flex min-h-8 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[1.05rem] font-bold tracking-tight text-ink">{props.title}</h2>
        {props.caption ? <span className="text-[0.85rem] text-faint">{props.caption}</span> : null}
        {props.right ? <div className="ml-auto flex items-center gap-2">{props.right}</div> : null}
      </header>
      <div className={`min-h-0 flex-1 ${props.bodyClassName ?? ''}`}>{props.children}</div>
    </section>
  );
}

/** Every empty panel says what's missing and the one command that fills it. */
export function Empty(props: { title: string; children?: ReactNode; command?: string; className?: string }) {
  return (
    <div className={`flex h-full min-h-40 flex-col items-start justify-center gap-2 px-1 ${props.className ?? ''}`}>
      <p className="text-muted">
        <span className="mr-2 text-faint">○</span>
        {props.title}
      </p>
      {props.children ? <p className="max-w-[46ch] text-[0.9rem] text-faint">{props.children}</p> : null}
      {props.command ? <Cmd>{props.command}</Cmd> : null}
    </div>
  );
}

export function Cmd({ children }: { children: ReactNode }) {
  return (
    <code className="inline-block rounded-md bg-sunken px-2.5 py-1 text-[0.85rem] text-ink">
      <span className="mr-2 text-saffron">›</span>
      {children}
    </code>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={props.label} className="flex rounded-lg bg-sunken p-0.5">
      {props.options.map((o) => {
        const on = o.value === props.value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={on}
            onClick={() => props.onChange(o.value)}
            className={`rounded-md px-3 py-1 text-[0.85rem] transition-colors ${on ? 'bg-select text-ink' : 'text-faint hover:text-muted'}`}
          >
            {on ? <span className="mr-1.5 text-saffron">▸</span> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Chip(props: { children: ReactNode; tone?: 'saffron' | 'fault' | 'ok' | 'fail' | 'skill' | 'muted'; title?: string }) {
  const tone = props.tone ?? 'muted';
  const cls: Record<string, string> = {
    saffron: 'bg-saffron-fill text-on-saffron',
    fault: 'text-fault ring-1 ring-current',
    ok: 'text-ok ring-1 ring-current',
    fail: 'text-fail ring-1 ring-current',
    skill: 'text-skill ring-1 ring-current',
    muted: 'text-muted ring-1 ring-ghost',
  };
  return (
    <span title={props.title} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[0.8rem] font-bold whitespace-nowrap ${cls[tone]}`}>
      {props.children}
    </span>
  );
}

/** Label + value; values in ink, never in a data color. */
export function Stat(props: { label: string; value: ReactNode; sub?: ReactNode; glyph?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.8rem] text-faint">{props.label}</div>
      <div className="mt-0.5 flex items-baseline gap-2 text-[1.35rem] font-bold text-ink">
        {props.glyph}
        {props.value}
      </div>
      {props.sub ? <div className="text-[0.8rem] text-muted">{props.sub}</div> : null}
    </div>
  );
}
