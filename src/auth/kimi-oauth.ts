/**
 * Kimi (Moonshot) OAuth Implementation
 *
 * Uses Device Authorization Grant (RFC 8628) — not browser-redirect PKCE.
 * The user receives a verification URL + user code, authorizes in any browser,
 * and we poll the token endpoint until authorized.
 *
 * Based on gg-coder's Kimi OAuth implementation and MoonshotAI/kimi-code's
 * managed-auth flow.
 *
 * Endpoints (all form-encoded POST against auth.kimi.com):
 *  - /api/oauth/device_authorization  → device_code + user_code
 *  - /api/oauth/token (device_code)   → poll until authorized
 *  - /api/oauth/token (refresh_token) → refresh access token
 */

import crypto from 'crypto';
import os from 'os';
import { shell } from 'electron';
import { SettingsManager } from '../settings';

/** Public OAuth client id registered by Kimi Code (no client secret / PKCE). */
const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_HOST = 'https://auth.kimi.com';
const CODING_BASE_URL = 'https://api.kimi.com/coding/v1';

/** Platform identifier Kimi Code reports for the device flow. */
const KIMI_PLATFORM = 'kimi_code_cli';
const KIMI_VERSION = '1.0.11';

/** Local wall-clock budget for the whole device flow (15 min). */
const DEVICE_TIMEOUT_MS = 15 * 60 * 1000;

interface DeviceAuthorization {
  userCode: string;
  deviceCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  interval: number;
}

interface KimiTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function asciiHeader(value: string, fallback = 'unknown'): string {
  const cleaned = value.replace(/[^\u0020-\u007E]/g, '').trim();
  return cleaned.length > 0 ? cleaned : fallback;
}

function getDeviceId(): string {
  const stored = SettingsManager.get('kimi.deviceId');
  if (stored && stored.trim().length > 0) return stored;
  const id = crypto.randomUUID();
  SettingsManager.set('kimi.deviceId', id);
  return id;
}

function getDeviceModel(): string {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin') return `macOS ${arch}`;
  if (platform === 'win32') return `Windows ${arch}`;
  return `Linux ${arch}`;
}

function deviceHeaders(): Record<string, string> {
  return {
    'X-Msh-Platform': KIMI_PLATFORM,
    'X-Msh-Version': asciiHeader(KIMI_VERSION),
    'X-Msh-Device-Name': asciiHeader(os.hostname()),
    'X-Msh-Device-Model': asciiHeader(getDeviceModel()),
    'X-Msh-Os-Version': asciiHeader(os.release()),
    'X-Msh-Device-Id': getDeviceId(),
  };
}

/**
 * Headers the Kimi For Coding API requires on every model request.
 * The managed endpoint gates access to recognized coding agents.
 */
export function kimiCodingHeaders(): Record<string, string> {
  return {
    'User-Agent': `kimi-code-cli/${KIMI_VERSION}`,
    ...deviceHeaders(),
  };
}

/** Managed coding API base URL the issued OAuth token is used against. */
export function kimiCodeBaseUrl(): string {
  return CODING_BASE_URL;
}

