/**
 * File-backed console mirror for tester bug reports.
 *
 * A packaged app has no visible terminal, so `console.log`/`console.error`
 * calls throughout main-process code (there are hundreds) otherwise vanish
 * into nothing a tester can hand back to us. This module patches the global
 * console methods, once, to also append every line to a day-sharded log file
 * — same rotation-by-deletion approach as utils/audit-log.ts, chosen for the
 * same reason (no extra dependency, no risk to the primary SQLite DB, cheap
 * retention). It never replaces the original console behavior, so `npm run
 * dev`'s terminal output is unaffected; it only adds a durable copy.
 *
 * Like audit-log.ts, this stays Electron-free (no `app.getPath` import) so
 * unit tests never need a mock — call `initAppFileLogging()` exactly once
 * from the Electron main process with `app.getPath('logs')`.
 */

import fs from 'fs';
import path from 'path';

let logRoot: string | null = null;
let patched = false;

function todayFileName(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `main-${y}-${m}-${d}.log`;
}

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function appendLine(level: string, args: unknown[]): void {
  if (!logRoot) return;
  try {
    fs.mkdirSync(logRoot, { recursive: true });
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(stringifyArg).join(' ')}\n`;
    fs.appendFileSync(path.join(logRoot, todayFileName()), line, 'utf-8');
  } catch {
    // Logging must never crash the app it's observing.
  }
}

/**
 * Point file logging at `dir` (e.g. `app.getPath('logs')`) and patch console
 * methods so every log line is also durably written there. Safe to call
 * more than once — only the first call patches console; later calls just
 * update where lines land.
 */
export function initAppFileLogging(dir: string): void {
  logRoot = dir;
  if (patched) return;
  patched = true;

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    appendLine('INFO', args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    appendLine('INFO', args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    appendLine('WARN', args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    appendLine('ERROR', args);
  };

  process.on('uncaughtException', (err) => {
    appendLine('FATAL', ['Uncaught exception:', err]);
  });
  process.on('unhandledRejection', (reason) => {
    appendLine('FATAL', ['Unhandled rejection:', reason]);
  });
}

/** Current log directory, or null if `initAppFileLogging` hasn't run yet. */
export function getAppLogRoot(): string | null {
  return logRoot;
}
