import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { installSeed } from '../../src/marketplace/sync';

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
