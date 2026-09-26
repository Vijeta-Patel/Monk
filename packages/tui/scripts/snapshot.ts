// Renders every demo scene at 120×36 and 80×24 with frozen animations, writes the frames to
// snapshots/, and diffs them cell by cell against the mockups in design/screens/*.md.
//   bun run scripts/snapshot.ts [--verbose] [scene]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENES } from '../src/demo/scenes.ts';
import { paintScreen } from '../src/paint/screen.ts';
import { graphemes, width } from '../src/render/text.ts';

const root = join(import.meta.dir, '..');
const out = join(root, 'snapshots');
mkdirSync(out, { recursive: true });

const TARGETS: { scene: string; file: string; block: string; w: number; h: number }[] = [
  { scene: 'MainIdle', file: 'MainIdle', block: '120 × 36', w: 120, h: 36 },
  { scene: 'MainIdle', file: 'MainIdle', block: '80 × 24', w: 80, h: 24 },
  { scene: 'MainWorking', file: 'MainWorking', block: '120 × 36', w: 120, h: 36 },
  { scene: 'MainWorking', file: 'MainWorking', block: '80 × 24', w: 80, h: 24 },
  { scene: 'SandboxRun', file: 'SandboxRun', block: '120 × 36', w: 120, h: 36 },
  { scene: 'SandboxRun', file: 'SandboxRun', block: '80 × 24', w: 80, h: 24 },
  { scene: 'FaultRecovery', file: 'FaultRecovery', block: '120 × 36', w: 120, h: 36 },
  { scene: 'FaultRecovery.narrow', file: 'FaultRecovery', block: '80 × 24', w: 80, h: 24 },
  { scene: 'PhoneView', file: 'PhoneView', block: '120 × 36', w: 120, h: 36 },
  { scene: 'PhoneView.narrow', file: 'PhoneView', block: '80 × 24', w: 80, h: 24 },
  { scene: 'ApprovalModal', file: 'ApprovalModal', block: '120 × 36', w: 120, h: 36 },
  { scene: 'ApprovalModal', file: 'ApprovalModal', block: '80 × 24', w: 80, h: 24 },
  { scene: 'SkillsBrowser', file: 'SkillsBrowser', block: '120 × 36', w: 120, h: 36 },
  { scene: 'SkillsBrowser', file: 'SkillsBrowser', block: '80 × 24', w: 80, h: 24 },
  { scene: 'CommandPalette', file: 'CommandPalette', block: '120 × 36', w: 120, h: 36 },
  { scene: 'CommandPalette.slash', file: 'CommandPalette', block: '120 × 36, slash commands', w: 120, h: 36 },
  { scene: 'CommandPalette.args', file: 'CommandPalette', block: '80 × 24, slash arguments', w: 80, h: 24 },
];

function mockup(file: string, block: string): string[] {
  const md = readFileSync(join(root, 'design/screens', `${file}.md`), 'utf8');
  const re = new RegExp(`### ${block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\n\`\`\`text\\n([\\s\\S]*?)\`\`\``);
  const m = re.exec(md);
  if (!m) throw new Error(`no mockup ${file} / ${block}`);
  return m[1]!.replace(/\n$/, '').split('\n');
}

/** Row as an array of cells, a wide glyph taking two. */
function cells(line: string, w: number): string[] {
  const outCells: string[] = [];
  for (const g of graphemes(line)) {
    outCells.push(g);
    if (width(g) === 2) outCells.push('');
  }
  while (outCells.length < w) outCells.push(' ');
  return outCells.slice(0, w);
}

const verbose = process.argv.includes('--verbose');
const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
let totalCells = 0;
let totalDiff = 0;
const summary: string[] = [];
for (const t of TARGETS) {
  if (only && t.scene !== only && t.file !== only) continue;
  const sc = SCENES[t.scene]!();
  const canvas = paintScreen(sc.state, { now: sc.now, still: true, reduced: false }, t.w, t.h);
  const got = canvas.lines();
  const name = `${t.scene}.${t.w}x${t.h}`;
  writeFileSync(join(out, `${name}.txt`), `${got.join('\n')}\n`);
  const want = mockup(t.file, t.block);
  let diff = 0;
  const rows: string[] = [];
  for (let y = 0; y < t.h; y++) {
    const a = cells(got[y] ?? '', t.w);
    const b = cells(want[y] ?? '', t.w);
    let d = 0;
    for (let x = 0; x < t.w; x++) if (a[x] !== b[x]) d++;
    diff += d;
    if (d && verbose) rows.push(`  ${String(y).padStart(2)} want|${want[y] ?? ''}\n     got |${got[y] ?? ''}`);
  }
  totalCells += t.w * t.h;
  totalDiff += diff;
  const pct = ((1 - diff / (t.w * t.h)) * 100).toFixed(1);
  summary.push(`${name.padEnd(34)} ${pct.padStart(5)}% match  (${diff} cells differ)`);
  if (verbose && rows.length) console.log(`\n== ${name}\n${rows.join('\n')}`);
}
console.log(`\n${summary.join('\n')}`);
console.log(`\noverall ${((1 - totalDiff / Math.max(1, totalCells)) * 100).toFixed(1)}% of cells match the mockups`);
