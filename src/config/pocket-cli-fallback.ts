// src/config/pocket-cli-fallback.ts
// Best-effort bridge from the standalone `pocket` CLI's own config store
// (~/.config/pocket/config.json — a separate Go binary the user already runs
// `pocket config set` against, entirely independent of this app's
// SettingsManager-backed store) into this app's MCP env resolution. Lets
// credentials like `x_client_id`/`x_client_secret` set via the CLI feed the
// `x-api` marketplace MCP server's `${X_CLIENT_ID}`/`${X_CLIENT_SECRET}`
// placeholders without requiring the user to re-enter them in the Settings UI.

import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const POCKET_CLI_CONFIG_PATH = join(homedir(), '.config', 'pocket', 'config.json');

/**
 * Best-effort read of the standalone `pocket` CLI's own config store
 * (~/.config/pocket/config.json — a separate Go binary, not this app's
 * SettingsManager). Keys are lowercase snake_case (e.g. `x_client_id`);
 * uppercased so they line up 1:1 with `${X_CLIENT_ID}`-style placeholders
 * in marketplace mcp-servers.json env templates. Missing file / bad JSON /
 * non-string values all degrade to {} — this is a fallback source only,
 * never a hard dependency, so any error here must never throw.
 */
export function readPocketCliFallbackEnv(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(POCKET_CLI_CONFIG_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k.toUpperCase()] = v;
    }
    return out;
  } catch {
    return {};
  }
}
