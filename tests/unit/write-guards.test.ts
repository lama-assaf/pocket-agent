import { describe, it, expect } from 'vitest';
import { scanForBannedTone, checkRhythm, checkEmDashFiller } from '../../src/agent/write-guards';

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

  it('categorizes vendored pattern hits by category (ai-tone / corporate-filler / hollow-opener)', () => {
    // Use forms present only in the vendored JS arrays (not the legacy
    // banned-words.md bullet parser, which stops at '/' or quote marks) so
    // each hit is attributable to a single, distinct category.
    const { categorizedHits } = scanForBannedTone(
      "We're thrilled to announce our synergistic approach after months of delving into the data."
    );
    const categories = categorizedHits.map((h) => h.category);
    expect(categories).toContain('hollow-opener');
    expect(categories).toContain('corporate-filler');
    expect(categories).toContain('ai-tone');
  });
});

// ── TECHNICAL_CONTEXT_ALLOWLIST: 40-char window kills known false positives ──
describe('scanForBannedTone — technical context allowlist', () => {
  it('downgrades "test harness" (flags bare "harness")', () => {
    const clean = scanForBannedTone('Our test harness passed all checks this morning.');
    expect(clean.hits).not.toContain('harness');
    expect(clean.warning).toBeNull();

    const dirty = scanForBannedTone('We need to harness this power for good.');
    expect(dirty.hits).toContain('harness');
    expect(dirty.warning).toBeTruthy();
  });

  it('downgrades "financial leverage" (flags bare "leverage")', () => {
    const clean = scanForBannedTone('Our financial leverage ratio improved this quarter.');
    expect(clean.hits).not.toContain('leverage');
    expect(clean.warning).toBeNull();

    const dirty = scanForBannedTone('We should leverage this opportunity.');
    expect(dirty.hits).toContain('leverage');
  });

  it('downgrades "load-tested" robust (flags bare "robust")', () => {
    const clean = scanForBannedTone(
      'The service has been load-tested and is robust under peak traffic.'
    );
    expect(clean.hits).not.toContain('robust');

    const dirty = scanForBannedTone('This is a very robust solution.');
    expect(dirty.hits).toContain('robust');
  });
});

// ── checkRhythm: uniform sentence-length AI-tell ──────────────────────────────
describe('checkRhythm', () => {
  it('flags suspiciously uniform sentence lengths (4+ sentences, low stddev)', () => {
    const uniform =
      'The cat sat on the warm mat today. The dog ran in the cool yard fast. ' +
      'The bird flew over the tall green tree. The fish swam in the deep blue pond.';
    const result = checkRhythm(uniform);
    expect(result.sentenceCount).toBeGreaterThanOrEqual(4);
    expect(result.flag).toBe(true);
    expect(result.stddev).toBeLessThan(3);
  });

  it('does not flag naturally varied sentence lengths', () => {
    const varied =
      'Go home now. ' +
      'I want to eat pizza and watch a nice long movie tonight with my whole family gathered around the table. ' +
      'Bug fixed. ' +
      'Comprehensive quarterly reports were finally consolidated after months of painstaking, detailed review work across every team.';
    const result = checkRhythm(varied);
    expect(result.sentenceCount).toBeGreaterThanOrEqual(4);
    expect(result.flag).toBe(false);
  });

  it('does not flag short text (fewer than 4 sentences)', () => {
    const result = checkRhythm('One sentence here. Two sentences here.');
    expect(result.flag).toBe(false);
  });

  it('strips code blocks before counting sentences', () => {
    const withCode =
      'Here is the fix. ```js\nfunction a() { return 1; }\nfunction b() { return 2; }\n``` It works now.';
    const result = checkRhythm(withCode);
    expect(result.sentenceCount).toBe(2);
  });
});

// ── checkEmDashFiller: "— X —" pattern ────────────────────────────────────────
describe('checkEmDashFiller', () => {
  it('fires on an em-dash interjection', () => {
    const hits = checkEmDashFiller(
      'This approach works well — and it always has — for every use case.'
    );
    expect(hits).toBe(1);
  });

  it('counts multiple occurrences', () => {
    const hits = checkEmDashFiller(
      'First point — clearly stated — stands. Second point — also clear — stands too.'
    );
    expect(hits).toBe(2);
  });

  it('does not fire on a single em dash', () => {
    const hits = checkEmDashFiller('This is fine — no filler here.');
    expect(hits).toBe(0);
  });

  it('does not fire on plain text with no em dashes', () => {
    expect(checkEmDashFiller('We shipped the login fix today.')).toBe(0);
  });
});

describe('scanForBannedTone — rhythm and em-dash surface as warnings', () => {
  it('warns when rhythm is flat, even with no banned words', () => {
    const uniform =
      'The cat sat on the warm mat today. The dog ran in the cool yard fast. ' +
      'The bird flew over the tall green tree. The fish swam in the deep blue pond.';
    const { hits, warning } = scanForBannedTone(uniform);
    expect(hits).toEqual([]);
    expect(warning).toBeTruthy();
    expect(warning).toContain('rhythm');
  });

  it('warns on em-dash filler, even with no banned words', () => {
    const { warning } = scanForBannedTone(
      'This approach works well — and it always has — for every use case.'
    );
    expect(warning).toBeTruthy();
    expect(warning).toContain('em-dash');
  });
});
