/**
 * Tests for runOneShotCommand (src/mcp/one-shot.ts) — the "run this external
 * CLI to completion and tell me exactly how it went" primitive that
 * McpServerManager.reauthenticateServer uses to clear a cached OAuth token
 * (e.g. `xurl auth clear --all`). Uses a real child process
 * (tests/fixtures/mock-one-shot.mjs), same integration-style approach as
 * tests/unit/mcp-client.test.ts.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOneShotCommand } from '../../src/mcp/one-shot';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '../fixtures/mock-one-shot.mjs');

function run(mode: string, timeoutMs = 5000) {
  return runOneShotCommand(process.execPath, [FIXTURE], { ONE_SHOT_MODE: mode }, timeoutMs);
}

describe('runOneShotCommand', () => {
  it('resolves success: true for a process that exits 0', async () => {
    const result = await run('success');
    expect(result.success).toBe(true);
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('resolves success: false with the exit code for a process that exits non-zero', async () => {
    const result = await run('fail');
    expect(result.success).toBe(false);
    expect(result.code).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it('captures the stderr tail regardless of outcome', async () => {
    const result = await run('fail');
    expect(result.stderrTail).toContain('mode=fail');
  });

  it('never rejects — resolves spawnError for a command that cannot be spawned at all', async () => {
    const result = await runOneShotCommand('this-binary-does-not-exist-xyz', [], {}, 3000);
    expect(result.success).toBe(false);
    expect(result.spawnError).toBeTruthy();
  });

  it('kills a hung process after the timeout and reports timedOut: true', async () => {
    const result = await run('hang', 500);
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 10000);

  it('escalates to SIGKILL for a process that ignores SIGTERM, and still resolves (does not hang the caller)', async () => {
    const result = await run('ignore_sigterm', 500);
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 10000);
});
