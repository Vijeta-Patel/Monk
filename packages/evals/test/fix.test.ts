import { describe, expect, it } from 'vitest';
import { CODE_BUGS, CODE_FILES } from '../src/github/code-fixture.ts';
import { runPython } from '../src/github/fix.ts';

const FIXES: Record<string, [string, string]> = {
  'code-slug': ['    return re.sub(r"[^a-z0-9]", "-", lowered)', '    return re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")'],
  'code-duration': ['    value, unit = parts[-1]\n    return int(value) * _UNITS[unit]', '    return sum(int(v) * _UNITS[u] for v, u in parts)'],
  'code-page': ['    start = page * per_page', '    start = (page - 1) * per_page'],
};

describe('fix-issue checker', () => {
  it('ships three bugs whose own tests pass', () => {
    expect(CODE_BUGS.map((b) => b.key).sort()).toEqual(Object.keys(FIXES).sort());
    expect(CODE_FILES.some((f) => f.path.endsWith('tests/test_textkit.py'))).toBe(true);
  });

  for (const bug of CODE_BUGS) {
    it(`fails the buggy code and passes the fixed code (${bug.key})`, async () => {
      expect((await runPython(CODE_FILES, bug.check)).passed).toBe(false);
      const [from, to] = FIXES[bug.key]!;
      const fixed = CODE_FILES.map((f) => (f.path === bug.file ? { ...f, content: f.content.replace(from, to) } : f));
      expect(fixed.find((f) => f.path === bug.file)!.content).toContain(to);
      const r = await runPython(fixed, bug.check);
      expect(r, r.detail).toMatchObject({ passed: true });
    });
  }

  it('fails when the fix breaks the existing tests', async () => {
    const bug = CODE_BUGS.find((b) => b.key === 'code-slug')!;
    const broken = CODE_FILES.map((f) => (f.path === bug.file ? { ...f, content: 'def slugify(t):\n    return None\n' } : f));
    expect((await runPython(broken, bug.check)).detail).toMatch(/repo tests fail/);
  });
});
