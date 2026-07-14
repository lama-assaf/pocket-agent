/**
 * MCP server lifecycle manager (roadmap item 5).
 *
 * Owns every live MCP client connection (stdio child process or HTTP
 * client), keyed by the server's stable id (`<packId>:<entryId>`, see
 * src/marketplace/mcp-status.ts). Lazy: a server is only spawned/connected
 * the first time something asks for it (`ensureServer`) — server start,
 * first tool-building pass of a session, whichever comes first. Crash
 * isolation: a server that dies (spawn failure, unexpected exit, a call
 * that throws) is marked 'failed' and never takes down the caller — every
 * public method here resolves/rejects predictably, and callers (mcp-bridge.ts)
 * treat a rejected call as "this one tool failed," not an agent-loop crash.
 */

import type { ResolvedMcpServer } from '../marketplace/mcp-status';
import { StdioMcpClient, HttpMcpClient, type McpClient, type McpToolDescriptor } from './client';
import { runOneShotCommand } from './one-shot';

export type McpRuntimeStatus = 'not_started' | 'starting' | 'running' | 'failed';

interface ManagedServer {
  client: McpClient;
  status: McpRuntimeStatus;
  tools: McpToolDescriptor[];
  lastError: string | null;
  /** In-flight connect promise, so concurrent ensureServer() calls share one spawn. */
  connecting: Promise<void> | null;
}

/** Per-tool-call budget when the caller doesn't specify one. */
export const DEFAULT_MCP_CALL_TIMEOUT_MS = 30_000;

function buildClient(spec: ResolvedMcpServer): McpClient {
  if (spec.kind === 'stdio') {
    return new StdioMcpClient(spec.command, spec.args, spec.env);
  }
  return new HttpMcpClient(spec.url, spec.headers);
}

export class McpServerManager {
  private servers = new Map<string, ManagedServer>();

  /**
   * Ensure a server is connected (spawned/handshaked + tools discovered),
   * reusing an existing live connection or an in-flight connect. Never
   * throws — a failed connect is recorded as status 'failed' with
   * `lastError` set, and this resolves normally so a caller can check status
   * rather than needing a try/catch at every call site.
   */
  async ensureServer(id: string, spec: ResolvedMcpServer): Promise<ManagedServer> {
    const existing = this.servers.get(id);
    if (existing) {
      if (existing.connecting) await existing.connecting;
      return this.servers.get(id)!;
    }

    const client = buildClient(spec);
    const managed: ManagedServer = { client, status: 'starting', tools: [], lastError: null, connecting: null };
    this.servers.set(id, managed);

    client.onCrash((reason) => {
      const current = this.servers.get(id);
      if (!current || current.client !== client) return; // already replaced/removed
      current.status = 'failed';
      current.lastError = reason;
      current.tools = [];
    });

    managed.connecting = (async () => {
      try {
        await client.initialize();
        const tools = await client.listTools();
        managed.status = 'running';
        managed.tools = tools;
      } catch (e) {
        managed.status = 'failed';
        managed.lastError = e instanceof Error ? e.message : String(e);
        managed.tools = [];
      } finally {
        managed.connecting = null;
      }
    })();

    await managed.connecting;
    return managed;
  }

  /** Tools currently known for a server (empty if never connected or connect failed). */
  getTools(id: string): McpToolDescriptor[] {
    return this.servers.get(id)?.tools ?? [];
  }

  getStatus(id: string): McpRuntimeStatus {
    return this.servers.get(id)?.status ?? 'not_started';
  }

  getLastError(id: string): string | null {
    return this.servers.get(id)?.lastError ?? null;
  }

  /** Snapshot of every server this manager has ever touched, for the Settings UI status pill. */
  getAllStatuses(): Record<string, McpRuntimeStatus> {
    const out: Record<string, McpRuntimeStatus> = {};
    for (const [id, s] of this.servers) out[id] = s.status;
    return out;
  }

