import { createApiClient, type ApiClient } from '@monk/shared/api';
import { createDemoClient } from './demo.ts';

export type Source = { client: ApiClient; demo: boolean; reason: 'param' | 'unreachable' | null };

export const API_PORT = 8788;

export function wantsDemo(): boolean {
  const q = new URLSearchParams(location.search);
  return q.has('demo') && q.get('demo') !== '0';
}

/** Same origin: `monk up` serves the build, and `vite dev` proxies /api to :8788. */
export function liveClient(): ApiClient {
  return createApiClient('');
}

export function demoSource(reason: Source['reason']): Source {
  return { client: createDemoClient(), demo: true, reason };
}

/**
 * `?demo=1` always uses fake data. In `vite dev` we probe the API once and fall back to demo
 * data if nothing answers, so the page is never blank while building it.
 */
export async function pickSource(): Promise<Source> {
  if (wantsDemo()) return demoSource('param');
  const client = liveClient();
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('demo') !== '0') {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch('/api/state', { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return demoSource('unreachable');
    } catch {
      return demoSource('unreachable');
    }
  }
  return { client, demo: false, reason: null };
}
