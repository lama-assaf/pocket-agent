const DEVICE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

interface DeviceResponse {
  device_code?: unknown;
  user_code?: unknown;
  verification_uri?: unknown;
  expires_in?: unknown;
  interval?: unknown;
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

export interface GitHubDeviceFlowOptions {
  clientId: string;
  fetchFn?: typeof fetch;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  onCode?: (code: { userCode: string; verificationUri: string }) => void;
}

async function post(
  fetchFn: typeof fetch,
  url: string,
  values: Record<string, string>
): Promise<Response> {
  return fetchFn(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values).toString(),
  });
}

async function parse(response: Response, context: string): Promise<DeviceResponse> {
  try {
    const data: unknown = await response.json();
    if (data && typeof data === 'object') return data as DeviceResponse;
  } catch {
    // handled below
  }
  throw new Error(`${context} returned malformed JSON (${response.status}).`);
}

function sleepDefault(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('GitHub connection cancelled.'));
      },
      { once: true }
    );
  });
}

export async function runGitHubDeviceFlow(options: GitHubDeviceFlowOptions): Promise<string> {
  if (!options.clientId.trim()) throw new Error('GitHub OAuth App Client ID is not configured.');
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.now ?? Date.now;
  const signal = options.signal ?? new AbortController().signal;
  const sleep = options.sleep ?? sleepDefault;
  if (signal.aborted) throw new Error('GitHub connection cancelled.');

  const deviceResponse = await post(fetchFn, DEVICE_URL, {
    client_id: options.clientId,
    scope: 'repo',
  });
  const device = await parse(deviceResponse, 'GitHub device authorization');
  if (!deviceResponse.ok || typeof device.error === 'string') {
    throw new Error(
      `GitHub device authorization failed (${deviceResponse.status}): ${String(device.error_description ?? device.error ?? 'unknown error')}`
    );
  }
  if (
    typeof device.device_code !== 'string' ||
    typeof device.user_code !== 'string' ||
    typeof device.verification_uri !== 'string'
  ) {
    throw new Error('GitHub device authorization response is missing required fields.');
  }
  const expiresIn = Number(device.expires_in);
  let interval = Number(device.interval ?? 5);
  if (
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    !Number.isFinite(interval) ||
    interval <= 0
  ) {
    throw new Error('GitHub device authorization response has invalid expiry or interval.');
  }
  options.onCode?.({ userCode: device.user_code, verificationUri: device.verification_uri });
  const deadline = now() + expiresIn * 1000;

  while (now() < deadline) {
    await sleep(interval * 1000, signal);
    if (signal.aborted) throw new Error('GitHub connection cancelled.');
    if (now() >= deadline) break;
    const tokenResponse = await post(fetchFn, TOKEN_URL, {
      client_id: options.clientId,
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const token = await parse(tokenResponse, 'GitHub token polling');
    if (tokenResponse.ok && typeof token.access_token === 'string' && token.access_token)
      return token.access_token;
    switch (token.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        interval += 5;
        break;
      case 'access_denied':
        throw new Error('GitHub authorization was denied.');
      case 'expired_token':
        throw new Error('GitHub device code expired.');
      default:
        throw new Error(
          `GitHub token polling failed (${tokenResponse.status}): ${String(token.error_description ?? token.error ?? 'malformed response')}`
        );
    }
  }
  throw new Error('GitHub connection timed out.');
}
