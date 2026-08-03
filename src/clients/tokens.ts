// src/clients/tokens.ts
// Per-client GitHub token overrides. One brand's brain repo may live under a
// different GitHub org than the operator's own account (e.g. a client-org
// fine-grained PAT scoped to just that brand's repos), so each client can
// carry its own token; everything else falls back to the global
// `github.token` setting (Settings → GitHub).
//
// Storage: a single encrypted `github.clientTokens` setting holding a JSON
// map { [clientId]: token }. The settings schema is a fixed key list, so a
// map-in-one-key is the shape that fits (and it inherits the same safeStorage
// encryption as `github.token`). Tokens never live on the client row in
// SQLite and never travel with setup links or the brain repo itself.
//
// Electron-free like the rest of src/clients/ — SettingsManager is the only
// dependency, same as live-sync.ts.

import { SettingsManager } from '../settings';

export const CLIENT_TOKENS_KEY = 'github.clientTokens';

/**
 * Parse the stored JSON map, tolerating every malformed shape ('' on first
 * run, corrupted JSON, non-object values) as "no overrides" rather than
 * throwing — a broken map must never take down sync resolution.
 */
export function parseClientTokens(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, token] of Object.entries(parsed)) {
      if (typeof token === 'string' && token.trim()) out[id] = token.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeClientTokens(map: Record<string, string>): string {
  const entries = Object.entries(map).filter(([, token]) => token.trim());
  return entries.length ? JSON.stringify(Object.fromEntries(entries)) : '';
}

/** The client's own token override, or '' when it has none. */
export function getClientTokenOverride(clientId: string): string {
  return parseClientTokens(SettingsManager.get(CLIENT_TOKENS_KEY))[clientId] || '';
}

/**
 * Effective token for a sync scope ('world' or a client id): the client's
 * own override when set, otherwise the global `github.token`. World always
 * uses the global token (it's the operator's own shared base, not a brand).
 */
export function tokenForScope(scope: string): string {
  if (scope !== 'world') {
    const override = getClientTokenOverride(scope);
    if (override) return override;
  }
  return SettingsManager.get('github.token') || '';
}

/** Set (non-empty) or clear (null/'' ) a client's token override. */
export function setClientToken(clientId: string, token: string | null): void {
  const map = parseClientTokens(SettingsManager.get(CLIENT_TOKENS_KEY));
  const trimmed = (token || '').trim();
  if (trimmed) {
    map[clientId] = trimmed;
  } else {
    delete map[clientId];
  }
  SettingsManager.set(CLIENT_TOKENS_KEY, serializeClientTokens(map));
}

export interface ClientTokenStatus {
  /** True when this client has its own token override. */
  hasOwnToken: boolean;
  /** Last 4 characters of the override, for "••••1234" display; null without one. */
  last4: string | null;
  /** True when the global github.token fallback exists. */
  hasDefaultToken: boolean;
}

/** Masked status for UI display — never returns the token itself. */
export function clientTokenStatus(clientId: string): ClientTokenStatus {
  const override = getClientTokenOverride(clientId);
  return {
    hasOwnToken: !!override,
    last4: override ? override.slice(-4) : null,
    hasDefaultToken: !!(SettingsManager.get('github.token') || ''),
  };
}
