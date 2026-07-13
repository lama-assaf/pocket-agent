/**
 * Roadmap item 8: write-audit log core module.
 *
 * Covers: entry shape/fields, digest never contains raw content, no-op when
 * unconfigured, malformed-line tolerance, and "survives across sessions" —
 * simulated by re-importing/re-resolving the root fresh (the module keeps no
 * in-memory entry cache, so a fresh reader pointed at the same directory sees
 * every prior entry purely from disk).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  setAuditLogRoot,
  getAuditLogRoot,
  appendAuditLog,
  getRecentAuditLogEntries,
  digestContent,
} from '../../src/utils/audit-log';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-audit-test-'));
  setAuditLogRoot(tmpDir);
});

afterEach(() => {
  setAuditLogRoot(''); // reset override between tests (falsy → unconfigured)
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('digestContent', () => {
  it('never contains the raw content', () => {
    const secret = 'super-secret-api-key-do-not-log-me-1234567890';
    const digest = digestContent(secret);
    expect(digest).not.toContain(secret);
  });

  it('is deterministic for the same content', () => {
    expect(digestContent('hello world')).toBe(digestContent('hello world'));
  });

  it('differs for different content', () => {
    expect(digestContent('hello')).not.toBe(digestContent('world'));
  });

  it('includes a byte length component', () => {
    expect(digestContent('abc')).toContain('3b');
  });
});

describe('appendAuditLog / getRecentAuditLogEntries', () => {
  it('is a no-op (no throw, empty read) when unconfigured', () => {
    setAuditLogRoot(''); // falsy → getAuditLogRoot() returns null
    expect(getAuditLogRoot()).toBeNull();
    expect(() =>
      appendAuditLog({
        sessionId: 's1',
        scope: 'user',
        tool: 'write',
        target: '/tmp/x.md',
        digest: digestContent('x'),
      })
    ).not.toThrow();
    expect(getRecentAuditLogEntries(10)).toEqual([]);
  });

  it('records an entry with the correct fields', () => {
    appendAuditLog({
      sessionId: 'session-abc',
      scope: 'client:acme',
      tool: 'write',
      target: '/workspace/notes.md',
      digest: digestContent('hello world'),
    });

    const entries = getRecentAuditLogEntries(10);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.sessionId).toBe('session-abc');
    expect(entry.scope).toBe('client:acme');
    expect(entry.tool).toBe('write');
    expect(entry.target).toBe('/workspace/notes.md');
    expect(entry.digest).toBe(digestContent('hello world'));
    expect(typeof entry.ts).toBe('string');
    expect(new Date(entry.ts).toString()).not.toBe('Invalid Date');
  });

  it('returns entries newest first', () => {
    appendAuditLog({ sessionId: 's', scope: 'user', tool: 'write', target: 'a', digest: 'd1' });
    appendAuditLog({ sessionId: 's', scope: 'user', tool: 'write', target: 'b', digest: 'd2' });
    appendAuditLog({ sessionId: 's', scope: 'user', tool: 'write', target: 'c', digest: 'd3' });

    const entries = getRecentAuditLogEntries(10);
    expect(entries.map((e) => e.target)).toEqual(['c', 'b', 'a']);
  });

  it('respects the limit', () => {
    for (let i = 0; i < 5; i++) {
      appendAuditLog({
        sessionId: 's',
        scope: 'user',
        tool: 'saveFact',
        target: `fact-${i}`,
        digest: 'd',
      });
    }
    expect(getRecentAuditLogEntries(2)).toHaveLength(2);
  });

  it('writes to a per-day JSON-lines file under the configured root', () => {
    appendAuditLog({ sessionId: 's', scope: 'user', tool: 'write', target: 'a', digest: 'd' });

    const files = fs.readdirSync(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.jsonl$/);

    const raw = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8').trim();
    const parsed = JSON.parse(raw);
    expect(parsed.target).toBe('a');
  });

  it('skips malformed lines instead of failing the whole read', () => {
    appendAuditLog({ sessionId: 's', scope: 'user', tool: 'write', target: 'good', digest: 'd' });
    const files = fs.readdirSync(tmpDir);
    const filePath = path.join(tmpDir, files[0]);
    fs.appendFileSync(filePath, 'not valid json\n');

    const entries = getRecentAuditLogEntries(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe('good');
  });

  it('returns [] when the root directory does not exist yet', () => {
    const freshDir = path.join(tmpDir, 'never-created');
    setAuditLogRoot(freshDir);
    expect(getRecentAuditLogEntries(10)).toEqual([]);
  });

  it('log survives across "sessions" — a fresh reader pointed at the same root sees prior entries', () => {
    appendAuditLog({
      sessionId: 'session-1',
      scope: 'user',
      tool: 'saveFact',
      target: 'user:notes/pref',
      digest: digestContent('likes tea'),
    });

    // Simulate the app restarting: point a "new" reader (no shared in-memory
    // state — the module keeps none) at the same on-disk root.
    setAuditLogRoot(''); // unconfigure, as if the module were freshly loaded
    expect(getRecentAuditLogEntries(10)).toEqual([]); // proves no in-memory cache

    setAuditLogRoot(tmpDir); // "next session" configures the same root again
    const entries = getRecentAuditLogEntries(10);
    expect(entries).toHaveLength(1);
    expect(entries[0].target).toBe('user:notes/pref');
    expect(entries[0].sessionId).toBe('session-1');
  });
});
