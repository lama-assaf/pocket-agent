/**
 * McpServerManager lifecycle tests (roadmap item 5) against a real child
 * process — mirrors tests/unit/mcp-client.test.ts but at the manager layer:
 * lazy spawn, status tracking, crash isolation, and clean shutdown.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpServerManager } from '../../src/mcp/manager';
import type { ResolvedMcpServer } from '../../src/marketplace/mcp-status';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/mock-mcp-server.mjs');

function specFor(mode: string): ResolvedMcpServer {
  return { kind: 'stdio', command: process.execPath, args: [FIXTURE], env: { MOCK_MCP_MODE: mode } };
}

let manager: McpServerManager;

beforeEach(() => {
  manager = new McpServerManager();
});

afterEach(async () => {
  await manager.shutdownAll();
});

describe('McpServerManager — lazy spawn + status', () => {
  it('starts as not_started before ensureServer is called', () => {
    expect(manager.getStatus('srv-1')).toBe('not_started');
    expect(manager.getTools('srv-1')).toEqual([]);
  });

  it('ensureServer connects and reaches running with discovered tools', async () => {
    const managed = await manager.ensureServer('srv-1', specFor('normal'));
    expect(managed.status).toBe('running');
    expect(manager.getStatus('srv-1')).toBe('running');
    expect(manager.getTools('srv-1').map((t) => t.name)).toEqual(['echo']);
  });

  it('reuses an existing live connection on a second ensureServer call', async () => {
    await manager.ensureServer('srv-1', specFor('normal'));
    const first = manager.getTools('srv-1');
    await manager.ensureServer('srv-1', specFor('normal'));
    const second = manager.getTools('srv-1');
    expect(second).toBe(first); // same array reference — no re-spawn
  });

  it('concurrent ensureServer calls for the same id share one connect', async () => {
    const [a, b] = await Promise.all([
      manager.ensureServer('srv-1', specFor('normal')),
      manager.ensureServer('srv-1', specFor('normal')),
    ]);
    expect(a.client).toBe(b.client);
  });
});

describe('McpServerManager — crash isolation', () => {
  it('a server that fails to spawn is marked failed, not thrown', async () => {
    const managed = await manager.ensureServer('bad-1', specFor('crash_on_start'));
    expect(managed.status).toBe('failed');
    expect(managed.lastError).toBeTruthy();
  });

  it('a failed server never blocks a healthy one from connecting', async () => {
    const [bad, good] = await Promise.all([
      manager.ensureServer('bad-1', specFor('crash_on_start')),
      manager.ensureServer('good-1', specFor('normal')),
    ]);
    expect(bad.status).toBe('failed');
    expect(good.status).toBe('running');
  });

  it('callTool on a not-running server returns an error result, never throws', async () => {
    await manager.ensureServer('bad-1', specFor('crash_on_start'));
    const result = await manager.callTool('bad-1', 'echo', {});
    expect(result.isError).toBe(true);
    expect(result.text).toContain('not running');
  });

  it('callTool on an unknown server id returns an error result, never throws', async () => {
    const result = await manager.callTool('never-registered', 'echo', {});
    expect(result.isError).toBe(true);
  });

  it('a server that crashes mid-session flips to failed and future calls fail gracefully', async () => {
    await manager.ensureServer('crashy-1', specFor('crash_after_init'));
    expect(manager.getStatus('crashy-1')).toBe('running');

    const callResult = await manager.callTool('crashy-1', 'echo', { message: 'x' });
    expect(callResult.isError).toBe(true);

    // Give the process 'exit' event a tick to propagate to onCrash.
    await new Promise((r) => setTimeout(r, 150));
    expect(manager.getStatus('crashy-1')).toBe('failed');

    // A second call after the crash must still resolve to an error, not hang/throw.
    const second = await manager.callTool('crashy-1', 'echo', {});
    expect(second.isError).toBe(true);
  });

  it('a slow tool call times out without crashing the manager or other servers', async () => {
    await manager.ensureServer('slow-1', specFor('slow_tool'));
    await manager.ensureServer('good-1', specFor('normal'));

    const result = await manager.callTool('slow-1', 'echo', { message: 'x' }, 300);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('timed out');

    // The other server is unaffected.
    const goodResult = await manager.callTool('good-1', 'echo', { message: 'ok' });
    expect(goodResult.isError).toBe(false);
  }, 10000);
});

describe('McpServerManager — shutdown', () => {
  it('stopServer tears down one server and resets its status', async () => {
    await manager.ensureServer('srv-1', specFor('normal'));
    expect(manager.getStatus('srv-1')).toBe('running');
    await manager.stopServer('srv-1');
    expect(manager.getStatus('srv-1')).toBe('not_started');
  });

  it('shutdownAll tears down every managed server (clean quit)', async () => {
    await manager.ensureServer('srv-1', specFor('normal'));
    await manager.ensureServer('srv-2', specFor('normal'));
    expect(manager.getAllStatuses()).toEqual({ 'srv-1': 'running', 'srv-2': 'running' });

    await manager.shutdownAll();
    expect(manager.getStatus('srv-1')).toBe('not_started');
    expect(manager.getStatus('srv-2')).toBe('not_started');
  });
});
