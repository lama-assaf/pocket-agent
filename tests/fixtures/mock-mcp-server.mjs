#!/usr/bin/env node
/**
 * Mock stdio MCP server for integration-style unit tests
 * (tests/unit/mcp-client.test.ts, tests/unit/mcp-manager.test.ts).
 *
 * Speaks the same newline-delimited JSON-RPC 2.0 protocol as a real MCP
 * server (verified against the published `mcp-hacker-news` package during
 * development of src/mcp/client.ts). Behavior is selected via the
 * MOCK_MCP_MODE env var so tests can exercise handshake, tool discovery,
 * tool-call round-trips, timeouts, and crash recovery without a network
 * dependency or a real third-party binary.
 *
 * Modes:
 *   normal            - full handshake, one `echo` tool that echoes its args back.
 *   crash_on_start     - exits(1) immediately, before reading any input.
 *   crash_after_init   - handshakes normally, then exits(1) on the first tools/call.
 *   slow_tool          - handshakes normally; `echo` never responds (tests client-side timeout).
 *   error_tool         - handshakes normally; `echo` returns an MCP-level tool error (isError: true).
 */

import { createInterface } from 'readline';

const MODE = process.env.MOCK_MCP_MODE || 'normal';

if (MODE === 'crash_on_start') {
  process.exit(1);
}

const TOOLS = [
  {
    name: 'echo',
    description: 'Echoes back whatever arguments it receives.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Text to echo' } },
      required: ['message'],
    },
  },
];

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp-server', version: '1.0.0' },
      });
      return;

    case 'notifications/initialized':
      return; // no response expected

    case 'tools/list':
      respond(id, { tools: TOOLS });
      return;

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (name !== 'echo') {
        respondError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      if (MODE === 'crash_after_init') {
        process.exit(1);
      }
      if (MODE === 'slow_tool') {
        return; // never respond — client-side timeout should fire
      }
      if (MODE === 'error_tool') {
        respond(id, { content: [{ type: 'text', text: 'simulated tool failure' }], isError: true });
        return;
      }
      respond(id, { content: [{ type: 'text', text: JSON.stringify(args ?? {}) }] });
      return;
    }

    default:
      respondError(id, -32601, `Method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const request = JSON.parse(line);
    void handle(request);
  } catch {
    // Ignore malformed input, same as project-server.ts.
  }
});

process.stderr.write(`[mock-mcp-server] started in mode=${MODE}\n`);
