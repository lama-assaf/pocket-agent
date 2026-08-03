import { describe, it, expect } from 'vitest';
import { PACK_SOURCES, skillsForLane, agentsForLane, rulesForLane, commandsForPacks, allAgentsGrouped } from '../../src/marketplace/registry';

describe('registry lane maps', () => {
  it('has three pack sources', () => {
    expect(PACK_SOURCES.map((p) => p.id).sort()).toEqual([
      'atelier',
      'salon',
      'zilliqa-brand-identity',
    ]);
  });
  it('splits atelier skills across lanes and puts salon in social', () => {
    expect(skillsForLane('design').some((s) => s.name === 'design-review')).toBe(true);
    expect(skillsForLane('product').some((s) => s.name === 'prd-writing')).toBe(true);
    expect(skillsForLane('social').length).toBeGreaterThanOrEqual(15);
  });
  it("associates the private zilliqa pack with the zilliqa client's token", () => {
    const z = PACK_SOURCES.find((p) => p.id === 'zilliqa-brand-identity');
    expect(z?.tokenClientId).toBe('zilliqa');
  });
  it('puts the zilliqa brand pack skills in the design lane', () => {
    const design = skillsForLane('design');
    expect(design.some((s) => s.name === 'zilliqa-brand')).toBe(true);
    expect(design.some((s) => s.name === 'zilliqa-app-ui')).toBe(true);
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
  it('allAgentsGrouped tags every agent with its pack, pack name, and lane', () => {
    const grouped = allAgentsGrouped();
    expect(grouped.length).toBeGreaterThanOrEqual(17); // 14 atelier + 3 salon
    const dr = grouped.find((g) => g.agent.name === 'design-reviewer');
    expect(dr?.packId).toBe('atelier');
    expect(dr?.packName).toBe('Atelier');
    expect(dr?.lane).toBe('design');
    const cm = grouped.find((g) => g.agent.name === 'community-manager');
    expect(cm?.packId).toBe('salon');
    expect(cm?.lane).toBe('social');
  });
});
