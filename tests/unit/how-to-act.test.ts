/**
 * Pure-function tests for src/agent/how-to-act.ts's fact-shaping helpers.
 * how-to-act-injection.test.ts already covers these end to end (through
 * composeLaneRules + a real MemoryManager); this file targets the pure
 * functions directly with hand-built facts, per their own doc comments
 * ("Pure — safe to unit test with hand-built facts") — parsing/ordering/
 * tie-break edge cases that a single-subject integration scenario wouldn't
 * exercise.
 */

import { describe, it, expect } from 'vitest';
import {
  formatBrandVoice,
  bannedWordsFromFacts,
  hasVoiceFact,
  VOICE_SUBJECT_ORDER,
} from '../../src/agent/how-to-act';
import type { Fact } from '../../src/memory/facts';

function fact(over: Partial<Fact>): Fact {
  return {
    id: 1,
    category: 'how_to_act',
    subject: 'voice',
    content: '',
    scope: 'world',
    importance: 0,
    last_accessed_at: null,
    created_at: '',
    updated_at: '',
    ...over,
  };
}

describe('formatBrandVoice', () => {
  it('returns "" for an empty fact list', () => {
    expect(formatBrandVoice([])).toBe('');
  });

  it('excludes banned_words facts from the voice injection (they drive the tone guard, not the prompt)', () => {
    const out = formatBrandVoice([
      fact({ subject: 'voice', content: 'Warm and direct' }),
      fact({ subject: 'banned_words', content: 'synergy, disrupt' }),
    ]);
    expect(out).toContain('Warm and direct');
    expect(out).not.toContain('synergy');
  });

  it('orders voice/tone/instincts in VOICE_SUBJECT_ORDER regardless of input order', () => {
    const out = formatBrandVoice([
      fact({ subject: 'instincts', content: 'INSTINCTS CONTENT' }),
      fact({ subject: 'voice', content: 'VOICE CONTENT' }),
      fact({ subject: 'tone', content: 'TONE CONTENT' }),
    ]);
    expect(VOICE_SUBJECT_ORDER).toEqual(['voice', 'tone', 'instincts']);
    const voiceIdx = out.indexOf('VOICE CONTENT');
    const toneIdx = out.indexOf('TONE CONTENT');
    const instinctsIdx = out.indexOf('INSTINCTS CONTENT');
    expect(voiceIdx).toBeLessThan(toneIdx);
    expect(toneIdx).toBeLessThan(instinctsIdx);
  });

  it('appends an unrecognized subject after every known VOICE_SUBJECT_ORDER entry', () => {
    const out = formatBrandVoice([
      fact({ subject: 'glossary', content: 'GLOSSARY CONTENT' }),
      fact({ subject: 'tone', content: 'TONE CONTENT' }),
      fact({ subject: 'voice', content: 'VOICE CONTENT' }),
    ]);
    const glossaryIdx = out.indexOf('GLOSSARY CONTENT');
    const toneIdx = out.indexOf('TONE CONTENT');
    expect(glossaryIdx).toBeGreaterThan(toneIdx);
  });

  it('two unrecognized subjects tie-break alphabetically', () => {
    const out = formatBrandVoice([
      fact({ subject: 'zeta', content: 'ZETA CONTENT' }),
      fact({ subject: 'alpha', content: 'ALPHA CONTENT' }),
    ]);
    expect(out.indexOf('ALPHA CONTENT')).toBeLessThan(out.indexOf('ZETA CONTENT'));
  });

  it('the nearer scope wins for the same subject (client overrides world)', () => {
    const out = formatBrandVoice([
      fact({ subject: 'voice', content: 'WORLD VOICE', scope: 'world' }),
      fact({ subject: 'voice', content: 'CLIENT VOICE', scope: 'client:acme' }),
    ]);
    expect(out).toContain('CLIENT VOICE');
    expect(out).not.toContain('WORLD VOICE');
  });

  it('a project scope wins over both its client and world for the same subject (3-tier ladder)', () => {
    const out = formatBrandVoice([
      fact({ subject: 'voice', content: 'WORLD VOICE', scope: 'world' }),
      fact({ subject: 'voice', content: 'CLIENT VOICE', scope: 'client:acme' }),
      fact({ subject: 'voice', content: 'PROJECT VOICE', scope: 'project:site' }),
    ]);
    expect(out).toContain('PROJECT VOICE');
    expect(out).not.toContain('CLIENT VOICE');
    expect(out).not.toContain('WORLD VOICE');
  });

  it('a fact with an empty subject renders as a bare bullet (no "- **key**:" prefix)', () => {
    const out = formatBrandVoice([fact({ subject: '', content: 'Just a note' })]);
    expect(out).toBe('- Just a note');
  });
});

describe('hasVoiceFact', () => {
  it('is false for an empty list', () => {
    expect(hasVoiceFact([])).toBe(false);
  });

  it('is true when a voice-subject fact exists', () => {
    expect(hasVoiceFact([fact({ subject: 'voice' })])).toBe(true);
  });

  it('is false when only tone/instincts/banned_words facts exist (no voice subject)', () => {
    expect(
      hasVoiceFact([fact({ subject: 'tone' }), fact({ subject: 'banned_words' })])
    ).toBe(false);
  });
});

describe('bannedWordsFromFacts', () => {
  it('returns [] when there are no banned_words facts', () => {
    expect(bannedWordsFromFacts([fact({ subject: 'voice', content: 'x' })])).toEqual([]);
  });

  it('parses a comma-separated list', () => {
    const out = bannedWordsFromFacts([
      fact({ subject: 'banned_words', content: 'synergy, disrupt, game-changing' }),
    ]);
    expect(out.sort()).toEqual(['disrupt', 'game-changing', 'synergy']);
  });

  it('parses a newline-separated, bulleted list and strips bullets/backticks', () => {
    const out = bannedWordsFromFacts([
      fact({ subject: 'banned_words', content: '- `synergy`\n- disrupt\n*game-changing' }),
    ]);
    expect(out.sort()).toEqual(['disrupt', 'game-changing', 'synergy']);
  });

  it('lowercases every word (case-insensitive matching downstream)', () => {
    const out = bannedWordsFromFacts([fact({ subject: 'banned_words', content: 'SYNERGY, Disrupt' })]);
    expect(out.sort()).toEqual(['disrupt', 'synergy']);
  });

  it('dedups a word that appears in both comma and newline form across facts', () => {
    const out = bannedWordsFromFacts([
      fact({ subject: 'banned_words', content: 'synergy, disrupt', scope: 'world' }),
      fact({ subject: 'banned_words', content: '- synergy\n- new-word', scope: 'client:acme' }),
    ]);
    expect(out.sort()).toEqual(['disrupt', 'new-word', 'synergy']);
  });

  it('ignores blank entries from stray commas/newlines', () => {
    const out = bannedWordsFromFacts([
      fact({ subject: 'banned_words', content: 'synergy,, \n\n disrupt' }),
    ]);
    expect(out.sort()).toEqual(['disrupt', 'synergy']);
  });

  it('ignores non-banned_words facts entirely', () => {
    const out = bannedWordsFromFacts([
      fact({ subject: 'voice', content: 'should, not, be, parsed' }),
      fact({ subject: 'banned_words', content: 'real-word' }),
    ]);
    expect(out).toEqual(['real-word']);
  });
});
