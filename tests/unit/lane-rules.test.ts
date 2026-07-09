import { describe, it, expect } from 'vitest';
import { composeLaneRules } from '../../src/agent/lane-context';

describe('composeLaneRules', () => {
  it('includes design + common rules for the design lane', () => {
    const text = composeLaneRules('design');
    expect(text.length).toBeGreaterThan(100);
    expect(text.toLowerCase()).toContain('spacing');
  });
  it('does not duplicate identical brand/copy rules for social', () => {
    const text = composeLaneRules('social');
    const banned = (text.match(/banned-words/g) || []).length;
    expect(banned).toBeLessThanOrEqual(1);
  });
});