async function postForm(
  endpoint: string,
  params: Record<string, string>
): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${OAUTH_HOST}${endpoint}`, {
    method: 'POST',
    headers: {
      ...deviceHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch {
    // non-JSON response
  }
  return { status: response.status, data };
}

function errorDetail(data: Record<string, unknown>): string {
  const desc = data.error_description ?? data.message ?? data.error;
  return typeof desc === 'string' && desc.length > 0 ? desc : 'unknown error';
}

function tokensFromResponse(data: Record<string, unknown>): KimiTokens {
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = Number(data.expires_in);
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Kimi OAuth response missing access_token.');
  }
  if (typeof refreshToken !== 'string' || refreshToken.length === 0) {
    throw new Error('Kimi OAuth response missing refresh_token.');
  }
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('Kimi OAuth response missing or invalid expires_in.');
  }
  return {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

async function requestDeviceAuthorization(): Promise<DeviceAuthorization> {
  const { status, data } = await postForm('/api/oauth/device_authorization', {
    client_id: CLIENT_ID,
  });
  if (status !== 200) {
    throw new Error(`Kimi device authorization failed (${status}): ${errorDetail(data)}`);
  }
  const userCode = data.user_code;
  const deviceCode = data.device_code;
  const verificationUriComplete = data.verification_uri_complete;
  if (typeof userCode !== 'string' || typeof deviceCode !== 'string') {
    throw new Error('Kimi device authorization response missing user_code/device_code.');
  }
  return {
    userCode,
    deviceCode,
    verificationUri: typeof data.verification_uri === 'string' ? data.verification_uri : '',
    verificationUriComplete:
      typeof verificationUriComplete === 'string' ? verificationUriComplete : '',
    interval: Number(data.interval ?? 5) || 5,
  };
}

type PollResult =
  | { kind: 'success'; tokens: KimiTokens }
  | { kind: 'pending' }
  | { kind: 'slow_down' }
  | { kind: 'expired' }
  | { kind: 'denied' };

async function pollDeviceToken(deviceCode: string): Promise<PollResult> {
  const { status, data } = await postForm('/api/oauth/token', {
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (status === 200 && typeof data.access_token === 'string') {
    return { kind: 'success', tokens: tokensFromResponse(data) };
  }
  if (status >= 500) {
    throw new Error(`Kimi token polling server error (${status}): ${errorDetail(data)}`);
  }
  const errorCode = typeof data.error === 'string' ? data.error : 'unknown_error';
  switch (errorCode) {
    case 'authorization_pending':
      return { kind: 'pending' };
    case 'slow_down':
      return { kind: 'slow_down' };
    case 'expired_token':
      return { kind: 'expired' };
    case 'access_denied':
      return { kind: 'denied' };
    default:
      throw new Error(`Kimi token polling failed (${status}): ${errorDetail(data)}`);
  }
}

class KimiOAuthManager {
  private static instance: KimiOAuthManager | null = null;
  private pendingAuth: boolean = false;
  private pollingActive: boolean = false;
  private refreshPromise: Promise<boolean> | null = null;

  private constructor() {}

  static getInstance(): KimiOAuthManager {
    if (!KimiOAuthManager.instance) {
      KimiOAuthManager.instance = new KimiOAuthManager();
    }
    return KimiOAuthManager.instance;
  }

  /**
   * Start the Kimi device-code OAuth flow.
   * Returns the verification info so the UI can display it, then polls in background.
   */
  async startFlow(): Promise<{
    success: boolean;
    userCode?: string;
    verificationUri?: string;
    error?: string;
  }> {
    try {
      const auth = await requestDeviceAuthorization();
      this.pendingAuth = true;

      // Open browser for authentication
      const url = auth.verificationUriComplete || auth.verificationUri;
      if (url) {
        await shell.openExternal(url);
      }

      // Start polling in background
      this.pollForToken(auth.deviceCode, auth.interval);

      return {
        success: true,
        userCode: auth.userCode,
        verificationUri: auth.verificationUri || auth.verificationUriComplete,
      };
    } catch (error) {
      this.pendingAuth = false;
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start Kimi OAuth flow',
      };
    }
  }

  /**
   * Poll for the device token in background. Saves tokens on success.
   */
  private async pollForToken(deviceCode: string, initialInterval: number): Promise<void> {
    if (this.pollingActive) return;
    this.pollingActive = true;

    const deadline = Date.now() + DEVICE_TIMEOUT_MS;
    let interval = Math.max(initialInterval, 1);

    try {
      while (Date.now() < deadline && this.pendingAuth) {
        await new Promise((resolve) => setTimeout(resolve, interval * 1000));

        if (!this.pendingAuth) break;

        const result = await pollDeviceToken(deviceCode);

        if (result.kind === 'success') {
          SettingsManager.set('kimi.auth.method', 'oauth');
          SettingsManager.set('kimi.accessToken', result.tokens.accessToken);
          SettingsManager.set('kimi.refreshToken', result.tokens.refreshToken);
          SettingsManager.set('kimi.tokenExpiresAt', result.tokens.expiresAt.toString());
          SettingsManager.set('kimi.baseUrl', CODING_BASE_URL);

          this.pendingAuth = false;
          console.log('[Kimi OAuth] Successfully authenticated');
          return;
        }

        if (result.kind === 'denied') {
          console.error('[Kimi OAuth] Authorization was denied');
          this.pendingAuth = false;
          return;
        }

        if (result.kind === 'expired') {
          console.error('[Kimi OAuth] Device code expired');
          this.pendingAuth = false;
          return;
        }

        if (result.kind === 'slow_down') {
          interval += 5;
        }
        // pending → keep polling
      }

      console.error('[Kimi OAuth] Login timed out');
      this.pendingAuth = false;
    } catch (error) {
      console.error('[Kimi OAuth] Polling error:', error);
      this.pendingAuth = false;
    } finally {
      this.pollingActive = false;
    }
  }

  /**
   * Check if OAuth flow is pending (waiting for user authorization).
   */
  isPending(): boolean {
    return this.pendingAuth;
  }

  /**
   * Cancel pending OAuth flow.
   */
  cancelFlow(): void {
    this.pendingAuth = false;
  }

  /**
   * Check if we have valid OAuth credentials.
   */
  isAuthenticated(): boolean {
    const authMethod = SettingsManager.get('kimi.auth.method');
    const accessToken = SettingsManager.get('kimi.accessToken');
    return authMethod === 'oauth' && !!accessToken;
  }

  /**
   * Refresh access token if needed (deduplicates concurrent calls).
   */
  async refreshTokenIfNeeded(): Promise<boolean> {
    const expiresAt = parseInt(SettingsManager.get('kimi.tokenExpiresAt') || '0', 10);
    const refreshToken = SettingsManager.get('kimi.refreshToken');

    // Check if token expires within 60 seconds
    if (Date.now() < expiresAt - 60000) {
      return true; // Token still valid
    }

    if (!refreshToken) {
      return false;
    }

    // Deduplicate concurrent refresh calls
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const tokens = await this.refreshAccessToken(refreshToken);

        SettingsManager.set('kimi.accessToken', tokens.accessToken);
        SettingsManager.set('kimi.refreshToken', tokens.refreshToken);
        SettingsManager.set('kimi.tokenExpiresAt', tokens.expiresAt.toString());

        console.log('[Kimi OAuth] Token refreshed');
        return true;
      } catch (error) {
        console.error('[Kimi OAuth] Token refresh failed:', error);
        SettingsManager.set('kimi.tokenExpiresAt', '0');
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  private async refreshAccessToken(refreshToken: string): Promise<KimiTokens> {
    const { status, data } = await postForm('/api/oauth/token', {
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    if (status !== 200 || typeof data.access_token !== 'string') {
      const errorCode = typeof data.error === 'string' ? data.error : '';
      throw new Error(`Kimi token refresh failed (${status}): ${errorCode || errorDetail(data)}`);
    }

    return tokensFromResponse(data);
  }

  /**
   * Get current access token (refreshing if needed).
   */
  async getAccessToken(): Promise<string | null> {
    const authMethod = SettingsManager.get('kimi.auth.method');
    if (authMethod !== 'oauth') {
      return null;
    }

    const refreshed = await this.refreshTokenIfNeeded();
    if (!refreshed) {
      return null;
    }

    return SettingsManager.get('kimi.accessToken') || null;
  }

  /**
   * Clear stored OAuth credentials.
   */
  logout(): void {
    SettingsManager.set('kimi.auth.method', '');
    SettingsManager.set('kimi.accessToken', '');
    SettingsManager.set('kimi.refreshToken', '');
    SettingsManager.set('kimi.tokenExpiresAt', '');
    SettingsManager.set('kimi.baseUrl', '');
    this.pendingAuth = false;
  }
}

export const KimiOAuth = KimiOAuthManager.getInstance();
