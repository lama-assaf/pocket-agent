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
