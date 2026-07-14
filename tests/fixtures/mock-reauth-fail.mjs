#!/usr/bin/env node
// Mock "reauth clear" one-shot command that fails — for
// tests/unit/mcp-manager.test.ts's reauthenticateServer tests.
process.stderr.write('simulated reauth failure: could not reach token store\n');
process.exit(1);
