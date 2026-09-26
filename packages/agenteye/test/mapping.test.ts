import { describe, expect, it } from 'vitest';
import { environmentFor, mapSession } from '../src/index.ts';

import { EVAL, FAULTS, SESSION } from './fixtures.ts';

describe('mapSession', () => {
  it('maps a TrueForge session to AgentEye events in order, with chaos hooks and an agent_end', () => {
    const out = mapSession(SESSION as never, FAULTS, { tfSessionId: 's1', agentId: 'monk', environment: 'gen-2', model: 'm', costUsd: 0.0123, eval: EVAL, destructive: (n) => n.includes('delete') });
    const types = out.map((e) => e.type);
    expect(types[0]).toBe('agent_start');
    expect(types.at(-1)).toBe('agent_end');
    expect(types).toContain('hook_triggered');
    expect(types).toContain('hook_completed');
    expect(types.filter((x) => x === 'tool_use')).toHaveLength(3);
    expect(out.find((e) => e.type === 'tool_result' && e.tool_call_id === 'c1')).toMatchObject({ error: expect.stringContaining('429') });
    expect(out.find((e) => e.type === 'tool_use' && e.tool_call_id === 'c3')).toMatchObject({ fw_destructive: true });
    expect(out.find((e) => e.type === 'human_wait')).toMatchObject({ input_id: 'c3' });
    expect(out.find((e) => e.type === 'human_input')).toMatchObject({ input_id: 'c3', fw_approved: true });
    expect(out.at(-1)).toMatchObject({ outcome: 'completed', fw_passed: true, fw_generation: 2, fw_faults_injected: 1, fw_faults_recovered: 1 });
    for (const e of out) {
      expect(e).toMatchObject({ session_id: 's1', agent_id: 'monk', environment: 'gen-2' });
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }
  });

  it('files sessions under an environment per generation and variant', () => {
    expect(environmentFor(null, 'monk-live')).toBe('monk-live');
    expect(environmentFor(EVAL, 'x')).toBe('gen-2');
    expect(environmentFor({ ...EVAL, variant: 'no_verify' }, 'x')).toBe('gen-2-no_verify');
    expect(environmentFor({ ...EVAL, profile: 'off' }, 'x')).toBe('gen-2-chaos-off');
    expect(environmentFor(null, 'a,b')).toBe('a_b');
  });

  it('holds agent_end back while the session is paused for approval', () => {
    const paused = SESSION.slice(0, 8);
    const out = mapSession(paused as never, [], { tfSessionId: 's1', agentId: 'monk', environment: 'e', model: 'm', costUsd: 0, eval: null, destructive: () => false });
    expect(out.some((e) => e.type === 'agent_end')).toBe(false);
  });
});
