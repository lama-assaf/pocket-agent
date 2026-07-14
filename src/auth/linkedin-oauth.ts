/**
 * LinkedIn OAuth Implementation (3-legged authorization code flow).
 *
 * Unlike Claude/OpenAI/Kimi (which ship a first-party client id), LinkedIn's
 * Community Management API requires the OPERATOR's OWN Developer app —
 * organization analytics are only readable by a member who administers that
 * org, authorized through an app that operator registered and got LinkedIn to
 * approve. So client id/secret are read from Settings (user-entered), not
 * hardcoded, and the flow can't start until both are configured.
 *
 * Uses a local loopback HTTP server to catch the redirect automatically
 * (same pattern as src/auth/openai-oauth.ts) rather than the copy-paste-code
 * flow Claude uses — LinkedIn's authorize screen doesn't render the code
 * anywhere visible, only via the redirect query string, so auto-capture is
 * both the standard approach and the only good UX here. The exact
 * `http://127.0.0.1:PORT/callback` this listens on must be registered
 * verbatim as an authorized redirect URL in the LinkedIn app's Auth settings.
 */

import http from 'http';
import crypto from 'crypto';
import { shell } from 'electron';
import { SettingsManager } from '../settings';

const AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const CALLBACK_PORT = 51739;
export const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;

// r_organization_social + rw_organization_admin is the standard scope pair
// LinkedIn's Community Management API documents for reading organization
// page/post analytics (organizationalEntityShareStatistics,
// organizationPageStatistics) on behalf of an admin of that org.
export const LINKEDIN_SCOPES = 'r_organization_social rw_organization_admin';

interface LinkedInTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

class LinkedInOAuthManager {
  private static instance: LinkedInOAuthManager | null = null;
  private pendingAuth = false;
  private refreshPromise: Promise<boolean> | null = null;

  private constructor() {}

  static getInstance(): LinkedInOAuthManager {
    if (!LinkedInOAuthManager.instance) {
      LinkedInOAuthManager.instance = new LinkedInOAuthManager();
    }
    return LinkedInOAuthManager.instance;
  }

  /** True once both halves of the operator's own Developer app are configured. */
  hasAppCredentials(): boolean {
    return !!SettingsManager.get('linkedin.clientId') && !!SettingsManager.get('linkedin.clientSecret');
  }

  isPending(): boolean {
    return this.pendingAuth;
  }

