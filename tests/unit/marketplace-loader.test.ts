import { describe, it, expect } from 'vitest';
import type { PackSource } from '../../src/marketplace/types';
import { readPack } from '../../src/marketplace/loader';

// Inline source so this task is self-contained (no dependency on Task 3's registry).
const atelier: PackSource = {
  id: 'atelier',
  name: 'Atelier',
  lanes: ['design', 'product', 'brand'],
  repo: 'lama-assaf/atelier',
  branch: 'main',
};

describe('readPack', () => {
  it('loads atelier agents, skills, commands, rules', () => {
    const loaded = readPack(atelier);
    expect(loaded.agents.length).toBeGreaterThanOrEqual(14);
    expect(loaded.skills.length).toBeGreaterThanOrEqual(30);
    expect(loaded.commands.length).toBeGreaterThanOrEqual(30);
    expect(loaded.rules.length).toBeGreaterThanOrEqual(20);
    const dr = loaded.agents.find((a) => a.name === 'design-reviewer');
    expect(dr?.tools).toContain('Read');
    const rule = loaded.rules[0];
    expect(rule.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('skips malformed files without throwing', () => {
    expect(() => readPack(atelier)).not.toThrow();
  });
});
