import { describe, it, expect } from 'vitest';
import { scanForBannedTone } from '../../src/agent/write-guards';

describe('scanForBannedTone', () => {
  it('flags banned filler words (delve, leverage)', () => {
    const { hits, warning } = scanForBannedTone(
      'Let us delve into this to leverage new opportunities.'
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(expect.arrayContaining(['delve', 'leverage']));
    expect(warning).toContain('tone');
  });

  it('passes clean copy', () => {
    const { hits, warning } = scanForBannedTone('We shipped the login fix today.');
    expect(hits).toEqual([]);
    expect(warning).toBeNull();
  });
});
