#!/usr/bin/env node
// Mock MCP server that exits immediately, mimicking xurl's real stderr
// output when it has no cached token and is about to open the browser for
// OAuth consent — for tests/unit/mcp-manager.test.ts's reauthenticateServer
// classification tests (a "still waiting on the user" state, not a failure).
process.stderr.write(
  '[xurl mcp] no valid OAuth2 token; opening the browser to sign in -- complete the login to start the bridge...\n'
);
process.exit(1);
