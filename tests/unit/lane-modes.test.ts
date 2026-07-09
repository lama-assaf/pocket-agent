import { describe, it, expect } from 'vitest';
import { AGENT_MODES, getAllModes, isValidModeId } from '../../src/agent/agent-modes';

describe('lane modes', () => {
  it('registers four lane modes', () => {
    for (const id of ['design', 'product', 'brand', 'social']) {
      expect(isValidModeId(id)).toBe(true);
      expect(AGENT_MODES[id as keyof typeof AGENT_MODES].engine).toBe('chat');
    }
  });
  it('tags each lane mode with its lane', () => {
    expect((AGENT_MODES.design as any).lane).toBe('design');
    expect((AGENT_MODES.social as any).lane).toBe('social');
  });
  it('orders coder last', () => {
    const ids = getAllModes().map((m) => m.id);
    expect(ids[ids.length - 1]).toBe('coder');
    expect(ids.indexOf('design')).toBeLessThan(ids.indexOf('coder'));
  });
});