  /**
   * Call a tool on an already-connected server. Never throws — a call
   * failure (timeout, server error, crash mid-call) is surfaced as an error
   * string result so the agent loop can show it to the model and continue,
   * not as an uncaught rejection that aborts the turn.
   */
  async callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs: number = DEFAULT_MCP_CALL_TIMEOUT_MS
  ): Promise<{ text: string; isError: boolean }> {
    const managed = this.servers.get(id);
    if (!managed || managed.status !== 'running') {
      return {
        text: `MCP server "${id}" is not running (status: ${managed?.status ?? 'not_started'}${managed?.lastError ? `: ${managed.lastError}` : ''}).`,
        isError: true,
      };
    }
    try {
      const result = await managed.client.callTool(toolName, args, timeoutMs);
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // A call failure doesn't necessarily mean the server crashed (could be
      // a bad-args error the server rejected) — only flip status on crash via
      // onCrash. Just surface the failure for this one call.
      return { text: `MCP tool call failed: ${message}`, isError: true };
    }
  }

  /** Tear down one server (used when a server is disabled mid-session, and by tests). */
  async stopServer(id: string): Promise<void> {
    const managed = this.servers.get(id);
    if (!managed) return;
    this.servers.delete(id);
    await managed.client.close().catch(() => {});
  }

  /** Tear down every managed server — called on app quit. */
  async shutdownAll(): Promise<void> {
    const ids = [...this.servers.keys()];
    await Promise.all(ids.map((id) => this.stopServer(id)));
  }

  /**
   * Force a fresh OAuth login for a server that delegates token caching to
   * an external CLI (McpCatalogEntry.reauth, e.g. xurl) — the
   * "Reauthenticate" Settings action. Three steps, each individually
   * diagnosable rather than collapsing into one bare failure:
   *
   * 1. Tear down any existing live connection for `id` (a stale connection
   *    holding the OLD token must not keep answering tool calls once the
   *    user explicitly asked to reauthenticate).
   * 2. Run the entry's one-shot `reauth` command (e.g. `xurl auth clear
   *    --all`) to invalidate the cached token. A failure here (missing
   *    binary, non-zero exit) is reported immediately with its stderr
   *    tail — same diagnostic shape as src/mcp/client.ts's crash/timeout
   *    handling — without ever attempting the respawn below.
   * 3. If `respawnSpec` is given (the server is enabled + fully
   *    configured), immediately spawn a fresh connection so the user sees
   *    the browser-consent step start right away instead of waiting for
   *    the next incidental tool call. This attempt resolves within
   *    client.ts's handshake timeout — for an interactive OAuth CLI that
   *    is *expected* to mean "still waiting on the user's browser", which
   *    is classified as a successful reauth START (not a failure) by
   *    pattern-matching the known xurl status line; a genuine port-bind
   *    conflict is classified separately so the message names the real
   *    cause instead of a generic timeout.
   */
  async reauthenticateServer(
    id: string,
    reauth: { command: string; args: string[] },
    respawnSpec?: ResolvedMcpServer
  ): Promise<{ success: boolean; cleared: boolean; message: string }> {
    await this.stopServer(id);

    const clearResult = await runOneShotCommand(reauth.command, reauth.args, {}, 10_000);
    if (!clearResult.success) {
      const reason = clearResult.spawnError
        ? `could not run the reauth command (${clearResult.spawnError})`
        : clearResult.timedOut
          ? 'the reauth command timed out'
          : `the reauth command exited with code ${clearResult.code ?? 'unknown'}`;
      const tail = clearResult.stderrTail ? ` — ${clearResult.stderrTail}` : '';
      return { success: false, cleared: false, message: `Failed to clear cached credentials: ${reason}${tail}` };
    }

    if (!respawnSpec) {
      return {
        success: true,
        cleared: true,
        message: 'Cleared cached credentials. The next tool call will trigger a fresh sign-in.',
      };
    }

    const managed = await this.ensureServer(id, respawnSpec);
    if (managed.status === 'running') {
      return { success: true, cleared: true, message: 'Reauthenticated — connected successfully.' };
    }

    const err = managed.lastError || '';
    if (/opening the browser to sign in/i.test(err) || /no valid oauth2? token/i.test(err)) {
      return {
        success: true,
        cleared: true,
        message: 'Cleared cached credentials and started a fresh sign-in — check your browser to complete the login.',
      };
    }
    if (/address already in use/i.test(err) || /listenererror/i.test(err)) {
      return {
        success: false,
        cleared: true,
        message: `Cleared cached credentials, but sign-in could not start — a port needed for the OAuth callback is already in use. ${err}`,
      };
    }
    return {
      success: false,
      cleared: true,
      message: `Cleared cached credentials, but the fresh sign-in failed: ${err || 'unknown error'}`,
    };
  }
}

// ── Module-level singleton, same pattern as src/tools/memory-tools.ts ──
let manager: McpServerManager | null = null;

export function getMcpServerManager(): McpServerManager {
  if (!manager) manager = new McpServerManager();
  return manager;
}

/** Test-only: reset the singleton between test files/suites. */
export function resetMcpServerManagerForTests(): void {
  manager = null;
}
