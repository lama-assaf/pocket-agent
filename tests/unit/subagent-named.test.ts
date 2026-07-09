import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(),
    getArray: vi.fn(),
    set: vi.fn(),
  },
}));

import { resolveSpecialist, mapAgentTools } from '../../src/tools/subagent';

describe('named specialist resolution', () => {
  it('resolves a design specialist prompt for the design lane', () => {
    const spec = resolveSpecialist('design', 'design-reviewer');
    expect(spec?.prompt.toLowerCase()).toContain('critique');
  });
  it('returns null for an agent not in the lane', () => {
    expect(resolveSpecialist('design', 'community-manager')).toBeNull();
  });
  it('maps Claude Code tool names to pocket tool names, dropping unknowns', () => {
    const mapped = mapAgentTools(['Read', 'Grep', 'Bogus']);
    expect(mapped).toContain('read');
    expect(mapped).not.toContain('Bogus');
  });
});
