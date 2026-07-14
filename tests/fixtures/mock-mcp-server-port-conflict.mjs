#!/usr/bin/env node
// Mock MCP server that exits immediately, mimicking xurl's real stderr
// output when its fixed OAuth callback port is already occupied — for
// tests/unit/mcp-manager.test.ts's reauthenticateServer classification tests
// (a genuine, actionable failure distinct from "still waiting on consent").
process.stderr.write(
  'Error: authentication failed: Auth Error: ListenerError (cause: Auth Error: ServerError ' +
    '(cause: listen tcp 127.0.0.1:8080: bind: address already in use))\n'
);
process.exit(1);
