/**
 * First-party MCP client transport (roadmap item 5).
 *
 * Speaks the MCP wire protocol — JSON-RPC 2.0, newline-delimited over stdio —
 * the same shape this app's own first-party servers (src/mcp/project-server.ts,
 * src/mcp/browser-server.ts) already emit, and verified against a real
 * published MCP server (mcp-hacker-news) during development. Two transports:
 *
 *  - `StdioMcpClient`: spawns `command args` as a child process, frames
 *    requests/responses as newline-delimited JSON on stdin/stdout. This is
 *    the primary, fully-supported transport (every stdio catalog entry in
 *    both Atelier and Salon's mcp-configs uses this shape).
 *  - `HttpMcpClient`: for `url`-kind catalog entries (Buffer, Typefully,
 *    Postiz, Figma-remote, Linear-remote). Implements a single-request/
 *    single-response JSON-RPC-over-HTTP POST per call — enough to complete
 *    the `initialize` handshake and `tools/list`/`tools/call` against a
 *    spec-compliant "Streamable HTTP" MCP server that replies with a plain
 *    JSON body (not a persistent SSE stream). KNOWN GAP: the full MCP
 *    Streamable-HTTP transport supports server-initiated SSE pushes and a
 *    resumable `Mcp-Session-Id` session; this client does not maintain a
 *    long-lived stream or session id, so server capabilities relying on
 *    unsolicited server→client messages (elicitation, sampling callbacks)
 *    are unsupported. Request/response tool calls — which is everything
 *    this app's catalog entries use — work fine.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

/** A single MCP `tools/call` result — normalized to the text pocket-agent tools return. */
export interface McpCallResult {
  /** Concatenated text content from the result (MCP content blocks joined). */
  text: string;
  /** True when the server flagged this result as a tool-level error (`isError`). */
  isError: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Common interface both transports implement — the manager (manager.ts) only depends on this. */
export interface McpClient {
  /** Handshake + capability negotiation. Must succeed before any other call. */
  initialize(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<McpCallResult>;
  close(): Promise<void>;
  /** Resolves when the underlying transport dies unexpectedly (process exit / connection drop). Never rejects. */
  onCrash(cb: (reason: string) => void): void;
}

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'pocket-agent', version: '1.0.0' };
/** Default budget for the initialize handshake itself (distinct from per-call timeouts). */
const HANDSHAKE_TIMEOUT_MS = 15_000;

function extractResultText(result: unknown): McpCallResult {
  const r = result as { content?: Array<{ type?: string; text?: string }>; isError?: boolean } | undefined;
  const parts = (r?.content ?? [])
    .filter((c) => c && (c.type === undefined || c.type === 'text') && typeof c.text === 'string')
    .map((c) => c.text as string);
  return { text: parts.join('\n') || JSON.stringify(result ?? null), isError: r?.isError === true };
}

/**
 * Newline-delimited JSON-RPC 2.0 client over a child process's stdio.
 * One in-flight request per id; concurrent calls are supported (each gets
 * its own id and promise, resolved independently as responses arrive).
 */
export class StdioMcpClient implements McpClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private crashHandlers: Array<(reason: string) => void> = [];
  private crashed = false;
  private stderrTail: string[] = [];

  constructor(
    private readonly command: string,
    private readonly args: string[],
    private readonly env: Record<string, string> = {}
  ) {}

  onCrash(cb: (reason: string) => void): void {
    this.crashHandlers.push(cb);
  }

