import { describe, it, expect } from 'vitest';
import { loadWorkflowCommands } from '../../src/config/commands-loader';

describe('pack commands', () => {
  it('includes namespaced atelier and salon commands', () => {
    const cmds = loadWorkflowCommands();
    const names = cmds.map((c) => c.name);
    expect(names).toContain('atelier:design-review');
    expect(names).toContain('salon:campaign');
  });
  it('has no colliding names across packs', () => {
    const names = loadWorkflowCommands().map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
