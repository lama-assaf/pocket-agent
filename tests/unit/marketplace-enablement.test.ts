import { describe, it, expect } from 'vitest';
import {
  ENABLED_AGENTS_CATEGORY,
  ENABLED_MCP_CATEGORY,
  agentEnablementSubject,
  mcpEnablementSubject,
  parseEnablementContent,
  serializeEnablementContent,
  pickNearestEnablement,
  resolveEnablement,
  type EnablementRow,
} from '../../src/marketplace/enablement';

describe('agentEnablementSubject / mcpEnablementSubject', () => {
  it('joins packId and name with a colon', () => {
    expect(agentEnablementSubject('atelier', 'design-reviewer')).toBe('atelier:design-reviewer');
    expect(mcpEnablementSubject('atelier', 'notion')).toBe('atelier:notion');
  });
});

describe('parseEnablementContent / serializeEnablementContent', () => {
  it('round-trips true/false', () => {
    expect(parseEnablementContent(serializeEnablementContent(true))).toBe(true);
    expect(parseEnablementContent(serializeEnablementContent(false))).toBe(false);
  });

  it('only the literal "false" (case/whitespace-insensitive) means disabled', () => {
    expect(parseEnablementContent('false')).toBe(false);
    expect(parseEnablementContent('FALSE')).toBe(false);
    expect(parseEnablementContent('  false  ')).toBe(false);
    expect(parseEnablementContent('true')).toBe(true);
    expect(parseEnablementContent('')).toBe(true);
    expect(parseEnablementContent('garbage')).toBe(true);
  });
});

describe('pickNearestEnablement', () => {
  const rows: EnablementRow[] = [
    { scope: 'world', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'false' },
    { scope: 'client:acme', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'true' },
  ];

  it('a nearer scope (client) wins over a broader one (world)', () => {
    const picked = pickNearestEnablement(rows, ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer');
    expect(picked).toEqual({ enabled: true, scope: 'client:acme' });
  });

  it('project overrides client, which overrides world (three-level chain)', () => {
    const chain: EnablementRow[] = [
      { scope: 'world', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'true' },
      { scope: 'client:acme', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'false' },
      { scope: 'project:acme-site', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'true' },
    ];
    expect(pickNearestEnablement(chain, ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toEqual({
      enabled: true,
      scope: 'project:acme-site',
    });
  });

  it('falls back to the only available scope when nothing nearer exists', () => {
    expect(pickNearestEnablement([rows[0]], ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toEqual({
      enabled: false,
      scope: 'world',
    });
  });

  it('returns null when no row matches this subject', () => {
    expect(pickNearestEnablement(rows, ENABLED_AGENTS_CATEGORY, 'atelier:copywriter')).toBeNull();
    expect(pickNearestEnablement([], ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toBeNull();
  });

  it('ignores rows of the wrong category even with a matching subject', () => {
    const wrongCategory: EnablementRow[] = [
      { scope: 'world', category: ENABLED_MCP_CATEGORY, subject: 'atelier:design-reviewer', content: 'false' },
    ];
    expect(pickNearestEnablement(wrongCategory, ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toBeNull();
  });

  it('keeps categories independent (enabled-agents vs enabled-mcp on the same subject string)', () => {
    const mixed: EnablementRow[] = [
      { scope: 'world', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:notion', content: 'false' },
      { scope: 'world', category: ENABLED_MCP_CATEGORY, subject: 'atelier:notion', content: 'true' },
    ];
    expect(pickNearestEnablement(mixed, ENABLED_AGENTS_CATEGORY, 'atelier:notion')?.enabled).toBe(false);
    expect(pickNearestEnablement(mixed, ENABLED_MCP_CATEGORY, 'atelier:notion')?.enabled).toBe(true);
  });
});

describe('resolveEnablement — default-on baseline', () => {
  it('defaults to enabled at scope "default" when no fact exists anywhere', () => {
    expect(resolveEnablement([], ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toEqual({
      enabled: true,
      scope: 'default',
    });
  });

  it('a single world-scope disable is picked up as the effective decision', () => {
    const rows: EnablementRow[] = [
      { scope: 'world', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'false' },
    ];
    expect(resolveEnablement(rows, ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toEqual({
      enabled: false,
      scope: 'world',
    });
  });

  it('a client-scope re-enable overrides a world-scope disable', () => {
    const rows: EnablementRow[] = [
      { scope: 'world', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'false' },
      { scope: 'client:acme', category: ENABLED_AGENTS_CATEGORY, subject: 'atelier:design-reviewer', content: 'true' },
    ];
    expect(resolveEnablement(rows, ENABLED_AGENTS_CATEGORY, 'atelier:design-reviewer')).toEqual({
      enabled: true,
      scope: 'client:acme',
    });
  });
});
