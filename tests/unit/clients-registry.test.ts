import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  getClientsRoot,
  getWorldRoot,
  setClientsRoot,
  setWorldRoot,
  clientPaths,
  worldScopeRoot,
  clientScopeRoot,
} from '../../src/clients/paths';
import {
  ensureWorldScaffold,
  ensureClientScaffold,
  scopeRootsForSelection,
  guardrailFilesForContext,
  voiceFileForContext,
} from '../../src/clients/registry';
import type { SessionContext } from '../../src/memory/sessions';

const ctx = (over: Partial<SessionContext>): SessionContext => ({
  contextType: 'personal',
  clientId: null,
  projectKey: null,
  ...over,
});

describe('clients paths', () => {
  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
  });

  it('honors env overrides without importing electron', () => {
    process.env.CLIENTS_ROOT_OVERRIDE = '/tmp/fixture-clients';
    process.env.WORLD_ROOT_OVERRIDE = '/tmp/fixture-world';
    expect(getClientsRoot()).toBe('/tmp/fixture-clients');
    expect(getWorldRoot()).toBe('/tmp/fixture-world');
  });

  it('falls back to injected roots', () => {
    setClientsRoot('/tmp/injected-clients');
    setWorldRoot('/tmp/injected-world');
    expect(getClientsRoot()).toBe('/tmp/injected-clients');
    expect(getWorldRoot()).toBe('/tmp/injected-world');
  });

  it('derives client memory + guardrails paths under the clients root', () => {
    process.env.CLIENTS_ROOT_OVERRIDE = '/tmp/c';
    const p = clientPaths('acme');
    expect(p.rootDir).toBe(path.join('/tmp/c', 'acme'));
    expect(p.memoryDir).toBe(path.join('/tmp/c', 'acme', '.atelier', 'memory'));
    expect(p.guardrailsDir).toBe(path.join('/tmp/c', 'acme', 'guardrails'));
  });
});

describe('clients registry', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clients-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
  });

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('scaffolds world + client memory/guardrails dirs', () => {
    ensureWorldScaffold();
    ensureClientScaffold('acme');
    expect(fs.existsSync(worldScopeRoot().memoryDir)).toBe(true);
    expect(fs.existsSync(clientScopeRoot('acme').memoryDir)).toBe(true);
    expect(fs.existsSync(clientPaths('acme').guardrailsDir)).toBe(true);
  });

  it('scopeRootsForSelection: personal touches no on-disk roots', () => {
    expect(scopeRootsForSelection(ctx({ contextType: 'personal' }))).toEqual([]);
  });

  it('scopeRootsForSelection: world → world root only', () => {
    const roots = scopeRootsForSelection(ctx({ contextType: 'world' }));
    expect(roots.map((r) => r.scope)).toEqual(['world']);
  });

  it('scopeRootsForSelection: client → world (base) then client', () => {
    const roots = scopeRootsForSelection(ctx({ contextType: 'client', clientId: 'acme' }));
    expect(roots.map((r) => r.scope)).toEqual(['world', 'client:acme']);
  });

  it('scopeRootsForSelection: project appends the resolved project root nearest-last', () => {
    const projectRoot = {
      scope: 'project:site',
      rootDir: '/tmp/site',
      memoryDir: '/tmp/site/.atelier/memory',
    };
    const roots = scopeRootsForSelection(
      ctx({ contextType: 'project', clientId: 'acme', projectKey: 'site' }),
      projectRoot
    );
    expect(roots.map((r) => r.scope)).toEqual(['world', 'client:acme', 'project:site']);
  });

  it('guardrail + voice files follow the active client, and personal has none', () => {
    expect(guardrailFilesForContext(ctx({ contextType: 'personal' }))).toEqual([]);
    expect(voiceFileForContext(ctx({ contextType: 'personal' }))).toBeNull();

    const clientCtx = ctx({ contextType: 'client', clientId: 'acme' });
    const guardrails = guardrailFilesForContext(clientCtx);
    expect(guardrails.some((f) => f.includes(path.join('world', 'guardrails')))).toBe(true);
    expect(guardrails.some((f) => f.includes(path.join('acme', 'guardrails')))).toBe(true);
    expect(voiceFileForContext(clientCtx)).toContain(
      path.join('acme', '.atelier', 'memory', 'voice.md')
    );
  });
});
