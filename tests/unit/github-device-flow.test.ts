import { describe, expect, it, vi } from 'vitest';
import { runGitHubDeviceFlow } from '../../src/auth/github-device-flow';

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

const device = { device_code: 'device', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 2 };
const immediateSleep = vi.fn(async () => undefined);

function fetchSequence(...responses: Response[]): typeof fetch {
  return vi.fn(async () => responses.shift() ?? response({}, 500)) as unknown as typeof fetch;
}

describe('GitHub device flow', () => {
  it('returns an access token and exposes the user code', async () => {
    const onCode = vi.fn();
    const fetchFn = fetchSequence(response(device), response({ access_token: 'gho_token', token_type: 'bearer', scope: 'repo' }));
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn, sleep: immediateSleep, onCode })).resolves.toBe('gho_token');
    expect(onCode).toHaveBeenCalledWith({ userCode: 'ABCD', verificationUri: 'https://github.com/login/device' });
    expect(String((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body)).toContain('scope=repo');
  });

  it('polls again after authorization_pending', async () => {
    const fetchFn = fetchSequence(response(device), response({ error: 'authorization_pending' }), response({ access_token: 'token' }));
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn, sleep: immediateSleep })).resolves.toBe('token');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('adds five seconds after slow_down', async () => {
    const sleeps: number[] = [];
    const fetchFn = fetchSequence(response(device), response({ error: 'slow_down' }), response({ access_token: 'token' }));
    await runGitHubDeviceFlow({ clientId: 'client', fetchFn, sleep: async (ms) => { sleeps.push(ms); } });
    expect(sleeps).toEqual([2000, 7000]);
  });

  it.each([
    ['access_denied', 'denied'],
    ['expired_token', 'expired'],
  ])('reports %s', async (error, message) => {
    const fetchFn = fetchSequence(response(device), response({ error }));
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn, sleep: immediateSleep })).rejects.toThrow(message);
  });

  it('reports HTTP error responses', async () => {
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn: fetchSequence(response({ error: 'bad_verification_code', error_description: 'bad code' }, 400)) })).rejects.toThrow('bad code');
  });

  it('reports malformed JSON and missing fields', async () => {
    const malformed = vi.fn(async () => new Response('not-json', { status: 200 })) as unknown as typeof fetch;
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn: malformed })).rejects.toThrow('malformed JSON');
    await expect(runGitHubDeviceFlow({ clientId: 'client', fetchFn: fetchSequence(response({ user_code: 'x' })) })).rejects.toThrow('missing required fields');
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    const fetchFn = fetchSequence(response(device));
    await expect(runGitHubDeviceFlow({
      clientId: 'client', fetchFn, signal: controller.signal,
      sleep: async () => { controller.abort(); },
    })).rejects.toThrow('cancelled');
  });

  it('times out at the advertised expiry', async () => {
    let now = 0;
    const fetchFn = fetchSequence(response({ ...device, expires_in: 1, interval: 1 }));
    await expect(runGitHubDeviceFlow({
      clientId: 'client', fetchFn, now: () => now,
      sleep: async () => { now = 1000; },
    })).rejects.toThrow('timed out');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
