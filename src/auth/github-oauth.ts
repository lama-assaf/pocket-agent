/**
 * GitHub OAuth Device Flow — lets each user connect THEIR OWN GitHub account
 * for client/world brain sync (src/clients/sync.ts), instead of pasting a
 * shared/embedded token. No client_secret anywhere: the OAuth 2.0 Device
 * Authorization Grant (RFC 8628) needs only a public client_id — GitHub's own
 * docs: "it does not require the OAuth client secret, which means there is
 * no user-owned server component required." Same shape as
 * src/auth/kimi-oauth.ts (also device-flow), adapted for GitHub's endpoints.
 *
 * See docs/github-account-connection.md for the full design and registration
 * steps (registering the OAuth App + enabling Device Flow on github.com)
 * this depends on.
 *
 * Storage: the resulting access_token is written to `github.token` — the
 * EXACT SAME setting the manual-PAT flow already writes to and that
 * src/clients/sync.ts's authFor()/pullBrainRepo/publishBrainRepo already
 * read. This file never touches sync.ts; that's the whole point — a token
 * obtained here is indistinguishable, to every downstream sync call, from
 * one a user pasted by hand. `github.authMethod` is a second, purely
 * cosmetic setting so the Settings UI can say "Connected as @user" vs.
 * "Manual token configured"; no sync code reads it.
 *
 * No refresh token: classic GitHub OAuth App user tokens (web flow OR device
 * flow) do not expire on their own — only explicit revocation invalidates
 * them. So unlike Kimi/Claude/LinkedIn in this codebase, there is no
 * refresh cycle here; getConnectedUser() below is both the "am I connected"
 * check and the live validity check (a 401 from GitHub's API means revoked).
 */

import { shell } from 'electron';
import { SettingsManager } from '../settings';
import { runGitHubDeviceFlow } from './github-device-flow';

/** Optional bundled public client ID; Settings and the environment override it. */
const DEFAULT_CLIENT_ID = 'Ov23liBeg5iTcdoTEJR2';

const USER_API_URL = 'https://api.github.com/user';

export interface GitHubUser {
  login: string;
  avatarUrl: string;
}

export interface GitHubAuthStatus {
  /** True only after a live GET /user succeeds with the stored token. */
  connected: boolean;
  /** Null when disconnected, or when connected but the live check couldn't run (offline) — never a stale guess. */
  user: GitHubUser | null;
  /** How the current token (if any) was obtained — cosmetic, never read by sync.ts. */
  method: 'oauth' | 'pat' | '';
  /** True once CLIENT_ID has been filled in — the UI uses this to explain why Connect is disabled otherwise. */
  hasClientId: boolean;
}

/** Live GET /user with the stored token. Null on any failure (401 = revoked, network error = can't tell — caller treats both as "no user to show" but only 401 as genuinely disconnected). */
async function fetchGitHubUser(
  token: string
): Promise<{ user: GitHubUser | null; revoked: boolean }> {
  try {
    const response = await fetch(USER_API_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'pocket-agent',
      },
    });
    if (response.status === 401) return { user: null, revoked: true };
    if (!response.ok) return { user: null, revoked: false };
    const data = (await response.json()) as { login?: unknown; avatar_url?: unknown };
    if (typeof data.login !== 'string') return { user: null, revoked: false };
    return {
      user: {
        login: data.login,
        avatarUrl: typeof data.avatar_url === 'string' ? data.avatar_url : '',
      },
      revoked: false,
    };
  } catch {
    return { user: null, revoked: false };
  }
}

class GitHubOAuthManager {
  private static instance: GitHubOAuthManager | null = null;
  private pendingAuth = false;
  private abortController: AbortController | null = null;

  private constructor() {}

  static getInstance(): GitHubOAuthManager {
    if (!GitHubOAuthManager.instance) {
      GitHubOAuthManager.instance = new GitHubOAuthManager();
    }
    return GitHubOAuthManager.instance;
  }

  private getClientId(): string {
    return (
      SettingsManager.get('github.clientId') ||
      process.env.POCKET_AGENT_GITHUB_CLIENT_ID ||
      DEFAULT_CLIENT_ID
    );
  }

  hasClientId(): boolean {
    return this.getClientId().trim().length > 0;
  }

