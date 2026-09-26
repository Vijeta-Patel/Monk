import { SECRET_KEYS } from './config.ts';

// Token shapes we never want in logs, skills or the TUI, even when they did not come from our env.
const PATTERNS: RegExp[] = [
  /\bsk-or-v1-[A-Za-z0-9]{20,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g, // telegram bot token
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
];

export function redact(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const key of SECRET_KEYS) {
    const v = env[key];
    if (v && v.length >= 8) out = out.split(v).join(`[${key}]`);
  }
  for (const re of PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

export function redactDeep<T>(value: T, env?: Record<string, string | undefined>): T {
  return JSON.parse(redact(JSON.stringify(value), env)) as T;
}
