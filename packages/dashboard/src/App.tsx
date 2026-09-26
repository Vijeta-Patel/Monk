import { useCallback, useEffect, useMemo, useState } from 'react';
import { pickSource, type Source } from './data/source.ts';
import { useMonk } from './data/useMonk.ts';
import { buildHeatMatrix } from './lib/transforms.ts';
import { palette, useTheme } from './theme.ts';
import { TopBar } from './components/TopBar.tsx';
import { Curve } from './components/Curve.tsx';
import { FaultFeed } from './components/FaultFeed.tsx';
import { Heatmap } from './components/Heatmap.tsx';
import { SkillsTable } from './components/SkillsTable.tsx';
import { SkillDrawer } from './components/SkillDrawer.tsx';
import { CostMeter } from './components/CostMeter.tsx';
import { Controls } from './components/Controls.tsx';
import { Ablations } from './components/Ablations.tsx';
import { Waiting } from './components/Waiting.tsx';

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    void pickSource().then(setSource);
  }, []);
  if (!source) return <Waiting connecting retryIn={0} />;
  return <Dashboard source={source} theme={theme} onToggleTheme={toggleTheme} />;
}

function Dashboard({ source, theme, onToggleTheme }: { source: Source; theme: 'dark' | 'light'; onToggleTheme: () => void }) {
  const api = source.client;
  const d = useMonk(api, { replayRecent: source.demo });
  const pal = useMemo(() => palette(theme), [theme]);
  const [openSkill, setOpenSkill] = useState<string | null>(() => new URLSearchParams(location.search).get('skill'));
  const closeSkill = useCallback(() => setOpenSkill(null), []);

  const heatTotals = useMemo(() => buildHeatMatrix(d.heat ?? []).total, [d.heat]);
  const tools = useMemo(() => {
    const set = new Set<string>();
    for (const c of d.heat ?? []) set.add(c.tool);
    for (const s of d.skills ?? []) for (const t of s.tools) set.add(t);
    return [...set].sort();
  }, [d.heat, d.skills]);

  if (!d.everConnected) return <Waiting retryIn={d.retryIn} connecting={d.status === 'connecting'} />;

  const loading = d.status === 'connecting';
  const openVersion = d.skills?.find((s) => s.name === openSkill)?.version;

  return (
    <div className="min-h-screen">
      <TopBar
        state={d.state}
        injected={heatTotals.injected}
        recovered={heatTotals.recovered}
        status={d.status}
        streaming={d.streaming}
        demo={source.demo ? source.reason : null}
        theme={theme}
        onToggleTheme={onToggleTheme}
        lastFaultAt={d.live.lastFaultAt}
        lastRecoverAt={d.live.lastRecoverAt}
        runningEvals={d.live.runningEvals.size}
      />
      {d.status === 'down' ? (
        <div className="border-b border-ghost bg-raised px-6 py-2 text-center text-muted" role="status">
          <span className="text-faint">○</span> lost monk on :8788 · trying again in {d.retryIn}s · showing the last data it sent
        </div>
      ) : null}
      <main className="mx-auto grid max-w-[2400px] grid-cols-12 gap-5 px-6 py-5">
        <div className="col-span-12 h-[clamp(32rem,64vh,52rem)] xl:col-span-8">
          <Curve points={d.curve} runs={d.runs} pal={pal} loading={loading && !d.curve} />
        </div>
        <div className="col-span-12 h-[clamp(32rem,64vh,52rem)] xl:col-span-4">
          <FaultFeed items={d.feed.items} chaos={d.state?.chaos ?? null} streaming={d.streaming} />
        </div>
        <div className="col-span-12 2xl:col-span-7">
          <Heatmap cells={d.heat} loading={loading && !d.heat} />
        </div>
        <div className="col-span-12 flex 2xl:col-span-5 [&>*]:flex-1">
          <SkillsTable
            skills={d.skills}
            newSkills={d.live.newSkills}
            verifying={d.live.verifying}
            generation={d.state?.generation ?? null}
            onOpen={setOpenSkill}
            selected={openSkill}
            loading={loading && !d.skills}
          />
        </div>
        <div className="col-span-12 lg:col-span-6 2xl:col-span-5">
          <Ablations runs={d.runs} loading={loading && !d.runs} />
        </div>
        <div className="col-span-12 lg:col-span-6 2xl:col-span-3">
          <CostMeter runs={d.runs} costToday={d.state?.costTodayUsd ?? null} live={d.live} pal={pal} loading={loading && !d.runs} />
        </div>
        <div className="col-span-12 2xl:col-span-4">
          <Controls api={api} chaos={d.state?.chaos ?? null} tools={tools} onChanged={() => d.refresh(['state'])} />
        </div>
      </main>
      <footer className="px-6 pb-6 text-center text-[0.8rem] text-faint">
        monk dashboard · {source.demo ? 'demo data, nothing here is real' : 'live from the monk api'} · updates stream in, no refresh needed
      </footer>
      {openSkill ? <SkillDrawer api={api} name={openSkill} version={openVersion} onClose={closeSkill} /> : null}
    </div>
  );
}
