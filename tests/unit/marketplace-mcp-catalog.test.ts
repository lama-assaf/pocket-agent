import { describe, it, expect } from 'vitest';
import path from 'path';
import { loadMcpCatalog, readPack } from '../../src/marketplace/loader';
import type { PackSource } from '../../src/marketplace/types';
import { mcpCatalogForPack, allMcpCatalogs } from '../../src/marketplace/registry';

const SEED_ROOT = path.join(__dirname, '..', '..', 'src', 'marketplace', 'seed');

describe('loadMcpCatalog', () => {
  it('parses the atelier mcp catalog (6 entries)', () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'atelier', 'mcp-configs'));
    expect(entries).toHaveLength(6);
    const figmaRemote = entries.find((e) => e.id === 'figma-remote');
    expect(figmaRemote?.kind).toBe('url');
    expect(figmaRemote?.url).toBe('https://mcp.figma.com/mcp');
    const notion = entries.find((e) => e.id === 'notion');
    expect(notion?.kind).toBe('stdio');
    expect(notion?.command).toBe('npx');
    expect(notion?.env).toHaveProperty('OPENAPI_MCP_HEADERS');
  });

  it('parses the salon mcp catalog (13 entries), flagging risk notes', () => {
    const entries = loadMcpCatalog(path.join(SEED_ROOT, 'salon', 'mcp-configs'));
    expect(entries).toHaveLength(13);
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
    expect(loaded.mcpCatalog).toHaveLength(6);
  });
});

describe('registry mcp catalog accessors', () => {
  it('mcpCatalogForPack returns entries scoped to one pack', () => {
    expect(mcpCatalogForPack('atelier')).toHaveLength(6);
    expect(mcpCatalogForPack('salon')).toHaveLength(13);
    expect(mcpCatalogForPack('nonexistent')).toEqual([]);
  });

  it('allMcpCatalogs tags every entry with its source pack id', () => {
    const all = allMcpCatalogs();
    expect(all.length).toBe(19);
    expect(all.filter((e) => e.packId === 'atelier')).toHaveLength(6);
    expect(all.filter((e) => e.packId === 'salon')).toHaveLength(13);
  });
});
