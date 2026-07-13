/**
 * Shareable client setup strings (roadmap item 9). A compact, copy-pasteable
 * blob that encodes a client's { id, name, repoUrl, syncMode } so a teammate
 * can paste it — during onboarding or from the Clients picker — and have
 * Pocket Agent auto-create the client row and pull its brain. No server
 * infra: this is base64(JSON), not a real URI scheme, so there's nothing to
 * register/host — paste-a-string works identically on every OS.
 *
 * The GitHub token itself is NEVER encoded here — tokens are per-operator
 * credentials (each teammate uses their own `github.token` setting to auth
 * against the shared repo), not something to bake into a copy-pasteable
 * string that might end up in Slack/email. The setup string only carries
 * what's needed to know WHICH repo/client to join; the join flow prompts
 * for a token separately when one isn't already configured.
 */

const PREFIX = 'pocketagent://join?';

export interface ClientSetupPayload {
  /** Stable client id (matches the `client:<id>` scope key). */
  id: string;
  /** Display name. */
  name: string;
  /** Git remote URL for the client's brain repo. */
  repoUrl: string;
  /** Sync mode to apply on the receiving end (defaults to 'live' on decode if omitted). */
  syncMode?: 'live' | 'manual';
}

/** Base64url encode (no padding) — safe to paste anywhere without URL-escaping. */
function toBase64Url(json: string): string {
  return Buffer.from(json, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Encode a client into a shareable setup string:
 * `pocketagent://join?<base64url(JSON)>`. The `pocketagent://` prefix is
 * cosmetic/discoverable (reads like a link) but is not registered as an OS
 * URI handler — the paste box decodes it directly, no protocol handler needed.
 */
export function encodeClientSetupString(payload: ClientSetupPayload): string {
  if (!payload.id || !payload.name || !payload.repoUrl) {
    throw new Error('encodeClientSetupString requires id, name, and repoUrl');
  }
  const json = JSON.stringify({
    id: payload.id,
    name: payload.name,
    repoUrl: payload.repoUrl,
    syncMode: payload.syncMode ?? 'live',
  });
  return PREFIX + toBase64Url(json);
}

export interface DecodeResult {
  ok: boolean;
  payload?: ClientSetupPayload;
  error?: string;
}

/**
 * Decode a setup string produced by encodeClientSetupString. Tolerant of
 * surrounding whitespace (common when pasted from chat apps) and of the
 * `pocketagent://join?` prefix being omitted (a user might paste just the
 * blob). Never throws — malformed input yields `{ ok: false, error }`.
 */
export function decodeClientSetupString(raw: string): DecodeResult {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Empty setup string' };

  const blob = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed;

  let json: string;
  try {
    json = fromBase64Url(blob);
  } catch {
    return { ok: false, error: 'Not a valid setup string (bad encoding)' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Not a valid setup string (bad payload)' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'Not a valid setup string (bad payload)' };
  }
  const p = parsed as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) {
    return { ok: false, error: 'Setup string is missing a client id' };
  }
  if (typeof p.name !== 'string' || !p.name) {
    return { ok: false, error: 'Setup string is missing a client name' };
  }
  if (typeof p.repoUrl !== 'string' || !p.repoUrl) {
    return { ok: false, error: 'Setup string is missing a repo URL' };
  }
  const syncMode = p.syncMode === 'manual' ? 'manual' : 'live';

  return {
    ok: true,
    payload: { id: p.id, name: p.name, repoUrl: p.repoUrl, syncMode },
  };
}
