import { proxyLlm, type MonkConfig } from '@monk/shared';
import { Cron } from 'croner';
import cronstrue from 'cronstrue';

/** Same shape as @monk/learn's Llm: a JSON-returning completion. */
import type { Llm } from '@monk/shared';
export type { Llm };

export type ParsedSchedule = { cron: string; human: string };
export type ParsedJobRequest = ParsedSchedule & { prompt: string; kind: 'prompt' | 'chaos_drill'; chaosProfile: string | null };

const DAY_INDEX: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY = '(?:sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)';

type Span = { start: number; end: number };
type DaySpec = Span & { dow: string; dom: string; human: string; defaultHour: number };
type Time = Span & { h: number; m: number };

const pad = (n: number) => String(n).padStart(2, '0');

/** Throws unless `expr` is a valid 5-field cron expression. */
export function validateCron(expr: string): void {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error(`"${expr}" is not a 5-field cron expression`);
  try {
    new Cron(expr, { paused: true, mode: '5-part' }).stop();
  } catch (err) {
    throw new Error(`"${expr}" is not a valid cron expression: ${(err as Error).message}`);
  }
}

/** Plain-English schedule for any cron expression, lowercase, 24-hour clock. */
export function describeCron(expr: string): string {
  return cronstrue.toString(expr, { use24HourTimeFormat: true, verbose: false }).toLowerCase();
}

// Time of day, anchored at the start of `s`: "at 9am", "9:30 pm", "18:30", "noon", "at 9".
function timeAtStart(s: string): { h: number; m: number; len: number } | null {
  const lead = /^[\s,]*(?:at\s+|@\s*)?/.exec(s)![0];
  const rest = s.slice(lead.length);
  const hasAt = /at\s+$|@\s*$/.test(lead);
  let m: RegExpExecArray | null;
  let h: number;
  let min = 0;
  let len: number;
  if ((m = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?![a-z])/.exec(rest))) {
    h = Number(m[1]);
    min = Number(m[2] ?? 0);
    if (h < 1 || h > 12) return null;
    const pm = m[3]!.startsWith('p');
    h = (h % 12) + (pm ? 12 : 0);
    len = m[0].length;
  } else if ((m = /^(\d{1,2})[:.](\d{2})(?!\d)/.exec(rest))) {
    h = Number(m[1]);
    min = Number(m[2]);
    len = m[0].length;
  } else if ((m = /^(noon|midnight)\b/.exec(rest))) {
    h = m[1] === 'noon' ? 12 : 0;
    len = m[0].length;
  } else if (hasAt && (m = /^(\d{1,2})(?![\d:.])(?!\s*(?:minutes?|mins?|hours?|hrs?|%|st|nd|rd|th)\b)/.exec(rest))) {
    h = Number(m[1]);
    len = m[0].length;
  } else return null;
  if (h > 23 || min > 59) return null;
  return { h, m: min, len: lead.length + len };
}

function timeAfter(t: string, pos: number): Time | null {
  const r = timeAtStart(t.slice(pos));
  return r ? { h: r.h, m: r.m, start: pos, end: pos + r.len } : null;
}

// A time phrase that ends right before `pos` ("at 9am every weekday").
function timeBefore(t: string, pos: number): Time | null {
  const prefix = t.slice(0, pos);
  const re = /(?:\bat\s+|@\s*)?(?:\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)|\d{1,2}[:.]\d{2}|noon|midnight)[\s,]*$/;
  const m = re.exec(prefix);
  if (!m) return null;
  const r = timeAtStart(m[0]);
  return r ? { h: r.h, m: r.m, start: m.index, end: pos } : null;
}

