/**
 * Run a single external command to completion and report exactly how it
 * went — used for MCP server side-band maintenance actions that are NOT the
 * long-lived MCP protocol connection itself (src/mcp/client.ts owns that).
 * The first (and so far only) consumer is the "Reauthenticate" action
 * (src/mcp/manager.ts's reauthenticateServer): clearing an OAuth-caching
 * CLI's cached token (e.g. `xurl auth clear --all`) is a one-shot process
 * that exits on its own — it has no JSON-RPC handshake, no persistent
 * stdio protocol, so StdioMcpClient doesn't apply here.
 *
 * Same diagnostic philosophy as client.ts's stderr-tail-on-timeout/crash
 * fix: never resolve with a bare "it failed" — always carry enough of the
 * process's own stderr for the caller to show an actionable reason (a port
 * conflict, a missing binary, a permission error, etc.) instead of a dead
 * end.
 */

import { spawn } from 'child_process';

export interface OneShotResult {
  /** True only when the process exited with code 0 within the timeout. */
  success: boolean;
  /** Exit code, or null if it never exited (timed out) or exited via signal. */
  code: number | null;
  /** Signal that ended it, if any (e.g. after our own timeout-triggered kill). */
  signal: string | null;
  /** True if we killed it ourselves after `timeoutMs` elapsed. */
  timedOut: boolean;
  /** Last ~500 chars of combined stderr — the same tail size client.ts uses. */
  stderrTail: string;
  /** Set only when the process could never be spawned at all (e.g. ENOENT). */
  spawnError?: string;
}

/**
 * Spawn `command args` with `env` merged onto the current process env, wait
 * for it to exit (or forcibly kill it after `timeoutMs`), and resolve with
 * the outcome. Never rejects — every failure mode (spawn error, non-zero
 * exit, timeout) is represented in the resolved `OneShotResult` so callers
 * never need a try/catch around this.
 */
export function runOneShotCommand(
  command: string,
  args: string[],
  env: Record<string, string> = {},
  timeoutMs = 10_000
): Promise<OneShotResult> {
  return new Promise((resolve) => {
    let stderrTail = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
        // Escalate to SIGKILL shortly after, same as client.ts's close() —
        // a one-shot CLI that ignores SIGTERM should not linger indefinitely.
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // Already gone — fine.
          }
        }, 3000).unref();
      } catch {
        // Already gone — fine.
      }
    }, timeoutMs);
    timer.unref();

    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-500);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: false,
        code: null,
        signal: null,
        timedOut: false,
        stderrTail,
        spawnError: err.message,
      });
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        success: !timedOut && code === 0,
        code,
        signal,
        timedOut,
        stderrTail,
      });
    });
  });
}
