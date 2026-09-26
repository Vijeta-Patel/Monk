import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A small real Python package (stdlib only, unittest) with three real bugs, seeded into the eval
 * repo under `textkit-app/`. Its own tests pass; each bug is filed as an issue with a repro. The
 * fix-issue tasks are checked by running a hidden test against the PR's head, never by the answer.
 */
export const CODE_DIR = 'textkit-app';
const SRC = join(import.meta.dirname, '..', '..', 'fixtures', CODE_DIR);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '__pycache__') return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export const CODE_FILES: { path: string; content: string }[] = walk(SRC)
  .sort()
  .map((p) => ({ path: `${CODE_DIR}/${relative(SRC, p)}`, content: readFileSync(p, 'utf8') }));

export type CodeBug = {
  key: string;
  title: string;
  body: string;
  /** The file the fix belongs in. */
  file: string;
  /** Hidden regression check, run from the package root with python3; must exit 0 once fixed. */
  check: string;
};

const run = `cd ${CODE_DIR} && python3 -m unittest -q`;

export const CODE_BUGS: CodeBug[] = [
  {
    key: 'code-slug',
    title: 'slugify leaves double and trailing dashes',
    body: [
      'Titles with punctuation produce ugly slugs.',
      '',
      '## Steps to reproduce',
      '```python',
      'from textkit import slugify',
      'slugify("Hello, World!")',
      '```',
      '',
      '## Expected',
      '`"hello-world"`',
      '',
      '## Actual',
      '`"hello--world-"`',
      '',
      `Code: \`${CODE_DIR}/textkit/slug.py\`. Run the tests with \`${run}\`.`,
    ].join('\n'),
    file: `${CODE_DIR}/textkit/slug.py`,
    check: [
      'from textkit import slugify',
      'assert slugify("Hello, World!") == "hello-world", slugify("Hello, World!")',
      'assert slugify("  Rock & Roll -- 2024  ") == "rock-roll-2024", slugify("  Rock & Roll -- 2024  ")',
      'assert slugify("Hello World") == "hello-world"',
    ].join('\n'),
  },
  {
    key: 'code-duration',
    title: 'parse_duration("1h30m") returns 1800 instead of 5400',
    body: [
      'Compound durations only count the last unit.',
      '',
      '## Steps to reproduce',
      '```python',
      'from textkit import parse_duration',
      'parse_duration("1h30m")',
      '```',
      '',
      '## Expected',
      '`5400` (one hour and thirty minutes, in seconds)',
      '',
      '## Actual',
      '`1800`',
      '',
      `Code: \`${CODE_DIR}/textkit/duration.py\`. Run the tests with \`${run}\`.`,
    ].join('\n'),
    file: `${CODE_DIR}/textkit/duration.py`,
    check: [
      'from textkit import parse_duration',
      'assert parse_duration("1h30m") == 5400, parse_duration("1h30m")',
      'assert parse_duration("2h5m10s") == 7510, parse_duration("2h5m10s")',
      'assert parse_duration("90s") == 90',
    ].join('\n'),
  },
  {
    key: 'code-page',
    title: 'paginate: page 1 skips the first page of results',
    body: [
      'Pages are documented as starting at 1, but page 1 returns the second page.',
      '',
      '## Steps to reproduce',
      '```python',
      'from textkit import paginate',
      'paginate(list(range(1, 26)), 1)',
      '```',
      '',
      '## Expected',
      '`[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]`',
      '',
      '## Actual',
      '`[11, 12, 13, 14, 15, 16, 17, 18, 19, 20]`',
      '',
      `Code: \`${CODE_DIR}/textkit/paginate.py\`. Run the tests with \`${run}\`.`,
    ].join('\n'),
    file: `${CODE_DIR}/textkit/paginate.py`,
    check: [
      'from textkit import paginate',
      'items = list(range(1, 26))',
      'assert paginate(items, 1) == list(range(1, 11)), paginate(items, 1)',
      'assert paginate(items, 3) == [21, 22, 23, 24, 25], paginate(items, 3)',
      'assert paginate(items, 4) == []',
    ].join('\n'),
  },
];
