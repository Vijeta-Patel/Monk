import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  return `${prefix}_${time}${randomBytes(5).toString('hex')}`;
}
