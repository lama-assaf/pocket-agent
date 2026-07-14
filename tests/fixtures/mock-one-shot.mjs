#!/usr/bin/env node
/**
 * Mock one-shot CLI process for tests/unit/mcp-one-shot.test.ts. Behavior
 * selected via the ONE_SHOT_MODE env var, mirroring
 * tests/fixtures/mock-mcp-server.mjs's mode-switch pattern.
 *
 * Modes:
 *   success        - writes a stderr line, then exits 0.
 *   fail           - writes a stderr line, then exits 1.
 *   hang           - writes a stderr line, then never exits (tests the
 *                    caller's timeout + SIGTERM/SIGKILL escalation).
 *   ignore_sigterm - like hang, but also ignores SIGTERM (only SIGKILL ends it).
 */
const MODE = process.env.ONE_SHOT_MODE || 'success';

if (MODE === 'ignore_sigterm') {
  process.on('SIGTERM', () => {
    /* deliberately ignored */
  });
}

process.stderr.write(`[mock-one-shot] running in mode=${MODE}\n`);

if (MODE === 'fail') {
  process.exit(1);
} else if (MODE === 'hang' || MODE === 'ignore_sigterm') {
  setInterval(() => {}, 1000);
} else {
  process.exit(0);
}
