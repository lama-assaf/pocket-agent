/**
 * Integration-style tests for the first-party MCP stdio client transport
 * (roadmap item 5) against a real child process — tests/fixtures/mock-mcp-server.mjs
 * speaks the same newline-delimited JSON-RPC 2.0 protocol as a genuine MCP
 * server (verified separately against the published mcp-hacker-news package).
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { StdioMcpClient } from '../../src/mcp/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/mock-mcp-server.mjs');

function makeClient(mode: string): StdioMcpClient {
  return new StdioMcpClient(process.execPath, [FIXTURE], { MOCK_MCP_MODE: mode });
}

const clientsToClose: StdioMcpClient[] = [];
function track(client: StdioMcpClient): StdioMcpClient {
  clientsToClose.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clientsToClose.splice(0).map((c) => c.close()));
});

describe('StdioMcpClient — handshake + tool discovery', () => {
  it('completes the initialize handshake against a real child process', async () => {
    const client = track(makeClient('normal'));
    await expect(client.initialize()).resolves.toBeUndefined();
  });

  it('lists tools after initializing', async () => {
    const client = track(makeClient('normal'));
    await client.initialize();
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('echo');
    expect(tools[0].inputSchema.type).toBe('object');
  });
});

describe('StdioMcpClient — tool call round-trip', () => {
  it('calls a tool and returns its text content', async () => {
    const client = track(makeClient('normal'));
    await client.initialize();
    const result = await client.callTool('echo', { message: 'hello' }, 5000);
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.text)).toEqual({ message: 'hello' });
  });

  it('surfaces a server-side tool error via isError', async () => {
    const client = track(makeClient('error_tool'));
    await client.initialize();
    const result = await client.callTool('echo', { message: 'x' }, 5000);
    expect(result.isError).toBe(true);
    expect(result.text).toContain('simulated tool failure');
  });

  it('rejects when calling an unknown tool (JSON-RPC error)', async () => {
    const client = track(makeClient('normal'));
    await client.initialize();
    await expect(client.callTool('does_not_exist', {}, 5000)).rejects.toThrow(/Unknown tool/);
  });

  it('supports concurrent calls without cross-talk (each id resolves independently)', async () => {
    const client = track(makeClient('normal'));
    await client.initialize();
    const [a, b, c] = await Promise.all([
      client.callTool('echo', { message: 'a' }, 5000),
      client.callTool('echo', { message: 'b' }, 5000),
      client.callTool('echo', { message: 'c' }, 5000),
    ]);
    expect(JSON.parse(a.text)).toEqual({ message: 'a' });
    expect(JSON.parse(b.text)).toEqual({ message: 'b' });
    expect(JSON.parse(c.text)).toEqual({ message: 'c' });
  });
});

describe('StdioMcpClient — timeout', () => {
  it('rejects a call that never responds after the given timeout', async () => {
    const client = track(makeClient('slow_tool'));
    await client.initialize();
    await expect(client.callTool('echo', { message: 'x' }, 300)).rejects.toThrow(/timed out/);
  }, 10000);

  // Regression test for the real-world x-api/xurl case: a server can hang
  // indefinitely on an interactive step (e.g. an OAuth browser-login
  // listener) without ever crashing or exiting. Previously this surfaced as a
  // bare "timed out after Nms" indistinguishable from a merely-slow server;
  // the recent stderr tail (which a real server typically uses to announce
  // what it's stuck on) should now be included in the rejection message.
  it('includes the recent stderr tail when a call times out on a hung-but-alive server', async () => {
    const client = track(makeClient('slow_tool'));
    await client.initialize();
    await expect(client.callTool('echo', { message: 'x' }, 300)).rejects.toThrow(/simulated hang/);
  }, 10000);
});

describe('StdioMcpClient — crash isolation', () => {
  it('rejects initialize() when the server exits immediately on start', async () => {
    const client = track(makeClient('crash_on_start'));
    await expect(client.initialize()).rejects.toThrow();
  });

  it('fires onCrash and fails pending calls when the server dies mid-call', async () => {
    const client = track(makeClient('crash_after_init'));
    await client.initialize();

    let crashReason: string | null = null;
    client.onCrash((reason) => {
      crashReason = reason;
    });

    await expect(client.callTool('echo', { message: 'x' }, 5000)).rejects.toThrow();
    // Give the process 'exit' event a tick to fire the crash handler.
    await new Promise((r) => setTimeout(r, 100));
    expect(crashReason).not.toBeNull();
  });

  it('a dead server rejects subsequent calls instead of hanging', async () => {
    const client = track(makeClient('crash_on_start'));
    await client.initialize().catch(() => {});
    await expect(client.callTool('echo', {}, 1000)).rejects.toThrow();
  });
});

describe('StdioMcpClient — close', () => {
  it('close() is idempotent and safe to call without initializing', async () => {
    const client = new StdioMcpClient(process.execPath, [FIXTURE], { MOCK_MCP_MODE: 'normal' });
    await expect(client.close()).resolves.toBeUndefined();
    await expect(client.close()).resolves.toBeUndefined();
  });

  it('close() terminates the child process', async () => {
    const client = makeClient('normal');
    await client.initialize();
    await client.close();
    // Any call after close must fail, not hang.
    await expect(client.callTool('echo', {}, 1000)).rejects.toThrow();
  });

  // Regression test: a server that ignores SIGTERM (observed with xurl stuck
  // in a synchronous OAuth listener) used to be left running as an orphaned
  // process holding whatever port/resource it had — blocking every
  // subsequent launch attempt. close() must escalate to SIGKILL rather than
  // leaving it alive.
  it('escalates to SIGKILL and actually terminates a process that ignores SIGTERM', async () => {
    const client = makeClient('ignore_sigterm');
    await client.initialize();

    // Grab the underlying PID before close() clears the client's reference,
    // so we can verify from outside the client that the OS process is gone.
    const pid = (client as unknown as { child: { pid: number } }).child.pid;
    expect(typeof pid).toBe('number');

    await client.close();

    // Poll for the process to actually disappear (the escalation timer fires
    // after a delay) rather than asserting immediately after close() resolves.
    const deadline = Date.now() + 5000;
    let alive = true;
    while (Date.now() < deadline) {
      try {
        process.kill(pid, 0); // throws ESRCH once the process is gone
        await new Promise((r) => setTimeout(r, 100));
      } catch {
        alive = false;
        break;
      }
    }
    expect(alive).toBe(false);
  }, 10000);
});