function findDaySpec(t: string): DaySpec | null {
  const tries: [RegExp, (m: RegExpExecArray) => Omit<DaySpec, 'start' | 'end'>][] = [
    [/\b(?:every|each)\s+(?:weekday|work\s*day|business\s+day)s?\b|\b(?:on\s+)?weekdays\b|\bmonday\s+(?:to|through|-)\s+friday\b/, () => ({ dow: '1-5', dom: '*', human: 'every weekday', defaultHour: 9 })],
    [/\b(?:every|each)\s+weekend(?:\s+day)?s?\b|\b(?:on\s+)?weekends\b/, () => ({ dow: '0,6', dom: '*', human: 'every weekend day', defaultHour: 10 })],
    [
      new RegExp(`\\b(?:every|each|on)\\s+(${DAY}s?(?:\\s*(?:,|and|&)\\s*${DAY}s?)*)\\b`),
      (m) => {
        const days = [...new Set((m[1] ?? '').split(/\s*(?:,|and|&)\s*/).map((d) => DAY_INDEX[d.replace(/s$/, '')] ?? DAY_INDEX[d]!))].sort();
        const names = days.map((d) => DAY_NAMES[d]!);
        const human = `every ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}`;
        return { dow: days.join(','), dom: '*', human, defaultHour: 9 };
      },
    ],
    [/\b(?:nightly|every\s+night|each\s+night)\b/, () => ({ dow: '*', dom: '*', human: 'every night', defaultHour: 2 })],
    [/\bevery\s+morning\b/, () => ({ dow: '*', dom: '*', human: 'every day', defaultHour: 9 })],
    [/\bevery\s+evening\b/, () => ({ dow: '*', dom: '*', human: 'every day', defaultHour: 18 })],
    [/\b(?:every\s*day|daily|each\s+day)\b/, () => ({ dow: '*', dom: '*', human: 'every day', defaultHour: 9 })],
    [
      /\b(?:every\s+month|monthly)(?:\s+on\s+the\s+(\d{1,2})(?:st|nd|rd|th)?)?\b/,
      (m) => {
        const d = Math.min(28, Math.max(1, Number(m[1] ?? 1)));
        return { dow: '*', dom: String(d), human: `every month on day ${d}`, defaultHour: 9 };
      },
    ],
  ];
  for (const [re, build] of tries) {
    const m = re.exec(t);
    if (m) return { ...build(m), start: m.index, end: m.index + m[0].length };
  }
  return null;
}

type Found = ParsedSchedule & { spans: Span[] };

function findInterval(t: string): Found | null {
  let m: RegExpExecArray | null;
  if ((m = /\bevery\s+(\d{1,2})\s*(?:minutes?|mins?)\b/.exec(t))) {
    const n = Number(m[1]);
    if (n < 1 || n > 59) return null;
    return { cron: `*/${n} * * * *`, human: n === 1 ? 'every minute' : `every ${n} minutes`, spans: [{ start: m.index, end: m.index + m[0].length }] };
  }
  if ((m = /\bevery\s+(?:half\s+(?:an\s+)?hour|30\s*min)\b/.exec(t))) {
    return { cron: '*/30 * * * *', human: 'every 30 minutes', spans: [{ start: m.index, end: m.index + m[0].length }] };
  }
  if ((m = /\bevery\s+minute\b/.exec(t))) return { cron: '* * * * *', human: 'every minute', spans: [{ start: m.index, end: m.index + m[0].length }] };
  if ((m = /\bevery\s+(\d{1,2})\s*(?:hours?|hrs?)\b/.exec(t))) {
    const n = Number(m[1]);
    if (n < 1 || n > 23) return null;
    return { cron: n === 1 ? '0 * * * *' : `0 */${n} * * *`, human: n === 1 ? 'every hour' : `every ${n} hours`, spans: [{ start: m.index, end: m.index + m[0].length }] };
  }
  if ((m = /\b(?:every\s+hour|hourly|each\s+hour)\b/.exec(t))) return { cron: '0 * * * *', human: 'every hour', spans: [{ start: m.index, end: m.index + m[0].length }] };
  return null;
}

function findRawCron(t: string): Found | null {
  const m = /^\s*(?:cron\s+)?((?:[\d*,/-]+\s+){4}[\d*,/-]+)(?=\s|$)/.exec(t);
  if (!m) return null;
  const expr = m[1]!.trim().replace(/\s+/g, ' ');
  try {
    validateCron(expr);
  } catch {
    return null;
  }
  return { cron: expr, human: describeCron(expr), spans: [{ start: m.index, end: m.index + m[0].length }] };
}

/** The rule-based parser: common phrases only, no network. Returns null when unsure. */
export function parseScheduleRules(text: string): Found | null {
  const t = text.toLowerCase();
  const raw = findRawCron(t);
  if (raw) return raw;
  const interval = findInterval(t);
  if (interval) return interval;

  const day = findDaySpec(t);
  if (day) {
    const time = timeAfter(t, day.end) ?? timeBefore(t, day.start);
    const h = time?.h ?? day.defaultHour;
    const m = time?.m ?? 0;
    const spans: Span[] = [{ start: day.start, end: day.end }, ...(time ? [{ start: time.start, end: time.end }] : [])];
    return { cron: `${m} ${h} ${day.dom} * ${day.dow}`, human: `${day.human} at ${pad(h)}:${pad(m)}`, spans };
  }
  // A bare "at 9am" means every day.
  const at = /(?:\bat\s+|@\s*)(?=\d|noon|midnight)/.exec(t);
  if (at) {
    const time = timeAfter(t, at.index);
    if (time) return { cron: `${time.m} ${time.h} * * *`, human: `every day at ${pad(time.h)}:${pad(time.m)}`, spans: [time] };
  }
  return null;
}