  private getAuthorizationURL(clientId: string, state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      scope: LINKEDIN_SCOPES,
      state,
    });
    return `${AUTHORIZE_URL}?${params.toString()}`;
  }

  /** Start the flow: opens the LinkedIn consent screen and waits for the local redirect. */
  async startFlow(): Promise<{ success: boolean; error?: string }> {
    if (!this.hasAppCredentials()) {
      return {
        success: false,
        error: 'Enter your LinkedIn Client ID and Client Secret first (developer.linkedin.com/apps).',
      };
    }
    if (this.pendingAuth) {
      return { success: false, error: 'A LinkedIn sign-in is already in progress.' };
    }

    const clientId = SettingsManager.get('linkedin.clientId');
    const clientSecret = SettingsManager.get('linkedin.clientSecret');
    const state = crypto.randomBytes(16).toString('hex');

    this.pendingAuth = true;
    try {
      const authUrl = this.getAuthorizationURL(clientId, state);
      const code = await this.waitForCallback(authUrl, state);
      const tokens = await this.exchangeCode(code, clientId, clientSecret);

      SettingsManager.set('linkedin.accessToken', tokens.accessToken);
      SettingsManager.set('linkedin.refreshToken', tokens.refreshToken ?? '');
      SettingsManager.set('linkedin.tokenExpiresAt', tokens.expiresAt.toString());

      console.log('[LinkedIn OAuth] Successfully authenticated');
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to complete LinkedIn OAuth flow',
      };
    } finally {
      this.pendingAuth = false;
    }
  }

  cancelFlow(): void {
    this.pendingAuth = false;
  }

  private waitForCallback(authUrl: string, expectedState: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      let receivedCode: string | null = null;
      let settled = false;

      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://127.0.0.1:${CALLBACK_PORT}`);
        if (url.pathname !== '/callback') {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }

        const errorParam = url.searchParams.get('error_description') || url.searchParams.get('error');
        if (errorParam) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>LinkedIn sign-in failed</h1><p>${errorParam}</p><p>You can close this tab.</p></body></html>`);
          server.close();
          return;
        }

        if (url.searchParams.get('state') !== expectedState) {
          res.statusCode = 400;
          res.end('State mismatch');
          server.close();
          return;
        }

        receivedCode = url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          '<html><body><h1>LinkedIn connected!</h1><p>You can close this tab and go back to Pocket Agent.</p></body></html>'
        );
        server.close();
      });

      server.on('error', (err) => {
        if (settled) return;
        settled = true;
        const code = err instanceof Error && 'code' in err ? (err as Error & { code?: string }).code : undefined;
        reject(
          code === 'EADDRINUSE'
            ? new Error(`Port ${CALLBACK_PORT} is already in use — close whatever else is using it and try again.`)
            : err
        );
      });

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        shell.openExternal(authUrl).catch(() => {
          // Ignore external-open failure — the user can still be waiting on the browser tab.
        });
      });

      server.on('close', () => {
        if (settled) return;
        settled = true;
        if (receivedCode) {
          resolve(receivedCode);
        } else {
          reject(new Error('LinkedIn sign-in closed without completing.'));
        }
      });

      // Give up after 2 minutes so a stuck/abandoned flow doesn't hold the port forever.
      setTimeout(() => {
        if (!receivedCode) server.close();
      }, 120_000);
    });
  }

  private async exchangeCode(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<LinkedInTokens> {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`LinkedIn token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
  }

  /** Refresh the access token if it's near expiry and a refresh token is available. */
  async refreshTokenIfNeeded(): Promise<boolean> {
    const expiresAt = parseInt(SettingsManager.get('linkedin.tokenExpiresAt') || '0', 10);
    const accessToken = SettingsManager.get('linkedin.accessToken');
    if (!accessToken) return false;

    // Token still valid for at least another 5 minutes.
    if (Date.now() < expiresAt - 5 * 60_000) return true;

    const refreshToken = SettingsManager.get('linkedin.refreshToken');
    if (!refreshToken) return false; // no refresh token issued — needs a fresh sign-in

    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const clientId = SettingsManager.get('linkedin.clientId');
        const clientSecret = SettingsManager.get('linkedin.clientSecret');
        const response = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        if (!response.ok) throw new Error(`Refresh failed (${response.status}): ${await response.text()}`);
        const data = (await response.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in: number;
        };
        SettingsManager.set('linkedin.accessToken', data.access_token);
        if (data.refresh_token) SettingsManager.set('linkedin.refreshToken', data.refresh_token);
        SettingsManager.set('linkedin.tokenExpiresAt', (Date.now() + data.expires_in * 1000).toString());
        return true;
      } catch (error) {
        console.error('[LinkedIn OAuth] Token refresh failed:', error);
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  /** Current access token, refreshing first if needed. Null when not connected or expired with no refresh path. */
  async getAccessToken(): Promise<string | null> {
    const ok = await this.refreshTokenIfNeeded();
    if (!ok) return null;
    return SettingsManager.get('linkedin.accessToken') || null;
  }

  logout(): void {
    SettingsManager.set('linkedin.accessToken', '');
    SettingsManager.set('linkedin.refreshToken', '');
    SettingsManager.set('linkedin.tokenExpiresAt', '');
    this.pendingAuth = false;
  }
}

export const LinkedInOAuth = LinkedInOAuthManager.getInstance();