  isPending(): boolean {
    return this.pendingAuth;
  }

  /**
   * Start the device-code flow: request a code, open the verification page,
   * then poll in the background. Returns as soon as the device code arrives
   * (NOT when the whole flow finishes) so the caller can show the code to
   * the user while polling continues — completion is observed later via
   * isPending()/getAuthStatus(), same fire-and-forget-poll shape as
   * src/auth/kimi-oauth.ts's startFlow()/pollForToken() split. Getting this
   * wrong (awaiting the full runGitHubDeviceFlow() call, including its
   * internal poll loop, before returning) would block the IPC round trip for
   * up to the device code's whole expiry window — the UI would never get a
   * chance to render the code the user is supposed to type in.
   */
  async startFlow(): Promise<{
    success: boolean;
    userCode?: string;
    verificationUri?: string;
    error?: string;
  }> {
    if (!this.hasClientId()) {
      return {
        success: false,
        error:
          'GitHub Connect is not configured yet. Add the OAuth App Client ID above or set POCKET_AGENT_GITHUB_CLIENT_ID; see docs/github-account-connection.md.',
      };
    }
    if (this.pendingAuth) {
      return { success: false, error: 'A GitHub sign-in is already in progress.' };
    }

    this.pendingAuth = true;
    this.abortController = new AbortController();
    const abortController = this.abortController;

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: {
        success: boolean;
        userCode?: string;
        verificationUri?: string;
        error?: string;
      }) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      runGitHubDeviceFlow({
        clientId: this.getClientId(),
        signal: abortController.signal,
        onCode: ({ userCode, verificationUri }) => {
          void shell.openExternal(verificationUri);
          // Resolve the OUTER promise the instant we have a code to show —
          // the poll loop inside runGitHubDeviceFlow keeps running below.
          settle({ success: true, userCode, verificationUri });
        },
      })
        .then((accessToken) => {
          SettingsManager.set('github.token', accessToken);
          SettingsManager.set('github.authMethod', 'oauth');
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : 'Failed to start GitHub sign-in';
          console.error('[GitHub OAuth] Device flow failed:', message);
          // Only reaches the caller if the device-code REQUEST itself failed
          // (onCode never fired). A later polling failure (denied/expired/
          // timeout) after the code was already shown is surfaced through
          // isPending() flipping back to false with no token ever set —
          // exactly how the UI's poll loop (mirroring Kimi's) detects it.
          settle({ success: false, error: message });
        })
        .finally(() => {
          this.pendingAuth = false;
          this.abortController = null;
        });
    });
  }

  cancelFlow(): void {
    this.abortController?.abort();
    this.pendingAuth = false;
  }

  /**
   * Current connection status. `connected` is only true after a live GET
   * /user succeeds — a stored token alone isn't proof it still works
   * (revoked/deleted OAuth App). A network failure degrades to
   * `connected: false, user: null` WITHOUT clearing the stored token, so a
   * transient offline check never looks like a disconnect to the user (the
   * UI copy for this case should read "can't verify right now", not
   * "disconnected" — see settings-panel.js).
   */
  async getAuthStatus(): Promise<GitHubAuthStatus> {
    const token = SettingsManager.get('github.token') || '';
    const method = (SettingsManager.get('github.authMethod') || '') as GitHubAuthStatus['method'];
    if (!token) {
      return { connected: false, user: null, method: '', hasClientId: this.hasClientId() };
    }
    const { user, revoked } = await fetchGitHubUser(token);
    if (revoked) {
      // Token is dead — clear it so the UI doesn't keep offering "Disconnect"
      // for a credential that no longer authenticates anything.
      SettingsManager.set('github.token', '');
      SettingsManager.set('github.authMethod', '');
      return { connected: false, user: null, method: '', hasClientId: this.hasClientId() };
    }
    return { connected: user !== null, user, method, hasClientId: this.hasClientId() };
  }

  /** Clear the stored token (whichever way it was obtained). sync.ts sees an empty token on its next call and no-ops, same as before any token was ever set. */
  disconnect(): void {
    SettingsManager.set('github.token', '');
    SettingsManager.set('github.authMethod', '');
    this.pendingAuth = false;
  }
}

export const GitHubOAuth = GitHubOAuthManager.getInstance();
