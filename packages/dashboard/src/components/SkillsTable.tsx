import { useMemo } from 'react';
import type { SkillRow } from '@monk/shared/api';
import { pct } from '../lib/format.ts';
import { Empty, Panel } from './ui.tsx';

const TYPE_LABEL: Record<SkillRow['type'], string> = { recovery: 'recovery', procedure: 'procedure', tool_quirk: 'tool quirk' };

/** 5 cells, 1 block = 20%, like the TUI skills browser. */
function WinBar({ rate }: { rate: number }) {
  const full = Math.round(rate * 5);
  return (
    <span className="ml-2 inline-flex gap-[2px] align-middle" aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={`inline-block h-3 w-2 rounded-[1px] ${i < full ? 'bg-skill' : 'bg-ghost/70'}`} />
      ))}
    </span>
  );
}

export function SkillsTable(props: {
  skills: SkillRow[] | null;
  newSkills: Set<string>;
  verifying: Set<string>;
  generation: number | null;
  onOpen: (name: string) => void;
  selected: string | null;
  loading: boolean;
}) {
  const { active, retired } = useMemo(() => {
    const list = props.skills ?? [];
    const score = (s: SkillRow) => (props.newSkills.has(s.name) ? 1 : 0);
    const active = list
      .filter((s) => s.status === 'active' || s.status === 'draft')
      .sort((a, b) => score(b) - score(a) || b.generation - a.generation || b.uses - a.uses || a.name.localeCompare(b.name));
    const retired = list.filter((s) => s.status === 'retired' || s.status === 'discarded').sort((a, b) => a.name.localeCompare(b.name));
    return { active, retired };
  }, [props.skills, props.newSkills]);

  const pendingNames = [...props.verifying].filter((n) => !(props.skills ?? []).some((s) => s.name === n));
  const empty = active.length + retired.length + pendingNames.length === 0;

  const caption = empty ? null : (
    <span className="tabular">
      {active.length} active · {retired.length} retired
      {props.newSkills.size ? (
        <>
          {' '}· <span className="text-saffron">✦</span> {props.newSkills.size} new
        </>
      ) : null}
    </span>
  );

  return (
    <Panel title="skills" caption={caption} right={empty ? null : <span className="text-[0.8rem] text-faint">click a skill for SKILL.md</span>} bodyClassName="relative min-h-[24rem]">
      {empty ? (
        <Empty title={props.loading ? 'loading…' : 'no skills learned yet.'} command={props.loading ? undefined : 'monk learn'}>
          {props.loading ? null : 'Monk turns recoveries into SKILL.md files after each bench generation, verifies them in the sandbox, and lists them here.'}
        </Empty>
      ) : (
        <div className="absolute inset-0 overflow-y-auto">
          <table className="w-full table-fixed text-left">
            <colgroup>
              <col />
              <col className="w-[6.4rem]" />
              <col className="w-[3.4rem]" />
              <col className="w-[8.2rem]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-raised text-[0.8rem] text-faint">
              <tr>
                <th className="py-1.5 pl-2 font-medium">name</th>
                <th className="font-medium">verified</th>
                <th className="pr-3 text-right font-medium">uses</th>
                <th className="font-medium">win rate</th>
              </tr>
            </thead>
            <tbody>
              {pendingNames.map((n) => (
                <tr key={n} className="border-t border-ghost/50">
                  <td className="truncate py-2 pl-2 text-ink">
                    <span className="mr-2 text-saffron">✦</span>
                    {n}
                  </td>
                  <td className="text-skill">
                    ◐ <span className="text-muted">checking</span>
                  </td>
                  <td />
                  <td className="text-faint">new</td>
                </tr>
              ))}
              {active.map((s) => (
                <SkillTr key={s.name} s={s} isNew={props.newSkills.has(s.name)} verifying={props.verifying.has(s.name)} onOpen={props.onOpen} selected={props.selected === s.name} />
              ))}
              {retired.length ? (
                <tr>
                  <td colSpan={4} className="pt-4 pb-1 pl-2 text-[0.75rem] font-bold tracking-wider text-faint">RETIRED</td>
                </tr>
              ) : null}
              {retired.map((s) => (
                <SkillTr key={s.name} s={s} isNew={false} verifying={false} onOpen={props.onOpen} selected={props.selected === s.name} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function SkillTr(props: { s: SkillRow; isNew: boolean; verifying: boolean; onOpen: (n: string) => void; selected: boolean }) {
  const { s } = props;
  const gone = s.status === 'retired' || s.status === 'discarded';
  return (
    <tr
      tabIndex={0}
      onClick={() => props.onOpen(s.name)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onOpen(s.name))}
      className={`cursor-pointer border-t border-ghost/50 transition-colors hover:bg-select ${props.selected ? 'bg-select' : props.isNew ? 'bg-saffron/10' : ''}`}
      aria-selected={props.selected}
    >
      <td className="py-1.5 pl-2" title={s.description}>
        <div className="truncate">
          {props.selected ? <span className="mr-1.5 text-saffron">▸</span> : null}
          {props.isNew ? <span className="mr-1.5 text-saffron" title="new this session">✦</span> : null}
          <span className={gone ? 'text-muted line-through decoration-fail/70' : 'text-ink'}>{s.name}</span>
        </div>
        <div className="truncate text-[0.8rem] text-faint">
          {TYPE_LABEL[s.type] ?? s.type} · v{s.version} · gen {s.generation}
        </div>
      </td>
      <td className="whitespace-nowrap">
        {gone ? (
          <span>
            <span className="text-fail">✗</span> <span className="text-muted">{s.status}</span>
          </span>
        ) : props.verifying ? (
          <span>
            <span className="text-skill">◐</span> <span className="text-muted">checking</span>
          </span>
        ) : s.verified ? (
          <span>
            <span className="text-ok">✓</span> <span className="text-muted">yes</span>
          </span>
        ) : (
          <span>
            <span className="text-faint">○</span> <span className="text-muted">draft</span>
          </span>
        )}
      </td>
      <td className="pr-3 text-right text-ink tabular">{s.uses}</td>
      <td className="whitespace-nowrap tabular">
        {s.winRate === null || s.uses === 0 ? (
          <span className="text-faint">{props.isNew ? 'new' : '–'}</span>
        ) : (
          <>
            <span className="inline-block w-[4.2ch] text-right text-ink">{pct(s.winRate)}</span>
            <WinBar rate={s.winRate} />
          </>
        )}
      </td>
    </tr>
  );
}
