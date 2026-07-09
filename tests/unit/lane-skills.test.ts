import { describe, it, expect } from 'vitest';
import { formatLaneSkills } from '../../src/agent/lane-context';

describe('formatLaneSkills', () => {
  it('lists design skills by name+description only (not full body)', () => {
    const text = formatLaneSkills('design');
    expect(text).toContain('design-review');
    expect(text.length).toBeLessThan(8000); // descriptions, not bodies
  });
  it('returns empty string for a lane with no skills gracefully', () => {
    // @ts-expect-error intentionally invalid lane
    expect(formatLaneSkills('nonexistent')).toBe('');
  });
});
