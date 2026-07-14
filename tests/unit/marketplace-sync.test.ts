import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installSeed, needsPackUpdate, EXTRACTOR_VERSION } from '../../src/marketplace/sync';

describe('installSeed', () => {
  let seed: string;
  let plugins: string;
  beforeEach(() => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mkt-'));
    seed = path.join(base, 'seed');
    plugins = path.join(base, 'plugins');
    fs.mkdirSync(path.join(seed, 'atelier'), { recursive: true });
    fs.writeFileSync(path.join(seed, 'atelier', 'plugin.json'), '{"name":"atelier"}');
    fs.writeFileSync(path.join(seed, 'atelier', 'VERSION'), '0.1.0');
  });
  it('copies the seed into an empty plugins dir', () => {
    const copied = installSeed(seed, plugins, 'atelier');
    expect(copied).toBe(true);
    expect(fs.existsSync(path.join(plugins, 'atelier', 'plugin.json'))).toBe(true);
  });
  it('does not overwrite an already-installed pack', () => {
    fs.mkdirSync(path.join(plugins, 'atelier'), { recursive: true });
    fs.writeFileSync(path.join(plugins, 'atelier', 'VERSION'), '9.9.9');
    installSeed(seed, plugins, 'atelier');
    expect(fs.readFileSync(path.join(plugins, 'atelier', 'VERSION'), 'utf-8')).toBe('9.9.9');
  });
});

describe('needsPackUpdate', () => {
  it('forces an update when the local extractor version is behind current, even at a matching sha', () => {
    // Reproduces the real bug: a pack extracted before the mcp-configs filter
    // shipped has a matching sha (upstream hasn't changed) but is missing the
    // mcp-configs bucket. A plain sha-equality check would wrongly skip it.
    expect(needsPackUpdate('same-sha', 'same-sha', 0)).toBe(true);
  });

  it('does not force an update once the local copy matches both the sha and the current extractor version', () => {
    expect(needsPackUpdate('same-sha', 'same-sha', EXTRACTOR_VERSION)).toBe(false);
  });

  it('still updates on a plain sha mismatch, independent of extractor version', () => {
    expect(needsPackUpdate('old-sha', 'new-sha', EXTRACTOR_VERSION)).toBe(true);
  });
});