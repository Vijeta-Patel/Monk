// Renders demo scenes to colored HTML and screenshots them with headless Chrome, so the design
// can be reviewed as images: snapshots/<Scene>.<cols>x<rows>.png
//   bun run scripts/png.ts
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENES } from '../src/demo/scenes.ts';
import { paintScreen } from '../src/paint/screen.ts';
import { width } from '../src/render/text.ts';
import { dark, type Token } from '../design/src/theme.ts';

const root = join(import.meta.dir, '..');
const out = join(root, 'snapshots');
mkdirSync(out, { recursive: true });
const color = (p: string | undefined, fallback: Token) => (p ? (p.startsWith('#') ? p : dark[p as Token]) : dark[fallback]);
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const CELL_W = 9;
const CELL_H = 18;
const shots: [string, number, number][] = [
  ['MainIdle', 120, 36], ['MainIdle', 80, 24], ['MainWorking', 120, 36], ['SandboxRun', 120, 36], ['FaultRecovery', 120, 36],
  ['PhoneView', 120, 36], ['ApprovalModal', 120, 36], ['ApprovalModal', 80, 24], ['SkillsBrowser', 120, 36], ['CommandPalette', 120, 36],
  ['CommandPalette.slash', 120, 36], ['MainWorking', 80, 24],
];
const chrome = process.env.CHROME ?? 'google-chrome';
for (const [scene, w, h] of shots) {
  const sc = SCENES[scene]!();
  const c = paintScreen(sc.state, { now: sc.now, still: true, reduced: false }, w, h);
  let html = '';
  for (let y = 0; y < h; y++) {
    let x = 0;
    for (const r of c.runs(y)) {
      const cw = width(r.text);
      html += `<span style="position:absolute;left:${x * CELL_W}px;top:${y * CELL_H}px;width:${cw * CELL_W}px;height:${CELL_H}px;color:${color(r.fg, 'ink')};background:${color(r.bg, 'bg')};${r.bold ? 'font-weight:700;' : ''}${r.underline ? 'text-decoration:underline;' : ''}">${esc(r.text)}</span>`;
      x += cw;
    }
  }
  const page = `<!doctype html><meta charset=utf-8><style>body{margin:0;background:${dark.bg}}div{position:relative;width:${w * CELL_W}px;height:${h * CELL_H}px;font:15px/${CELL_H}px "JetBrains Mono","DejaVu Sans Mono",monospace;white-space:pre;letter-spacing:0}span{overflow:hidden}</style><div>${html}</div>`;
  const file = join(out, `_${scene}.${w}x${h}.html`);
  writeFileSync(file, page);
  const png = join(out, `${scene}.${w}x${h}.png`);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${w * CELL_W},${h * CELL_H}`, `--screenshot=${png}`, `file://${file}`], { stdio: 'ignore', timeout: 60_000 });
  rmSync(file);
  console.log(png);
}
