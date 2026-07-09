import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getSeedRoot, getPluginsRoot, setPluginsRoot } from '../../src/marketplace/paths';

describe('marketplace paths', () => {
  it('seed root contains atelier and salon plugin.json', () => {
    const seed = getSeedRoot();
    expect(fs.existsSync(path.join(seed, 'atelier', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(seed, 'salon', 'plugin.json'))).toBe(true);
  });
  it('getPluginsRoot honors PACK_ROOT_OVERRIDE without importing electron', () => {
    process.env.PACK_ROOT_OVERRIDE = '/tmp/fixture-plugins';
    expect(getPluginsRoot()).toBe('/tmp/fixture-plugins');
    delete process.env.PACK_ROOT_OVERRIDE;
  });
  it('falls back to setPluginsRoot value, then to seed', () => {
    setPluginsRoot('/tmp/injected-plugins');
    expect(getPluginsRoot()).toBe('/tmp/injected-plugins');
    setPluginsRoot(''); // clear injection (empty string is falsy) → falls through to seed root
    expect(getPluginsRoot()).toBe(getSeedRoot());
  });
});