function stripSpans(text: string, spans: Span[]): string {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) out = `${out.slice(0, s.start)} ${out.slice(s.end)}`;
  return out
    .replace(/\s+/g, ' ')
    .replace(/^[\s,:;.\-–—]+|[\s,:;\-–—]+$/g, '')
    .replace(/^(?:to|and|then|please)\s+/i, '')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

const LLM_SYSTEM = `You convert a scheduling request into a standard 5-field cron expression
(minute hour day-of-month month day-of-week, Sunday = 0) in the user's local time zone.
Also return the task itself without the schedule words.
Reply with JSON only: {"cron": "<5 fields>", "prompt": "<task>"}. If there is no schedule, set cron to "".`;

async function viaLlm(text: string, llm: Llm): Promise<{ cron: string; prompt: string }> {
  const out = (await llm({
    system: LLM_SYSTEM,
    user: text,
    schema: { type: 'object', properties: { cron: { type: 'string' }, prompt: { type: 'string' } }, required: ['cron', 'prompt'] },
  })) as { cron?: unknown; prompt?: unknown } | null;
  const cron = typeof out?.cron === 'string' ? out.cron.trim().replace(/\s+/g, ' ') : '';
  if (!cron) throw new Error("couldn't find a schedule in that. try 'every weekday 9am, <task>'.");
  validateCron(cron);
  return { cron, prompt: typeof out?.prompt === 'string' ? out.prompt.trim() : '' };
}

/** Natural language → 5-field cron + human text. Rules first, then the LLM if one is given. */
export async function parseSchedule(text: string, llm?: Llm): Promise<ParsedSchedule> {
  const r = await parseJobRequest(text, llm);
  return { cron: r.cron, human: r.human };
}

const LEFTOVER = /\b(?:\d{1,2}(?:st|nd|rd|th)|every|each|weekly|monthly|biweekly|fortnight\w*|except|between|until|twice|quarterly|yearly|annually)\b/i;

const DRILL = /^(?:run\s+)?(?:a\s+|the\s+)?chaos\s+drill(?:\s+(?:on|with|under|using|at))?(?:\s+(?:profile\s+)?([a-z][a-z0-9-]*))?(?:\s+profile)?$/i;

/** Splits "every weekday 9am, summarize open PRs" into schedule and task. */
export async function parseJobRequest(text: string, llm?: Llm): Promise<ParsedJobRequest> {
  let rules = parseScheduleRules(text);
  // Leftover schedule words ("on the 1st and 15th", "except fridays") mean the rules only got part
  // of it; let the model read the whole thing when one is available.
  if (rules && llm && LEFTOVER.test(stripSpans(text, rules.spans))) rules = null;
  let cron: string;
  let human: string;
  let prompt: string;
  if (rules) {
    cron = rules.cron;
    human = rules.human;
    prompt = stripSpans(text, rules.spans);
  } else {
    if (!llm) throw new Error("try something like 'every weekday 9am, summarize open PRs in acme/app'.");
    const r = await viaLlm(text, llm);
    cron = r.cron;
    human = describeCron(cron);
    prompt = r.prompt || text;
  }
  const drill = DRILL.exec(prompt);
  if (drill) return { cron, human, prompt: 'chaos drill', kind: 'chaos_drill', chaosProfile: drill[1]?.toLowerCase() ?? null };
  return { cron, human, prompt, kind: 'prompt', chaosProfile: null };
}

/** The next `n` run times of a schedule in a time zone. */
export function nextRuns(schedule: string, timezone: string, n = 3, from?: Date): Date[] {
  const c = new Cron(schedule, { paused: true, timezone, mode: '5-part' });
  const runs = c.nextRuns(n, from);
  c.stop();
  return runs;
}

/** parseSchedule's fallback model: the LLM proxy, deterministic. */
export function proxyScheduleLlm(cfg: MonkConfig, fetchImpl?: typeof fetch): Llm {
  return proxyLlm(cfg, { temperature: 0, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
}
