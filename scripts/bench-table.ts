// Prints a markdown table of benchmark runs from data/monk.db: `node scripts/bench-table.ts <run-id> [<run-id> …]`.
// Each run is one row, labelled by its profile, generation and variant.
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/monk.db', { readOnly: true });
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('usage: bench-table.ts <run-id> …');
const pct = (x: number) => `${Math.round(x * 100)}%`;
console.log('| run | chaos | skills | tasks passed | faults recovered | steps | tokens | cost | cost per solved task | approval safety |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const id of ids) {
  const r = db.prepare('SELECT * FROM eval_runs WHERE id = ?').get(id) as { profile: string; generation: number; variant: string; summary: string } | undefined;
  if (!r) throw new Error(`no run ${id}`);
  const s = JSON.parse(r.summary) as Record<string, number>;
  const skills = r.variant === 'check' ? 'current agent' : r.generation === 0 ? 'none (vanilla)' : `learned, gen ${r.generation}`;
  console.log(
    `| ${r.variant} g${r.generation} | ${r.profile} | ${skills} | ${s.passed}/${s.tasks} (${pct(s.pass_rate!)}) | ${s.faults_recovered}/${s.faults_injected}${s.faults_injected ? ` (${pct(s.recovery_rate!)})` : ''} | ${s.steps} | ${(s.tokens! / 1000).toFixed(0)}k | $${s.cost_usd!.toFixed(3)} | ${s.passed ? `$${s.cost_per_solved!.toFixed(3)}` : '-'} | ${pct(s.approval_safety!)} |`,
  );
}
