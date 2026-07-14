/**
 * LinkedIn IPC surface: registration, memory-null degradation, scope
 * resolution (nearest-scope for org URN + sync), and delegation to the
 * OAuth singleton for the connection-management channels. Same mocking
 * pattern as analytics-ipc.test.ts/facts-ipc.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const mockIpcMainHandle = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler);
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (...args: [string, (...a: unknown[]) => unknown]) => mockIpcMainHandle(...args),
  },
}));

const { linkedInOAuthMock, syncModuleMock } = vi.hoisted(() => ({
  linkedInOAuthMock: {
    startFlow: vi.fn(),
    cancelFlow: vi.fn(),
    isPending: vi.fn(),
    logout: vi.fn(),
    hasAppCredentials: vi.fn(),
    getAccessToken: vi.fn(),
  },
  syncModuleMock: {
    getLinkedInOrgUrnForScope: vi.fn(),
    setLinkedInOrgUrnForScope: vi.fn(),
    syncLinkedInAnalyticsForScope: vi.fn(),
  },
}));

vi.mock('../../src/auth/linkedin-oauth', () => ({
  LinkedInOAuth: linkedInOAuthMock,
  REDIRECT_URI: 'http://127.0.0.1:51739/callback',
}));

vi.mock('../../src/integrations/linkedin/sync', () => syncModuleMock);

import { registerLinkedInIPC } from '../../src/main/ipc/linkedin-ipc';
import { clientScope } from '../../src/memory/scope';
import type { SessionContext } from '../../src/memory/sessions';

const personalCtx: SessionContext = { contextType: 'personal', clientId: null, projectKey: null };
const clientCtx = (id: string): SessionContext => ({ contextType: 'client', clientId: id, projectKey: null });

function makeMemoryStub() {
  return {};
}

describe('linkedin-ipc: registration', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerLinkedInIPC({ getMemory: () => null } as never);
  });

  it('registers every LinkedIn channel', () => {
    expect(handlers.has('linkedin:startOAuth')).toBe(true);
    expect(handlers.has('linkedin:cancelOAuth')).toBe(true);
    expect(handlers.has('linkedin:isOAuthPending')).toBe(true);
    expect(handlers.has('linkedin:logout')).toBe(true);
    expect(handlers.has('linkedin:getAuthStatus')).toBe(true);
    expect(handlers.has('linkedin:getOrgUrn')).toBe(true);
    expect(handlers.has('linkedin:setOrgUrn')).toBe(true);
    expect(handlers.has('linkedin:syncNow')).toBe(true);
    expect(handlers.has('linkedin:getRedirectUri')).toBe(true);
  });
});

describe('linkedin-ipc: OAuth delegation', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    Object.values(linkedInOAuthMock).forEach((fn) => fn.mockReset());
    registerLinkedInIPC({ getMemory: () => null } as never);
  });

  it('linkedin:startOAuth delegates to LinkedInOAuth.startFlow', async () => {
    linkedInOAuthMock.startFlow.mockResolvedValue({ success: true });
    const result = await handlers.get('linkedin:startOAuth')!({});
    expect(linkedInOAuthMock.startFlow).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('linkedin:getAuthStatus reports hasAppCredentials:false without checking a token when no app credentials exist', async () => {
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(false);
    const result = await handlers.get('linkedin:getAuthStatus')!({});
    expect(result).toEqual({ hasAppCredentials: false, connected: false });
    expect(linkedInOAuthMock.getAccessToken).not.toHaveBeenCalled();
  });

  it('linkedin:getAuthStatus reports connected:true when a token resolves', async () => {
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(true);
    linkedInOAuthMock.getAccessToken.mockResolvedValue('a-token');
    const result = await handlers.get('linkedin:getAuthStatus')!({});
    expect(result).toEqual({ hasAppCredentials: true, connected: true });
  });

  it('linkedin:getAuthStatus reports connected:false (never throws) when getAccessToken rejects', async () => {
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(true);
    linkedInOAuthMock.getAccessToken.mockRejectedValue(new Error('network down'));
    const result = await handlers.get('linkedin:getAuthStatus')!({});
    expect(result).toEqual({ hasAppCredentials: true, connected: false });
  });

  it('linkedin:getRedirectUri returns the exact redirect URI the user must register', async () => {
    const result = await handlers.get('linkedin:getRedirectUri')!({});
    expect(result).toBe('http://127.0.0.1:51739/callback');
  });

  it('linkedin:logout delegates to LinkedInOAuth.logout', async () => {
    const result = await handlers.get('linkedin:logout')!({});
    expect(linkedInOAuthMock.logout).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });
});

describe('linkedin-ipc: memory-null degradation', () => {
  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    registerLinkedInIPC({ getMemory: () => null } as never);
  });

  it('linkedin:getOrgUrn returns null when memory is not initialized', async () => {
    const result = await handlers.get('linkedin:getOrgUrn')!({}, personalCtx);
    expect(result).toBeNull();
  });

  it('linkedin:setOrgUrn fails gracefully when memory is not initialized', async () => {
    const result = await handlers.get('linkedin:setOrgUrn')!({}, 'urn:li:organization:1', personalCtx);
    expect(result).toEqual({ success: false, error: 'Memory not initialized' });
  });

  it('linkedin:syncNow fails gracefully when memory is not initialized', async () => {
    const result = await handlers.get('linkedin:syncNow')!({}, personalCtx);
    expect(result).toEqual({ ok: false, postsWritten: 0, error: 'Memory not initialized' });
  });
});

describe('linkedin-ipc: scope resolution + sync gating with a live memory stub', () => {
  let memoryStub: ReturnType<typeof makeMemoryStub>;

  beforeEach(() => {
    handlers.clear();
    mockIpcMainHandle.mockClear();
    memoryStub = makeMemoryStub();
    Object.values(syncModuleMock).forEach((fn) => fn.mockReset());
    Object.values(linkedInOAuthMock).forEach((fn) => fn.mockReset());
    registerLinkedInIPC({ getMemory: () => memoryStub } as never);
  });

  it('linkedin:getOrgUrn resolves the NEAREST scope for a client context (not the visible-scope chain)', async () => {
    syncModuleMock.getLinkedInOrgUrnForScope.mockReturnValue('urn:li:organization:1');
    const result = await handlers.get('linkedin:getOrgUrn')!({}, clientCtx('zilliqa'));
    expect(syncModuleMock.getLinkedInOrgUrnForScope).toHaveBeenCalledWith(memoryStub, clientScope('zilliqa'));
    expect(result).toBe('urn:li:organization:1');
  });

  it('linkedin:setOrgUrn resolves scope and delegates to setLinkedInOrgUrnForScope', async () => {
    await handlers.get('linkedin:setOrgUrn')!({}, 'urn:li:organization:9', clientCtx('ltin'));
    expect(syncModuleMock.setLinkedInOrgUrnForScope).toHaveBeenCalledWith(
      memoryStub,
      clientScope('ltin'),
      'urn:li:organization:9'
    );
  });

  it('linkedin:syncNow fails with an actionable error when no org URN is configured for the scope', async () => {
    syncModuleMock.getLinkedInOrgUrnForScope.mockReturnValue(null);
    const result = await handlers.get('linkedin:syncNow')!({}, clientCtx('zilliqa'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/organization urn/i);
    expect(syncModuleMock.syncLinkedInAnalyticsForScope).not.toHaveBeenCalled();
  });

  it('linkedin:syncNow fails with an actionable error when LinkedIn app credentials are missing', async () => {
    syncModuleMock.getLinkedInOrgUrnForScope.mockReturnValue('urn:li:organization:1');
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(false);
    const result = await handlers.get('linkedin:syncNow')!({}, clientCtx('zilliqa'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/client id\/secret/i);
    expect(syncModuleMock.syncLinkedInAnalyticsForScope).not.toHaveBeenCalled();
  });

  it('linkedin:syncNow fails with an actionable error when not connected (no access token)', async () => {
    syncModuleMock.getLinkedInOrgUrnForScope.mockReturnValue('urn:li:organization:1');
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(true);
    linkedInOAuthMock.getAccessToken.mockResolvedValue(null);
    const result = await handlers.get('linkedin:syncNow')!({}, clientCtx('zilliqa'));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not connected/i);
    expect(syncModuleMock.syncLinkedInAnalyticsForScope).not.toHaveBeenCalled();
  });

  it('linkedin:syncNow calls syncLinkedInAnalyticsForScope once everything is configured and connected', async () => {
    syncModuleMock.getLinkedInOrgUrnForScope.mockReturnValue('urn:li:organization:1');
    linkedInOAuthMock.hasAppCredentials.mockReturnValue(true);
    linkedInOAuthMock.getAccessToken.mockResolvedValue('a-token');
    syncModuleMock.syncLinkedInAnalyticsForScope.mockResolvedValue({ ok: true, postsWritten: 3 });

    const result = await handlers.get('linkedin:syncNow')!({}, clientCtx('zilliqa'));
    expect(syncModuleMock.syncLinkedInAnalyticsForScope).toHaveBeenCalledWith(
      memoryStub,
      clientScope('zilliqa'),
      'urn:li:organization:1',
      'a-token'
    );
    expect(result).toEqual({ ok: true, postsWritten: 3 });
  });
});
