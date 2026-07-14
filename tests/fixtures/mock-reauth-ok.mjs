#!/usr/bin/env node
// Mock "reauth clear" one-shot command that succeeds — for
// tests/unit/mcp-manager.test.ts's reauthenticateServer tests.
process.stderr.write('[mock-reauth-ok] clearing cached token\n');
process.exit(0);
