/**
 * Per-client GitHub token overrides (src/clients/tokens.ts): parse/serialize
 * round-trip, per-scope resolution (client override → global github.token
 * fallback, world always global), set/clear mutation, and the masked status
 * the UI consumes. SettingsManager is mocked with an in-memory map — these
 * are pure resolution semantics, no Electron/safeStorage involved.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const settingsMap = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsMap.get(key) ?? '',
    set: (key: string, value: string) => {
      settingsMap.set(key, value);
    },
  },
}));

import {
  parseClientTokens,
  serializeClientTokens,
  tokenForScope,
  setClientToken,
  clientTokenStatus,
  CLIENT_TOKENS_KEY,
} from '../../src/clients/tokens';

beforeEach(() => {
  settingsMap.clear();
});

describe('parseClientTokens', () => {
  it('treats empty/missing/corrupt values as no overrides', () => {
    expect(parseClientTokens('')).toEqual({});
    expect(parseClientTokens(null)).toEqual({});
    expect(parseClientTokens('not json')).toEqual({});
    expect(parseClientTokens('[1,2]')).toEqual({});
    expect(parseClientTokens('"just a string"')).toEqual({});
  });

  it('keeps only non-empty string tokens and trims them', () => {
    const raw = JSON.stringify({ a: ' tok-a ', b: '', c: 42, d: 'tok-d' });
    expect(parseClientTokens(raw)).toEqual({ a: 'tok-a', d: 'tok-d' });
  });

  it('round-trips through serializeClientTokens', () => {
    const map = { zilliqa: 'ghp_zil', ltin: 'ghp_ltin' };
    expect(parseClientTokens(serializeClientTokens(map))).toEqual(map);
  });

  it('serializes an empty map to the empty string (setting cleared, not "{}")', () => {
    expect(serializeClientTokens({})).toBe('');
    expect(serializeClientTokens({ a: '  ' })).toBe('');
  });
});

describe('tokenForScope', () => {
  it('falls back to the global github.token when a client has no override', () => {
    settingsMap.set('github.token', 'global-tok');
    expect(tokenForScope('zilliqa')).toBe('global-tok');
  });

  it("prefers the client's own override over the global token", () => {
    settingsMap.set('github.token', 'global-tok');
    settingsMap.set(CLIENT_TOKENS_KEY, JSON.stringify({ zilliqa: 'zil-tok' }));
    expect(tokenForScope('zilliqa')).toBe('zil-tok');
    expect(tokenForScope('other-client')).toBe('global-tok');
  });

  it('world always uses the global token, never a client override', () => {
    settingsMap.set('github.token', 'global-tok');
    // Even a pathological 'world' key in the map must not apply.
    settingsMap.set(CLIENT_TOKENS_KEY, JSON.stringify({ world: 'sneaky' }));
    expect(tokenForScope('world')).toBe('global-tok');
  });

  it('returns "" when neither an override nor a global token exists', () => {
    expect(tokenForScope('zilliqa')).toBe('');
  });
});

describe('setClientToken', () => {
  it('sets, replaces, and clears a client token without touching others', () => {
    setClientToken('zilliqa', 'tok-1');
    setClientToken('ltin', 'tok-l');
    expect(tokenForScope('zilliqa')).toBe('tok-1');

    setClientToken('zilliqa', '  tok-2  ');
    expect(tokenForScope('zilliqa')).toBe('tok-2');

    setClientToken('zilliqa', null);
    expect(tokenForScope('zilliqa')).toBe('');
    expect(tokenForScope('ltin')).toBe('tok-l');
  });

  it('clearing the last override empties the stored setting entirely', () => {
    setClientToken('zilliqa', 'tok');
    setClientToken('zilliqa', '');
    expect(settingsMap.get(CLIENT_TOKENS_KEY)).toBe('');
  });

  it('survives a corrupted stored map (treats it as empty and overwrites)', () => {
    settingsMap.set(CLIENT_TOKENS_KEY, '{broken');
    setClientToken('zilliqa', 'tok');
    expect(tokenForScope('zilliqa')).toBe('tok');
  });
});

describe('clientTokenStatus', () => {
  it('reports a masked override and the default-token availability', () => {
    settingsMap.set('github.token', 'global-tok');
    setClientToken('zilliqa', 'ghp_abcdef1234');
    expect(clientTokenStatus('zilliqa')).toEqual({
      hasOwnToken: true,
      last4: '1234',
      hasDefaultToken: true,
    });
    expect(clientTokenStatus('other')).toEqual({
      hasOwnToken: false,
      last4: null,
      hasDefaultToken: true,
    });
  });

  it('reports no tokens at all', () => {
    expect(clientTokenStatus('zilliqa')).toEqual({
      hasOwnToken: false,
      last4: null,
      hasDefaultToken: false,
    });
  });
});
