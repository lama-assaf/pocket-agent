import { describe, it, expect } from 'vitest';
import { buildLaneContextInjection } from '../../src/agent/lane-context';

describe('buildLaneContextInjection', () => {
  it('pulls full accessibility skill/rule body on an a11y keyword hit', () => {
    const text = buildLaneContextInjection('can you run an a11y check on this?', 'design');
    expect(text.toLowerCase()).toContain('accessibility');
    expect(text.length).toBeGreaterThan(200); // full body, not just a name
  });
  it('returns empty when no keyword matches', () => {
    expect(buildLaneContextInjection('hello there', 'design')).toBe('');
  });
});
