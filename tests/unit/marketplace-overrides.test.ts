import { describe, it, expect } from 'vitest';
import {
  AGENT_OVERRIDE_CATEGORY,
  overrideSubject,
  isEmptyOverride,
  parseOverrideContent,
  serializeOverrideContent,
  pickNearestOverride,
  applyAgentOverride,
  type OverrideRow,
} from '../../src/marketplace/overrides';
import type { PackAgent } from '../../src/marketplace/types';

const baseAgent: PackAgent = {
  name: 'design-reviewer',
  description: 'Critiques designs',
  tools: ['Read', 'Grep'],
  model: 'opus',
  prompt: 'BASE PROMPT',
  source: '/seed/atelier/agents/design-reviewer.md',
};

describe('overrideSubject', () => {
  it('joins packId and agent name with a colon', () => {
    expect(overrideSubject('atelier', 'design-reviewer')).toBe('atelier:design-reviewer');
  });
});

describe('parseOverrideContent / serializeOverrideContent', () => {
  it('round-trips prompt/tools/model', () => {
    const fields = { prompt: 'CUSTOM', tools: ['Read', 'Write'], model: 'claude-opus-4-8' };
    const content = serializeOverrideContent(fields);
    expect(parseOverrideContent(content)).toEqual(fields);
  });

  it('serialize drops unset fields (partial override — prompt only)', () => {
    const content = serializeOverrideContent({ prompt: 'CUSTOM' });
    const parsed = JSON.parse(content);
    expect(parsed).toEqual({ prompt: 'CUSTOM' });
    expect(parsed).not.toHaveProperty('tools');
    expect(parsed).not.toHaveProperty('model');
  });

  it('parse degrades to {} on malformed JSON', () => {
    expect(parseOverrideContent('not json')).toEqual({});
  });

  it('parse degrades to {} on a JSON array/primitive (not an object)', () => {
    expect(parseOverrideContent('[1,2,3]')).toEqual({});
    expect(parseOverrideContent('"hello"')).toEqual({});
  });

  it('parse ignores wrong-typed fields rather than throwing', () => {
    expect(parseOverrideContent(JSON.stringify({ prompt: 123, tools: 'not-array', model: 5 }))).toEqual(
      {}
    );
  });

  it('parse drops a tools array with non-string entries', () => {
    expect(parseOverrideContent(JSON.stringify({ tools: ['Read', 42] }))).toEqual({});
  });
});

describe('isEmptyOverride', () => {
  it('true when no fields set', () => {
    expect(isEmptyOverride({})).toBe(true);
  });
  it('false when any field set', () => {
    expect(isEmptyOverride({ prompt: 'x' })).toBe(false);
    expect(isEmptyOverride({ tools: [] })).toBe(false);
    expect(isEmptyOverride({ model: 'x' })).toBe(false);
  });
});

describe('pickNearestOverride', () => {
  const rows: OverrideRow[] = [
    {
      scope: 'world',
      category: AGENT_OVERRIDE_CATEGORY,
      subject: 'atelier:design-reviewer',
      content: JSON.stringify({ prompt: 'WORLD OVERRIDE' }),
    },
    {
      scope: 'client:acme',
      category: AGENT_OVERRIDE_CATEGORY,
      subject: 'atelier:design-reviewer',
      content: JSON.stringify({ prompt: 'CLIENT OVERRIDE' }),
    },
  ];

  it('a nearer scope (client) wins over a broader one (world) for the same agent', () => {
    const picked = pickNearestOverride(rows, 'atelier', 'design-reviewer');
    expect(picked?.scope).toBe('client:acme');
    expect(picked?.fields.prompt).toBe('CLIENT OVERRIDE');
  });

  it('falls back to the only available scope when nothing nearer exists', () => {
    const picked = pickNearestOverride([rows[0]], 'atelier', 'design-reviewer');
    expect(picked?.scope).toBe('world');
  });

  it('returns null when no row matches this agent (category+subject)', () => {
    expect(pickNearestOverride(rows, 'salon', 'community-manager')).toBeNull();
    expect(pickNearestOverride([], 'atelier', 'design-reviewer')).toBeNull();
  });

  it('ignores rows with the wrong category even if the subject matches', () => {
    const wrongCategory: OverrideRow[] = [
      { scope: 'world', category: 'lesson', subject: 'atelier:design-reviewer', content: '{}' },
    ];
    expect(pickNearestOverride(wrongCategory, 'atelier', 'design-reviewer')).toBeNull();
  });
});

describe('applyAgentOverride', () => {
  it('returns the base unchanged when override is null/undefined', () => {
    expect(applyAgentOverride(baseAgent, null)).toEqual(baseAgent);
    expect(applyAgentOverride(baseAgent, undefined)).toEqual(baseAgent);
  });

  it('merges only the fields the override sets, falling through to base for the rest', () => {
    const merged = applyAgentOverride(baseAgent, { prompt: 'OVERRIDDEN PROMPT' });
    expect(merged.prompt).toBe('OVERRIDDEN PROMPT');
    expect(merged.tools).toEqual(baseAgent.tools); // untouched
    expect(merged.model).toBe(baseAgent.model); // untouched
    expect(merged.name).toBe(baseAgent.name); // name is never overridden
  });

  it('fully overrides prompt+tools+model when all three are set', () => {
    const merged = applyAgentOverride(baseAgent, {
      prompt: 'NEW',
      tools: ['Write'],
      model: 'claude-sonnet-4-6',
    });
    expect(merged).toEqual({
      ...baseAgent,
      prompt: 'NEW',
      tools: ['Write'],
      model: 'claude-sonnet-4-6',
    });
  });
});
