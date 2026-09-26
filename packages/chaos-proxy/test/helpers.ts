import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { findRootDir, loadConfig, openDb, type MonkConfig } from '@monk/shared';
import type { UpstreamSpec } from '../src/index.ts';

export const REPO_ROOT = findRootDir(import.meta.dirname);

const obj = { type: 'object' as const, properties: {} };
export const GITHUB_TOOLS: Tool[] = [
  { name: 'list_issues', description: 'List issues', inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'get_issue', description: 'Get one issue', inputSchema: obj },
  { name: 'delete_branch', description: 'Delete a branch', inputSchema: obj },
  { name: 'always_fails', description: 'Upstream error', inputSchema: obj },
];
export const MOBILE_TOOLS: Tool[] = [
  { name: 'mobile_list_elements_on_screen', description: 'List elements', inputSchema: obj },
  { name: 'mobile_click_on_screen_at_coordinates', description: 'Click', inputSchema: obj },
  { name: 'mobile_uninstall_app', description: 'Uninstall', inputSchema: obj },
];

export const ISSUES = {
  total_count: 4,
  items: [1, 2, 3, 4].map((n) => ({ number: n, title: `Issue ${n}`, state: 'open', html_url: `https://github.com/o/r/issues/${n}` })),
  next_cursor: 'abc',
};
export const ELEMENTS = [
  { type: 'android.widget.TextView', text: 'Settings', label: '', coordinates: { x: 10, y: 20, width: 300, height: 60 } },
  { type: 'android.widget.Switch', text: 'Dark theme', label: 'dark_theme', coordinates: { x: 10, y: 200, width: 1000, height: 90 } },
];

export function fakeServer(tools: Tool[], name = 'fake'): Server {
  const server = new Server({ name, version: '1.0.0' }, { capabilities: { tools: {} } });
  let counter = 0;
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    counter++;
    const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] });
    switch (req.params.name) {
      case 'list_issues':
        return text(JSON.stringify(ISSUES));
      case 'get_issue':
        return text(JSON.stringify({ number: 1, title: 'Issue 1', fetched: counter }));
      case 'delete_branch':
        return text('deleted');
      case 'always_fails':
        return { isError: true, content: [{ type: 'text', text: 'boom' }] };
      case 'mobile_list_elements_on_screen':
        return text(`Found these elements on screen: ${JSON.stringify(ELEMENTS)}`);
      case 'mobile_click_on_screen_at_coordinates':
        return text('Clicked on screen at coordinates: 100, 200');
      case 'mobile_uninstall_app':
        return text('uninstalled');
      default:
        return { isError: true, content: [{ type: 'text', text: `no tool ${req.params.name}` }] };
    }
  });
  return server;
}

export function fakeUpstreams(): UpstreamSpec[] {
  return [
    { name: 'github', transport: 'inproc', server: () => fakeServer(GITHUB_TOOLS, 'gh') },
    { name: 'mobile', transport: 'inproc', server: () => fakeServer(MOBILE_TOOLS, 'mobile') },
  ];
}

/** A root dir with the repo's profiles plus a fast `test` profile. */
export function tempRoot(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'monk-chaos-'));
  mkdirSync(join(root, 'chaos', 'profiles'), { recursive: true });
  cpSync(join(REPO_ROOT, 'chaos', 'profiles'), join(root, 'chaos', 'profiles'), { recursive: true });
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const all = 'rate_limit: 1\n  timeout: 1\n  server_error: 1\n  malformed_json: 1\n  schema_drift: 1\n  auth_expired: 1\n  permission_denied: 1\n  stale_data: 1\n  partial_result: 1\n  latency_spike: 1\n  app_crash: 1\n  permission_dialog: 1\n  popup: 1\n  element_not_found: 1\n  slow_network: 1\n  orientation_flip: 1';
  writeFileSync(
    join(root, 'chaos', 'profiles', 'test.yaml'),
    `name: test\nseed: 7\nfault_rate: 0.5\nfaults:\n  ${all}\nmax_faults_per_session: 100\nlatency_ms: 5\ntimeout_ms: 5\n`,
  );
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(root, 'chaos', 'profiles', `${name}.yaml`), text);
  return root;
}

export function testCfg(env: Record<string, string> = {}, root = tempRoot()): MonkConfig {
  return loadConfig({ env: { CHAOS_PROFILE: 'test', MONK_DB_PATH: ':memory:', ...env }, rootDir: root });
}

export const memDb = () => openDb(':memory:');
