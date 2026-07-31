/**
 * Unit tests for src/auth/github-oauth.ts's GitHubOAuthManager singleton.
 *
 * The pure device-flow request/poll logic (src/auth/github-device-flow.ts)
 * is already covered end-to-end in tests/unit/github-device-flow.test.ts
 * (pending→authorized, slow_down, expiry, cancellation, malformed
 * responses). This file mocks that module instead of re-testing it, and
 * focuses on what the manager adds on top: startFlow() resolving as soon as
 * the device code arrives (NOT when the whole background poll finishes —
 * see startFlow()'s doc comment for why blocking here would be a real bug),
 * settings persistence, getAuthStatus()'s live-revocation check, and
 * disconnect().
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSettingsStore = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn((key: string) => mockSettingsStore.get(key) ?? ''),
    set: vi.fn((key: string, value: string) => {
      mockSettingsStore.set(key, value);
    }),
  },
}));

const mockShellOpenExternal = vi.fn();
vi.mock('electron', () => ({
  shell: { openExternal: (...args: unknown[]) => mockShellOpenExternal(...args) },
}));

const { runGitHubDeviceFlowMock } = vi.hoisted(() => ({ runGitHubDeviceFlowMock: vi.fn() }));
vi.mock('../../src/auth/github-device-flow', () => ({
  runGitHubDeviceFlow: runGitHubDeviceFlowMock,
}));

const mockFetch = vi.fn();
const originalFetch = global.fetch;

/** A promise plus externally-callable resolve/reject, so a test can control exactly when the mocked device flow "finishes" independent of when it calls onCode(). */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flush pending microtasks so a resolved/rejected promise's .then/.catch/.finally chain has actually run before assertions. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('GitHubOAuthManager', () => {
  beforeEach(async () => {
    mockSettingsStore.clear();
    mockSettingsStore.set('github.clientId', 'client-123');
    vi.clearAllMocks();
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
    // Fresh singleton state per test — cancel anything left pending from a
    // prior test (defensive; each test below also cleans up after itself).
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    GitHubOAuth.cancelFlow();
    await flushMicrotasks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resolves with the device code as soon as it arrives — NOT when the whole background poll finishes', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    const flow = deferred<string>();
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: { onCode?: (c: { userCode: string; verificationUri: string }) => void }) => {
        opts.onCode?.({ userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' });
        return flow.promise; // never resolves during this test — proves startFlow() doesn't wait on it
      }
    );

    const startPromise = GitHubOAuth.startFlow();
    const result = await Promise.race([
      startPromise,
      new Promise((resolve) => setTimeout(() => resolve('TIMED_OUT'), 50)),
    ]);

    expect(result).toEqual({
      success: true,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
    });
    expect(mockShellOpenExternal).toHaveBeenCalledWith('https://github.com/login/device');
    // The background poll is still in flight — no token written yet.
    expect(mockSettingsStore.get('github.token')).toBeUndefined();
    expect(GitHubOAuth.isPending()).toBe(true);

    flow.resolve('gho_finaltoken');
    await flushMicrotasks();
    expect(mockSettingsStore.get('github.token')).toBe('gho_finaltoken');
    expect(mockSettingsStore.get('github.authMethod')).toBe('oauth');
    expect(GitHubOAuth.isPending()).toBe(false);
  });

  it('writes github.token and github.authMethod=oauth once the background poll succeeds', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: { onCode?: (c: { userCode: string; verificationUri: string }) => void }) => {
        opts.onCode?.({ userCode: 'WXYZ-5678', verificationUri: 'https://github.com/login/device' });
        return 'gho_immediatetoken';
      }
    );

    const result = await GitHubOAuth.startFlow();
    expect(result.success).toBe(true);
    await flushMicrotasks();

    expect(mockSettingsStore.get('github.token')).toBe('gho_immediatetoken');
    expect(mockSettingsStore.get('github.authMethod')).toBe('oauth');
  });

  it('resolves with an error when the device-code request itself fails (before onCode ever fires)', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    runGitHubDeviceFlowMock.mockImplementation(async () => {
      throw new Error('GitHub device authorization failed (500): server error');
    });

    const result = await GitHubOAuth.startFlow();
    await flushMicrotasks();
    expect(result).toEqual({
      success: false,
      error: 'GitHub device authorization failed (500): server error',
    });
    expect(mockSettingsStore.has('github.token')).toBe(false);
    expect(GitHubOAuth.isPending()).toBe(false);
  });

  it('a later polling failure (denied/expired) after the code was shown does not re-reject the already-resolved startFlow() promise, and never writes a token', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    const flow = deferred<string>();
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: { onCode?: (c: { userCode: string; verificationUri: string }) => void }) => {
        opts.onCode?.({ userCode: 'DENY-0001', verificationUri: 'https://github.com/login/device' });
        return flow.promise;
      }
    );

    const result = await GitHubOAuth.startFlow();
    expect(result).toEqual({
      success: true,
      userCode: 'DENY-0001',
      verificationUri: 'https://github.com/login/device',
    });

    flow.reject(new Error('GitHub authorization was denied.'));
    await flushMicrotasks();

    expect(mockSettingsStore.has('github.token')).toBe(false);
    expect(GitHubOAuth.isPending()).toBe(false);
  });

  // src/auth/github-oauth.ts bundles a public DEFAULT_CLIENT_ID so "Connect
  // GitHub" works out of the box with no manual setup — so with no
  // github.clientId setting and no env var, startFlow() now falls through
  // to that bundled default and proceeds, instead of refusing.
  it('falls back to the bundled DEFAULT_CLIENT_ID when neither the setting nor the env var is configured', async () => {
    mockSettingsStore.delete('github.clientId');
    delete process.env.POCKET_AGENT_GITHUB_CLIENT_ID;
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: { onCode?: (c: { userCode: string; verificationUri: string }) => void }) => {
        opts.onCode?.({ userCode: 'BUNDLED-1', verificationUri: 'https://github.com/login/device' });
        return '[REDACTED]';
      }
    );
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    const result = await GitHubOAuth.startFlow();
    expect(result.success).toBe(true);
    expect(runGitHubDeviceFlowMock).toHaveBeenCalled();
  });

  it('refuses a second concurrent start while one is already pending', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    const flow = deferred<string>();
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: { onCode?: (c: { userCode: string; verificationUri: string }) => void }) => {
        opts.onCode?.({ userCode: 'FIRST-1', verificationUri: 'https://github.com/login/device' });
        return flow.promise;
      }
    );

    const first = GitHubOAuth.startFlow();
    await first;
    const second = await GitHubOAuth.startFlow();
    expect(second).toEqual({ success: false, error: 'A GitHub sign-in is already in progress.' });

    flow.resolve('gho_token');
    await flushMicrotasks();
  });

  it('cancelFlow() aborts the in-flight device flow and clears pendingAuth', async () => {
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    let capturedSignal: AbortSignal | undefined;
    runGitHubDeviceFlowMock.mockImplementation(
      async (opts: {
        onCode?: (c: { userCode: string; verificationUri: string }) => void;
        signal?: AbortSignal;
      }) => {
        capturedSignal = opts.signal;
        opts.onCode?.({ userCode: 'CANCEL-1', verificationUri: 'https://github.com/login/device' });
        return new Promise((_resolve, reject) => {
          opts.signal?.addEventListener('abort', () => reject(new Error('GitHub connection cancelled.')));
        });
      }
    );

    await GitHubOAuth.startFlow();
    expect(GitHubOAuth.isPending()).toBe(true);
    GitHubOAuth.cancelFlow();
    expect(capturedSignal?.aborted).toBe(true);
    await flushMicrotasks();
    expect(GitHubOAuth.isPending()).toBe(false);
    expect(mockSettingsStore.has('github.token')).toBe(false);
  });

  describe('getAuthStatus', () => {
    it('reports disconnected with no token stored', async () => {
      const { GitHubOAuth } = await import('../../src/auth/github-oauth');
      const status = await GitHubOAuth.getAuthStatus();
      expect(status).toEqual({ connected: false, user: null, method: '', hasClientId: true });
    });

    it('reports connected with the live user on a successful GET /user', async () => {
      mockSettingsStore.set('github.token', 'gho_abc');
      mockSettingsStore.set('github.authMethod', 'oauth');
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ login: 'octocat', avatar_url: 'https://example.com/a.png' }), {
          status: 200,
        })
      );
      const { GitHubOAuth } = await import('../../src/auth/github-oauth');
      const status = await GitHubOAuth.getAuthStatus();
      expect(status).toEqual({
        connected: true,
        user: { login: 'octocat', avatarUrl: 'https://example.com/a.png' },
        method: 'oauth',
        hasClientId: true,
      });
    });

    it('clears the token and reports disconnected on a 401 (revoked)', async () => {
      mockSettingsStore.set('github.token', 'gho_revoked');
      mockSettingsStore.set('github.authMethod', 'oauth');
      mockFetch.mockResolvedValue(new Response('{}', { status: 401 }));
      const { GitHubOAuth } = await import('../../src/auth/github-oauth');
      const status = await GitHubOAuth.getAuthStatus();
      expect(status).toEqual({ connected: false, user: null, method: '', hasClientId: true });
      expect(mockSettingsStore.get('github.token')).toBe('');
      expect(mockSettingsStore.get('github.authMethod')).toBe('');
    });

    it('degrades to disconnected WITHOUT clearing the token on a network failure (offline is not the same as revoked)', async () => {
      mockSettingsStore.set('github.token', 'gho_stillvalid');
      mockSettingsStore.set('github.authMethod', 'oauth');
      mockFetch.mockRejectedValue(new Error('fetch failed: ENOTFOUND'));
      const { GitHubOAuth } = await import('../../src/auth/github-oauth');
      const status = await GitHubOAuth.getAuthStatus();
      expect(status.connected).toBe(false);
      expect(status.user).toBeNull();
      expect(mockSettingsStore.get('github.token')).toBe('gho_stillvalid');
    });
  });

  it('disconnect() clears both settings and resets pendingAuth', async () => {
    mockSettingsStore.set('github.token', 'gho_x');
    mockSettingsStore.set('github.authMethod', 'pat');
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    GitHubOAuth.disconnect();
    expect(mockSettingsStore.get('github.token')).toBe('');
    expect(mockSettingsStore.get('github.authMethod')).toBe('');
    expect(GitHubOAuth.isPending()).toBe(false);
  });

  // Resolution order is github.clientId setting -> POCKET_AGENT_GITHUB_CLIENT_ID
  // env var -> bundled DEFAULT_CLIENT_ID. With neither setting nor env var
  // configured, hasClientId is still true because of the bundled default;
  // an env var override still takes priority over that default.
  it('hasClientId() is true via the bundled default with no setting/env configured, and still honors an env override', async () => {
    mockSettingsStore.delete('github.clientId');
    delete process.env.POCKET_AGENT_GITHUB_CLIENT_ID;
    const { GitHubOAuth } = await import('../../src/auth/github-oauth');
    expect((await GitHubOAuth.getAuthStatus()).hasClientId).toBe(true);

    process.env.POCKET_AGENT_GITHUB_CLIENT_ID = 'env-client-id';
    expect((await GitHubOAuth.getAuthStatus()).hasClientId).toBe(true);
    delete process.env.POCKET_AGENT_GITHUB_CLIENT_ID;
  });
});
