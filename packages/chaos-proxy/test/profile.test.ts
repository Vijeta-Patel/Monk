import { DESTRUCTIVE_TOOL_GLOBS } from '@monk/shared';
import { describe, expect, it } from 'vitest';
import { loadProfile, parseProfile } from '../src/profile.ts';
import { listProfiles } from '../src/profile.ts';
import { REPO_ROOT } from './helpers.ts';

describe('profiles', () => {
  it('ships the six profiles and they all validate', async () => {
    const names = await listProfiles(REPO_ROOT);
    for (const n of ['off', 'light', 'moderate', 'pressure', 'heavy', 'mobile']) expect(names).toContain(n);
    for (const n of names) {
      const p = await loadProfile(n, REPO_ROOT);
      expect(p.name).toBe(n);
      for (const g of DESTRUCTIVE_TOOL_GLOBS) expect(p.protect).toContain(g);
    }
    expect((await loadProfile('heavy', REPO_ROOT)).fault_rate).toBe(0.5);
    expect((await loadProfile('pressure', REPO_ROOT)).pressure).toBe(true);
    expect((await loadProfile('off', REPO_ROOT)).fault_rate).toBe(0);
    const moderate = await loadProfile('moderate', REPO_ROOT);
    expect(moderate).toMatchObject({ seed: 42, fault_rate: 0.3, max_faults_per_session: 8, faults: { rate_limit: 3, timeout: 2 } });
    expect(Object.keys((await loadProfile('mobile', REPO_ROOT)).faults)).toContain('popup');
  });

  it('loads by path', async () => {
    expect((await loadProfile('chaos/profiles/light.yaml', REPO_ROOT)).name).toBe('light');
  });

  it('rejects bad profiles', async () => {
    expect(() => parseProfile('name: x\nfault_rate: 2\nfaults: {}')).toThrow(/invalid/);
    expect(() => parseProfile('name: x\nfault_rate: 0.1\nfaults: {nope: 1}')).toThrow(/invalid/);
    expect(() => parseProfile('name: x\nfault_rate: 0.1\nfaults: {}\nextra: 1')).toThrow(/invalid/);
    await expect(loadProfile('missing', REPO_ROOT)).rejects.toThrow(/not found/);
  });
});
