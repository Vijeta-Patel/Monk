import YAML from 'yaml';

export type SkillMdMeta = {
  name: string;
  description: string;
  sourceSessions: string[];
  faultTypes: string[];
  verified: boolean;
  winRate: number | null;
  version: number;
};

function scalar(v: string): string {
  // Plain scalars when safe, YAML-quoted otherwise (descriptions often contain ':' or quotes).
  return YAML.stringify(v, { lineWidth: 0 }).trimEnd();
}

function flowList(items: string[]): string {
  return `[${items.map(scalar).join(', ')}]`;
}

/** The PRD's SKILL.md format. TrueForge ignores frontmatter; the monk: block is for humans and Monk. */
export function renderSkillMd(meta: SkillMdMeta, body: string): string {
  const winRate = meta.winRate === null ? 'null' : String(Math.round(meta.winRate * 100) / 100);
  return [
    '---',
    `name: ${meta.name}`,
    `description: ${scalar(meta.description)}`,
    'monk:',
    `  source_sessions: ${flowList(meta.sourceSessions)}`,
    `  fault_types: ${flowList(meta.faultTypes)}`,
    `  verified: ${meta.verified}`,
    `  win_rate: ${winRate}`,
    `  version: ${meta.version}`,
    '---',
    body.trim(),
    '',
  ].join('\n');
}

export function parseSkillMd(text: string): { meta: SkillMdMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error('SKILL.md has no frontmatter');
  const fm = YAML.parse(m[1] ?? '') as {
    name: string;
    description: string;
    monk?: { source_sessions?: string[]; fault_types?: string[]; verified?: boolean; win_rate?: number | null; version?: number };
  };
  return {
    meta: {
      name: fm.name,
      description: fm.description,
      sourceSessions: fm.monk?.source_sessions ?? [],
      faultTypes: fm.monk?.fault_types ?? [],
      verified: fm.monk?.verified ?? false,
      winRate: fm.monk?.win_rate ?? null,
      version: fm.monk?.version ?? 1,
    },
    body: (m[2] ?? '').trim(),
  };
}
