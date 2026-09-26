import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@monk/shared';
import { defaultUpstreams, extraUpstreams } from '../src/index.ts';

describe('upstream config', () => {
  it('wraps user-added MCP servers from mcp-servers.json and fills ${VAR}', () => {
    const dir = mkdtempSync(join(tmpdir(), 'monk-up-'));
    writeFileSync(
      join(dir, 'mcp-servers.json'),
      JSON.stringify({
        servers: [
          { name: 'linear', transport: 'http', url: 'https://mcp.linear.app/sse', headers: { Authorization: 'Bearer ${LINEAR_KEY}' } },
          { name: 'fs', transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
        ],
      }),
    );
    const cfg = loadConfig({ env: {}, rootDir: dir });
    const ups = extraUpstreams(cfg, { LINEAR_KEY: 'k1' });
    expect(ups.map((u) => u.name)).toEqual(['linear', 'fs']);
    expect(ups[0]).toMatchObject({ transport: 'http', headers: { Authorization: 'Bearer k1' } });
  });

  it('picks the GitHub MCP transport from GITHUB_MCP', () => {
    const remote = defaultUpstreams(loadConfig({ env: { GITHUB_TOKEN: 't', GITHUB_MCP: 'remote' }, rootDir: '/nonexistent' }), async () => null);
    expect(remote[0]).toMatchObject({ name: 'github', transport: 'http', url: 'https://api.githubcopilot.com/mcp/' });
    const docker = defaultUpstreams(loadConfig({ env: { GITHUB_TOKEN: 't' }, rootDir: '/nonexistent' }), async () => null);
    expect(docker[0]).toMatchObject({ name: 'github', transport: 'stdio', command: 'docker' });
  });
});
