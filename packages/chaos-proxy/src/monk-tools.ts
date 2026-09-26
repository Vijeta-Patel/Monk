import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { redact, type MonkConfig } from '@monk/shared';
import type { Device } from './device.ts';

/**
 * Downloads a file from a Daytona sandbox via its toolbox REST API.
 * TODO(verify): path taken from the Daytona API as of 2025 (`GET /toolbox/{sandboxId}/toolbox/files/download?path=`
 * on the main API, bearer auth). Newer Daytona versions route toolbox calls through a per-region proxy
 * (`{toolboxProxyUrl}/{sandboxId}/files/download`); set DAYTONA_TOOLBOX_URL to override. Not verified offline.
 */
export async function downloadFromDaytona(opts: { apiKey: string; sandboxId: string; path: string; fetchImpl?: typeof fetch }): Promise<Buffer> {
  if (!opts.apiKey) throw new Error('DAYTONA_API_KEY is not set');
  const base = (process.env.DAYTONA_TOOLBOX_URL || `${process.env.DAYTONA_API_URL || 'https://app.daytona.io/api'}/toolbox`).replace(/\/$/, '');
  const url = process.env.DAYTONA_TOOLBOX_URL
    ? `${base}/${encodeURIComponent(opts.sandboxId)}/files/download?path=${encodeURIComponent(opts.path)}`
    : `${base}/${encodeURIComponent(opts.sandboxId)}/toolbox/files/download?path=${encodeURIComponent(opts.path)}`;
  const res = await (opts.fetchImpl ?? fetch)(url, { headers: { authorization: `Bearer ${opts.apiKey}` } });
  if (!res.ok) throw new Error(`Daytona download failed: ${res.status} ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

const TOOLS: Tool[] = [
  {
    name: 'install_apk',
    description:
      'Install an Android APK on the emulator (adb install -r). Pass either {url} to download it, or {sandbox_id, path} to copy a build artifact out of a Daytona sandbox.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL of the APK' },
        sandbox_id: { type: 'string', description: 'Daytona sandbox id holding the build output' },
        path: { type: 'string', description: 'APK path inside the sandbox (e.g. app/build/outputs/apk/debug/app-debug.apk)' },
      },
    },
  },
  {
    name: 'phone_screenshot',
    description: 'Take a PNG screenshot of the Android emulator screen.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'wait_seconds',
    description: 'Pause before the next step, e.g. for the retry_after a rate limit asked for. At most 60 seconds.',
    inputSchema: { type: 'object', properties: { seconds: { type: 'number', description: 'How long to wait (1-60)' }, reason: { type: 'string' } }, required: ['seconds'] },
    annotations: { readOnlyHint: true },
  },
];

/** GitHub actions GitHub's MCP server lacks; irreversible, so TrueForge asks the user first (by name). */
const GITHUB_TOOLS: Tool[] = [
  {
    name: 'delete_branch',
    description: 'Delete a branch in a GitHub repository. Irreversible: asks the user first. Never deletes the default branch.',
    inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, branch: { type: 'string' } }, required: ['owner', 'repo', 'branch'] },
    annotations: { destructiveHint: true },
  },
  {
    name: 'close_issue',
    description: 'Close a GitHub issue, optionally as a duplicate or not planned, with a comment. Irreversible: asks the user first. Use this rather than issue_write to close.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        issue_number: { type: 'number' },
        reason: { type: 'string', enum: ['completed', 'not_planned', 'duplicate'] },
        comment: { type: 'string', description: 'Posted on the issue before closing' },
      },
      required: ['owner', 'repo', 'issue_number'],
    },
    annotations: { destructiveHint: true },
  },
];

const err = (text: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text }] });

export type MonkToolsDeps = {
  cfg: MonkConfig;
  device: () => Promise<Device | null>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

async function github(deps: MonkToolsDeps, method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await (deps.fetchImpl ?? fetch)(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${deps.cfg.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  return { status: res.status, json };
}

const repoPath = (a: Record<string, unknown>) => `/repos/${encodeURIComponent(String(a.owner))}/${encodeURIComponent(String(a.repo))}`;

async function githubAction(deps: MonkToolsDeps, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!args.owner || !args.repo) return err(`${name} needs owner and repo`);
  if (name === 'delete_branch') {
    const branch = String(args.branch ?? '');
    if (!branch) return err('delete_branch needs branch');
    const repo = await github(deps, 'GET', repoPath(args));
    const def = (repo.json as { default_branch?: string } | null)?.default_branch;
    if (def && branch === def) return err(`refusing to delete the default branch ${def}`);
    const r = await github(deps, 'DELETE', `${repoPath(args)}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`);
    if (r.status === 204) return { content: [{ type: 'text', text: `deleted branch ${branch}` }] };
    return err(`delete_branch ${branch}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  }
  const n = Number(args.issue_number);
  if (!Number.isInteger(n)) return err('close_issue needs issue_number');
  if (typeof args.comment === 'string' && args.comment.trim()) {
    const c = await github(deps, 'POST', `${repoPath(args)}/issues/${n}/comments`, { body: args.comment });
    if (c.status >= 300) return err(`close_issue #${n}: comment failed ${c.status}`);
  }
  const reason = args.reason === 'not_planned' || args.reason === 'duplicate' ? args.reason : 'completed';
  const r = await github(deps, 'PATCH', `${repoPath(args)}/issues/${n}`, { state: 'closed', state_reason: reason });
  if (r.status < 300) return { content: [{ type: 'text', text: `closed #${n} (${reason})` }] };
  return err(`close_issue #${n}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
}

/** In-process MCP server for Monk's own tools (APK hand-off, screenshots). */
export function monkToolsServer(deps: MonkToolsDeps): Server {
  const server = new Server({ name: 'monk', version: '0.1.0' }, { capabilities: { tools: {} } });
  const tools = [...TOOLS.filter((t) => t.name !== 'phone_screenshot' || deps.cfg.MONK_PHONE), ...(deps.cfg.GITHUB_TOKEN ? GITHUB_TOOLS : [])];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (req.params.name === 'phone_screenshot') {
        const dev = await deps.device();
        if (!dev) return err('No phone attached (start Monk with --phone and an emulator running).');
        const png = await dev.screenshot();
        return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
      }
      if (req.params.name === 'install_apk') return await installApk(deps, args);
      if (req.params.name === 'wait_seconds') {
        const secs = Math.max(1, Math.min(60, Number(args.seconds) || 1));
        await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(secs * 1000);
        return { content: [{ type: 'text', text: `waited ${secs}s` }] };
      }
      if (req.params.name === 'delete_branch' || req.params.name === 'close_issue') return await githubAction(deps, req.params.name, args);
      return err(`unknown tool ${req.params.name}`);
    } catch (e) {
      return err(redact(e instanceof Error ? e.message : String(e)));
    }
  });
  return server;
}

async function installApk(deps: MonkToolsDeps, args: Record<string, unknown>): Promise<CallToolResult> {
  const url = typeof args.url === 'string' ? args.url : undefined;
  const sandboxId = typeof args.sandbox_id === 'string' ? args.sandbox_id : undefined;
  const path = typeof args.path === 'string' ? args.path : undefined;
  if (!url && !(sandboxId && path)) return err('install_apk needs {url} or {sandbox_id, path}');
  const dev = await deps.device();
  if (!dev) return err('No phone attached: adb has no device. Start the emulator and Monk with --phone.');

  let bytes: Buffer;
  if (url) {
    const res = await (deps.fetchImpl ?? fetch)(url);
    if (!res.ok) return err(`download failed: ${res.status} ${res.statusText}`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else {
    bytes = await downloadFromDaytona({ apiKey: deps.cfg.DAYTONA_API_KEY, sandboxId: sandboxId!, path: path!, fetchImpl: deps.fetchImpl });
  }
  if (bytes.length < 4 || bytes.subarray(0, 2).toString('latin1') !== 'PK') return err('downloaded file is not an APK (zip header missing)');

  const dir = await mkdtemp(join(tmpdir(), 'monk-apk-'));
  const file = join(dir, 'app.apk');
  try {
    await writeFile(file, bytes);
    const out = await dev.install(file);
    const ok = /Success/.test(out);
    return { isError: !ok, content: [{ type: 'text', text: `adb install -r: ${out.trim() || '(no output)'} (${bytes.length} bytes)` }] };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
