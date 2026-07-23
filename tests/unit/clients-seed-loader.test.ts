/**
 * src/clients/seed-loader.ts: loads + schema-validates bundled client-seed
 * JSON so ops can add/change default pre-filled clients without a code
 * change. Fail-safe by design — a malformed file or missing seed dir must
 * never throw past loadClientSeeds(), only log + skip.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadClientSeeds,
  parseClientSeed,
  getClientSeedRoot,
  setClientSeedRoot,
} from '../../src/clients/seed-loader';

function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-loader-test-'));
}

const VALID_ZILLIQA = {
  id: 'zilliqa',
  name: 'Zilliqa',
  sync_mode: 'manual',
  facts: [
    { subject: 'voice', content: 'Understated and evidence-first.' },
    { subject: 'tone', content: 'Confident but restrained.' },
    { subject: 'instincts', content: 'Never overclaim.' },
    { subject: 'banned_words', content: 'revolutionary, game-changing' },
  ],
  lessons: [{ subject: 'test lesson', content: 'Keep it grounded.' }],
  agents: [{ packId: 'atelier', agentName: 'copywriter' }],
};

const VALID_LTIN = {
  id: 'ltin',
  name: 'LTIN',
  sync_mode: 'manual',
  facts: [
    { subject: 'voice', content: 'Sober and structural.' },
    { subject: 'tone', content: 'Formal, standards-first.' },
    { subject: 'instincts', content: 'Proof discipline above all.' },
    { subject: 'banned_words', content: 'disrupt, 10x' },
  ],
  lessons: [{ subject: 'test lesson', content: 'Use the newest material.' }],
  agents: [{ packId: 'atelier', agentName: 'copywriter' }],
};

describe('getClientSeedRoot', () => {
  afterEach(() => setClientSeedRoot(null));

  it('resolves to src/clients/seeds in dev (no packaged resourcesPath)', () => {
    const root = getClientSeedRoot();
    expect(root.endsWith(path.join('src', 'clients', 'seeds'))).toBe(true);
  });

  it('honors a test override', () => {
    setClientSeedRoot('/tmp/fixture-seeds');
    expect(getClientSeedRoot()).toBe('/tmp/fixture-seeds');
  });
});

describe('parseClientSeed', () => {
  it('parses a valid seed and translates snake_case to camelCase', () => {
    const seed = parseClientSeed(JSON.stringify(VALID_ZILLIQA));
    expect(seed.id).toBe('zilliqa');
    expect(seed.syncMode).toBe('manual');
    expect(seed.facts).toHaveLength(4);
  });

  it('threads repo_url through as repoUrl', () => {
    const seed = parseClientSeed(
      JSON.stringify({ ...VALID_ZILLIQA, sync_mode: 'live', repo_url: 'https://github.com/acme/brain.git' })
    );
    expect(seed.repoUrl).toBe('https://github.com/acme/brain.git');
    expect(seed.syncMode).toBe('live');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseClientSeed('{not json')).toThrow();
  });

  it('rejects a missing required field (name)', () => {
    const { name, ...rest } = VALID_ZILLIQA;
    void name;
    expect(() => parseClientSeed(JSON.stringify(rest))).toThrow();
  });

  it('rejects an invalid sync_mode', () => {
    expect(() => parseClientSeed(JSON.stringify({ ...VALID_ZILLIQA, sync_mode: 'automatic' }))).toThrow();
  });

  it('rejects a fact with an unknown subject', () => {
    const bad = { ...VALID_ZILLIQA, facts: [{ subject: 'opinions', content: 'x' }] };
    expect(() => parseClientSeed(JSON.stringify(bad))).toThrow();
  });

  it('rejects a fact with empty content', () => {
    const bad = { ...VALID_ZILLIQA, facts: [{ subject: 'voice', content: '   ' }] };
    expect(() => parseClientSeed(JSON.stringify(bad))).toThrow();
  });

  it('rejects an id that is not a lowercase slug', () => {
    expect(() => parseClientSeed(JSON.stringify({ ...VALID_ZILLIQA, id: 'Zilliqa Inc' }))).toThrow();
  });
});

describe('loadClientSeeds', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads both clients from a directory of valid seed files', () => {
    dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'zilliqa.json'), JSON.stringify(VALID_ZILLIQA));
    fs.writeFileSync(path.join(dir, 'ltin.json'), JSON.stringify(VALID_LTIN));

    const seeds = loadClientSeeds(dir);
    expect(seeds.map((s) => s.id).sort()).toEqual(['ltin', 'zilliqa']);
  });

  it('fails safe on a malformed file: skips it, still loads the valid ones', () => {
    dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'zilliqa.json'), JSON.stringify(VALID_ZILLIQA));
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ this is not valid json');

    const seeds = loadClientSeeds(dir);
    expect(seeds.map((s) => s.id)).toEqual(['zilliqa']);
  });

  it('fails safe on a file that is valid JSON but fails schema validation', () => {
    dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'zilliqa.json'), JSON.stringify(VALID_ZILLIQA));
    fs.writeFileSync(
      path.join(dir, 'invalid-schema.json'),
      JSON.stringify({ id: 'nope', name: '', facts: [], lessons: [], agents: [] })
    );

    const seeds = loadClientSeeds(dir);
    expect(seeds.map((s) => s.id)).toEqual(['zilliqa']);
  });

  it('never throws when the seed dir does not exist', () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    expect(() => loadClientSeeds(missing)).not.toThrow();
    expect(loadClientSeeds(missing)).toEqual([]);
  });

  it('skips a duplicate id, keeping the first file (by filename order)', () => {
    dir = mkTmpDir();
    fs.writeFileSync(path.join(dir, 'a-zilliqa.json'), JSON.stringify(VALID_ZILLIQA));
    fs.writeFileSync(
      path.join(dir, 'b-zilliqa-dup.json'),
      JSON.stringify({ ...VALID_ZILLIQA, name: 'Zilliqa Duplicate' })
    );

    const seeds = loadClientSeeds(dir);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]?.name).toBe('Zilliqa');
  });

  it('is a real fixture check: the bundled src/clients/seeds dir loads zilliqa + ltin', () => {
    const seeds = loadClientSeeds();
    expect(seeds.map((s) => s.id).sort()).toEqual(['ltin', 'zilliqa']);
  });

  it("the bundled ltin.json carries its live repo_url (LTIN-comms-brain), validated + camelCased by the loader", () => {
    const seeds = loadClientSeeds();
    const ltin = seeds.find((s) => s.id === 'ltin');
    expect(ltin?.repoUrl).toBe('https://github.com/r3toAI/LTIN-comms-brain');
    expect(ltin?.syncMode).toBe('live');
  });

  it("the bundled zilliqa.json carries its live repo_url (Zilliqa-comms-brain), validated + camelCased by the loader", () => {
    const seeds = loadClientSeeds();
    const zilliqa = seeds.find((s) => s.id === 'zilliqa');
    expect(zilliqa?.repoUrl).toBe('https://github.com/r3toAI/Zilliqa-comms-brain');
    expect(zilliqa?.syncMode).toBe('live');
  });
});
