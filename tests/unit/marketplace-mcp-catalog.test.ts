import { describe, it, expect } from 'vitest';
import path from 'path';
import { loadMcpCatalog, readPack } from '../../src/marketplace/loader';
import type { PackSource } from '../../src/marketplace/types';
import { mcpCatalogForPack, allMcpCatalogs } from '../../src/marketplace/registry';

const SEED_ROOT = path.join(__dirname, '..', '..', 'src', 'marketplace', 'seed');

describe('loadMcpCatalog', () => {
  it('parses the atelier mcp catalog (7 entries)', () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'atelier', 'mcp-configs'));
    expect(entries).toHaveLength(7);
    const figmaRemote = entries.find((e) => e.id === 'figma-remote');
    expect(figmaRemote?.kind).toBe('url');
    expect(figmaRemote?.url).toBe('https://mcp.figma.com/mcp');
    const notion = entries.find((e) => e.id === 'notion');
    expect(notion?.kind).toBe('stdio');
    expect(notion?.command).toBe('npx');
    expect(notion?.env).toHaveProperty('OPENAPI_MCP_HEADERS');
    const electronMcp = entries.find((e) => e.id === 'electron-mcp-server');
    expect(electronMcp?.kind).toBe('stdio');
    expect(electronMcp?.command).toBe('npx');
    expect(electronMcp?.args).toEqual(['-y', 'electron-mcp-server']);
    expect(electronMcp?.env).toEqual({ SECURITY_LEVEL: 'balanced' });
  });

  it('parses the salon mcp catalog (14 entries), flagging risk notes', () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'salon', 'mcp-configs'));
    expect(entries).toHaveLength(14);
    const linkedin = entries.find((e) => e.id === 'linkedin-unofficial');
    expect(linkedin?.riskNote).toBeTruthy();
    expect(linkedin?.riskNote).toMatch(/RISK-FLAGGED/);
    const buffer = entries.find((e) => e.id === 'buffer');
    expect(buffer?.kind).toBe('url');
    expect(buffer?.headers).toHaveProperty('Authorization');
  });

  it("parses x-api's reauth command (the \"Reauthenticate\" Settings button's data source)", () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'salon', 'mcp-configs'));
    const xApi = entries.find((e) => e.id === 'x-api');
    expect(xApi?.reauth).toEqual({
      command: 'npx',
      args: ['-y', '@xdevplatform/xurl', 'auth', 'clear', '--all'],
    });
    // No other salon entry declares a reauth command yet.
    expect(entries.filter((e) => e.reauth).map((e) => e.id)).toEqual(['x-api']);
  });

  it("parses x-api-bearer as an independent url entry (isolated from x-api's own required env)", () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'salon', 'mcp-configs'));
    const bearer = entries.find((e) => e.id === 'x-api-bearer');
    expect(bearer?.kind).toBe('url');
    expect(bearer?.url).toBe('https://api.x.com/mcp');
    expect(bearer?.headers).toEqual({ Authorization: 'Bearer ${X_BEARER_TOKEN}' });
    // Distinct required env from x-api's CLIENT_ID/CLIENT_SECRET — the two
    // entries' configured/enabled status never affect each other.
    const xApi = entries.find((e) => e.id === 'x-api');
    expect(xApi?.env).toEqual({
      CLIENT_ID: '${X_CLIENT_ID}',
      CLIENT_SECRET: '${X_CLIENT_SECRET}',
    });
  });

  it('returns [] for a pack with no mcp-configs dir', () => {
    expect(loadMcpCatalog(path.join(SEED_ROOT, 'nonexistent-pack', 'mcp-configs'))).toEqual([]);
  });

  it('readPack wires mcpCatalog onto LoadedPack', () => {
    const atelier: PackSource = {
      id: 'atelier',
      name: 'Atelier',
      lanes: ['design', 'product', 'brand'],
      repo: 'lama-assaf/atelier',
      branch: 'main',
    };
    const loaded = readPack(atelier);
    expect(loaded.mcpCatalog).toHaveLength(7);
  });
});

describe('registry mcp catalog accessors', () => {
  it('mcpCatalogForPack returns entries scoped to one pack', () => {
    expect(mcpCatalogForPack('atelier')).toHaveLength(7);
    expect(mcpCatalogForPack('salon')).toHaveLength(14);
    expect(mcpCatalogForPack('nonexistent')).toEqual([]);
  });

  it('allMcpCatalogs tags every entry with its source pack id', () => {
    const all = allMcpCatalogs();
    expect(all.length).toBe(21);
    expect(all.filter((e) => e.packId === 'atelier')).toHaveLength(7);
    expect(all.filter((e) => e.packId === 'salon')).toHaveLength(14);
  });
});
