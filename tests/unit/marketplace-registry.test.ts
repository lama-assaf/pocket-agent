import { describe, it, expect } from 'vitest';
import { PACK_SOURCES, skillsForLane, agentsForLane, rulesForLane, commandsForPacks } from '../../src/marketplace/registry';

describe('registry lane maps', () => {
  it('has two pack sources', () => {
    expect(PACK_SOURCES.map((p) => p.id).sort()).toEqual(['atelier', 'salon']);
  });
  it('splits atelier skills across lanes and puts salon in social', () => {
    expect(skillsForLane('design').some((s) => s.name === 'design-review')).toBe(true);
    expect(skillsForLane('product').some((s) => s.name === 'prd-writing')).toBe(true);
    expect(skillsForLane('social').length).toBeGreaterThanOrEqual(15);
  });
  it('assigns agents to lanes', () => {
    expect(agentsForLane('design').some((a) => a.name === 'design-reviewer')).toBe(true);
    expect(agentsForLane('social').length).toBeGreaterThanOrEqual(3);
  });
  it('social lane includes brand+copy rules', () => {
    const lanes = new Set(rulesForLane('social').map((r) => r.lane));
    expect(lanes.has('social')).toBe(true);
  });
  it('namespaces commands and de-dupes nothing across packs', () => {
    const cmds = commandsForPacks();
    expect(cmds.some((c) => c.ns === 'atelier:design-review')).toBe(true);
    expect(cmds.some((c) => c.ns === 'salon:campaign')).toBe(true);
  });
});