  private fireCrash(reason: string): void {
    if (this.crashed) return;
    this.crashed = true;
    // Any request still awaiting a response can never resolve now — fail them
    // so a caller blocked on callTool()/listTools() doesn't hang forever.
    for (const { reject } of this.pending.values()) {
      reject(new Error(`MCP server crashed: ${reason}`));
    }
    this.pending.clear();
    for (const cb of this.crashHandlers) {
      try {
        cb(reason);
      } catch (e) {
        console.error('[MCP] onCrash handler threw:', e);
      }
    }
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Not JSON — some servers log to stdout by mistake. Ignore rather than crash.
      return;
    }
    const waiter = this.pending.get(msg.id);
    if (!waiter) return;
    this.pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(`${msg.error.message} (code ${msg.error.code})`));
    } else {
      waiter.resolve(msg.result);
    }
  }

  private send(method: string, params?: Record<string, unknown>, timeoutMs = 30_000): Promise<unknown> {
    if (!this.child || this.crashed) {
      return Promise.reject(new Error('MCP server is not running'));
    }
    const id = this.nextId++;
    const req: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        this.child!.stdin.write(JSON.stringify(req) + '\n');
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  async initialize(): Promise<void> {
    if (this.child) return; // already initialized/initializing
    this.child = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.child.stdout.setEncoding('utf-8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        this.handleLine(line);
      }
    });

    this.child.stderr.setEncoding('utf-8');
    this.child.stderr.on('data', (chunk: string) => {
      // Keep a short rolling tail for crash diagnostics — never let stderr
      // volume grow unbounded (a chatty/broken server shouldn't leak memory).
      this.stderrTail.push(chunk);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
    });

    this.child.on('error', (err) => {
      this.fireCrash(`spawn error: ${err.message}`);
    });

    this.child.on('exit', (code, signal) => {
      const detail = signal ? `signal ${signal}` : `code ${code}`;
      const tail = this.stderrTail.join('').trim().slice(-500);
      this.fireCrash(tail ? `exited (${detail}): ${tail}` : `exited (${detail})`);
    });

    await this.send(
      'initialize',
      {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
      HANDSHAKE_TIMEOUT_MS
    );
    // Fire-and-forget notification — no response expected, per MCP spec.
    try {
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    } catch {
      // Non-fatal: some servers don't require the notification to proceed.
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.send('tools/list', {}, HANDSHAKE_TIMEOUT_MS)) as {
      tools?: McpToolDescriptor[];
    };
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<McpCallResult> {
    const result = await this.send('tools/call', { name, arguments: args }, timeoutMs);
    return extractResultText(result);
  }

  async close(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    this.fireCrash('closed'); // fail any still-pending requests before we tear down
    try {
      child.kill();
    } catch {
      // Already dead — fine.
    }
  }
}

/**
 * Single-request-per-call JSON-RPC-over-HTTP client for `url`-kind catalog
 * entries. See the module doc for the Streamable-HTTP gap this doesn't cover.
 */
export class HttpMcpClient implements McpClient {
  private nextId = 1;
  private closed = false;
  private crashHandlers: Array<(reason: string) => void> = [];

  constructor(
    private readonly url: string,
    private readonly headers: Record<string, string> = {}
  ) {}

  onCrash(cb: (reason: string) => void): void {
    this.crashHandlers.push(cb);
  }

  private fireCrash(reason: string): void {
    for (const cb of this.crashHandlers) {
      try {
        cb(reason);
      } catch (e) {
        console.error('[MCP] onCrash handler threw:', e);
      }
    }
  }

  private async post(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (this.closed) throw new Error('MCP HTTP client is closed');
    const id = this.nextId++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...this.headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`MCP HTTP ${method} failed: ${res.status} ${res.statusText}`);
      }
      const contentType = res.headers.get('content-type') ?? '';
      let body: JsonRpcResponse;
      if (contentType.includes('text/event-stream')) {
        // Minimal SSE support: read the stream and parse the first `data:` frame
        // as the JSON-RPC response — covers the common single-response case
        // without implementing full session resumption (see module doc gap).
        const raw = await res.text();
        const dataLine = raw.split('\n').find((l) => l.startsWith('data:'));
        if (!dataLine) throw new Error('MCP HTTP: empty SSE response');
        body = JSON.parse(dataLine.slice(5).trim()) as JsonRpcResponse;
      } else {
        body = (await res.json()) as JsonRpcResponse;
      }
      if (body.error) throw new Error(`${body.error.message} (code ${body.error.code})`);
      return body.result;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`, { cause: e });
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize(): Promise<void> {
    try {
      await this.post(
        'initialize',
        { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
        HANDSHAKE_TIMEOUT_MS
      );
    } catch (e) {
      this.fireCrash(e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.post('tools/list', {}, HANDSHAKE_TIMEOUT_MS)) as {
      tools?: McpToolDescriptor[];
    };
    return result?.tools ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number
  ): Promise<McpCallResult> {
    const result = await this.post('tools/call', { name, arguments: args }, timeoutMs);
    return extractResultText(result);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
