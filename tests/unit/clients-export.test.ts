/**
 * Publish loop: facts → on-disk brain files.
 *
 * Guarantees:
 *  1. buildScopeFiles buckets facts by category/subject into the right files.
 *  2. The mirror category ('atelier-memory') is never re-exported.
 *  3. Output is deterministic (stable ordering → clean git diffs).
 *  4. exportScopeToDisk writes to the exact paths the injection layer reads
 *     (voice.md / guardrails/banned-words.md), so a Publish round-trips.
 *  5. rootDirForScope maps scopes to repos (projects share no standalone brain).
 *  6. Scoped agent/MCP enablement (Phase 4) exports to enabled-agents.md /
 *     enabled-mcp.md, so a brand's selection round-trips through git sync
 *     like voice/lessons do.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildScopeFiles,
  exportScopeToDisk,
  rootDirForScope,
  type ExportableFact,
} from '../../src/clients/export';
import { clientPaths, getWorldRoot } from '../../src/clients/paths';
import { voiceFileForContext, guardrailFilesForContext } from '../../src/clients/registry';

const fact = (over: Partial<ExportableFact>): ExportableFact => ({
  category: 'fact',
  subject: '',
  content: '',
  scope: 'client:acme',
  ...over,
});

describe('buildScopeFiles', () => {
  it('buckets voice/lessons/knowledge/banned into the right files', () => {
    const files = buildScopeFiles([
      fact({ category: 'how_to_act', subject: 'voice', content: 'Warm and concrete' }),
      fact({ category: 'how_to_act', subject: 'banned_words', content: 'leverage, synergy' }),
      fact({ category: 'lesson', subject: '', content: 'Short subject lines win' }),
      fact({ category: 'audience', subject: 'primary', content: 'Busy founders' }),
    ]);
    expect(files['.atelier/memory/voice.md']).toContain('Warm and concrete');
    expect(files['guardrails/banned-words.md']).toContain('- leverage');
    expect(files['guardrails/banned-words.md']).toContain('- synergy');
    expect(files['.atelier/memory/lessons.md']).toContain('Short subject lines win');
    expect(files['.atelier/memory/facts.md']).toContain('**primary**: Busy founders');
  });

  it('never re-exports the mirror category (atelier-memory)', () => {
    const files = buildScopeFiles([
      fact({ category: 'atelier-memory', subject: 'voice.md', content: 'pulled content' }),
    ]);
    expect(Object.keys(files)).toHaveLength(0);
  });

  it('is deterministic — same facts in any order produce identical files', () => {
    const a = [
      fact({ category: 'lesson', content: 'Beta lesson' }),
      fact({ category: 'lesson', content: 'Alpha lesson' }),
    ];
    const one = buildScopeFiles(a);
    const two = buildScopeFiles([...a].reverse());
    expect(one['.atelier/memory/lessons.md']).toBe(two['.atelier/memory/lessons.md']);
    // Alpha sorts before Beta regardless of input order.
    const body = one['.atelier/memory/lessons.md'];
    expect(body.indexOf('Alpha')).toBeLessThan(body.indexOf('Beta'));
  });

  it('dedupes banned words', () => {
    const files = buildScopeFiles([
      fact({ category: 'how_to_act', subject: 'banned_words', content: 'delve, delve, unlock' }),
    ]);
    const lines = files['guardrails/banned-words.md'].split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toEqual(['- delve', '- unlock']);
  });

  it('buckets enabled-agents facts into enabled-agents.md, rendering true/false as enabled/disabled', () => {
    const files = buildScopeFiles([
      fact({ category: 'enabled-agents', subject: 'atelier:design-reviewer', content: 'false' }),
      fact({ category: 'enabled-agents', subject: 'atelier:copywriter', content: 'true' }),
    ]);
    const body = files['.atelier/memory/enabled-agents.md'];
    expect(body).toContain('**atelier:copywriter**: enabled');
    expect(body).toContain('**atelier:design-reviewer**: disabled');
    // Never leaks into the generic knowledge bucket.
    expect(files['.atelier/memory/facts.md']).toBeUndefined();
  });

  it('buckets enabled-mcp facts into enabled-mcp.md', () => {
    const files = buildScopeFiles([
      fact({ category: 'enabled-mcp', subject: 'atelier:notion', content: 'false' }),
    ]);
    expect(files['.atelier/memory/enabled-mcp.md']).toContain('**atelier:notion**: disabled');
  });

  it('omits both enablement files when there is nothing to export', () => {
    const files = buildScopeFiles([fact({ category: 'lesson', content: 'x' })]);
    expect(files['.atelier/memory/enabled-agents.md']).toBeUndefined();
    expect(files['.atelier/memory/enabled-mcp.md']).toBeUndefined();
  });
});

describe('rootDirForScope', () => {
  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
  });

  it('maps world + client scopes to their roots, and projects to null', () => {
    process.env.CLIENTS_ROOT_OVERRIDE = '/tmp/c';
    process.env.WORLD_ROOT_OVERRIDE = '/tmp/w';
    expect(rootDirForScope('world')).toBe('/tmp/w');
    expect(rootDirForScope('client:acme')).toBe(path.join('/tmp/c', 'acme'));
    expect(rootDirForScope('project:acme-site')).toBeNull();
    expect(rootDirForScope('user')).toBeNull();
  });
});

describe('exportScopeToDisk (round-trips to the injection paths)', () => {
  let tmp: string;

  afterEach(() => {
    delete process.env.CLIENTS_ROOT_OVERRIDE;
    delete process.env.WORLD_ROOT_OVERRIDE;
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("writes a client scope's facts to voice.md + guardrails the injection layer reads", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');

    const memory = {
      getAllFacts: (): ExportableFact[] => [
        fact({ category: 'how_to_act', subject: 'voice', content: 'Bold and brief' }),
        fact({ category: 'how_to_act', subject: 'banned_words', content: 'leverage' }),
        // Other-scope + mirror rows must be excluded from acme's export.
        fact({ scope: 'client:other', category: 'how_to_act', subject: 'voice', content: 'Nope' }),
        fact({
          scope: 'client:acme',
          category: 'atelier-memory',
          subject: 'x.md',
          content: 'skip',
        }),
      ],
    };

    const written = exportScopeToDisk(memory, 'client:acme');
    expect(written).toContain('.atelier/memory/voice.md');
    expect(written).toContain('guardrails/banned-words.md');

    const ctx = { contextType: 'client' as const, clientId: 'acme', projectKey: null };
    const voicePath = voiceFileForContext(ctx);
    expect(voicePath).toBeTruthy();
    expect(fs.readFileSync(voicePath as string, 'utf-8')).toContain('Bold and brief');
    // Client guardrails file is the last entry of guardrailFilesForContext.
    const guardFiles = guardrailFilesForContext(ctx);
    const clientGuard = guardFiles[guardFiles.length - 1];
    expect(fs.readFileSync(clientGuard, 'utf-8')).toContain('- leverage');
    // Nothing from the other brand leaked in.
    expect(fs.readFileSync(voicePath as string, 'utf-8')).not.toContain('Nope');
  });

  it('is a no-op for scopes without a repo (project/personal)', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');
    const memory = { getAllFacts: (): ExportableFact[] => [fact({ scope: 'project:acme-site' })] };
    expect(exportScopeToDisk(memory, 'project:acme-site')).toEqual([]);
    expect(exportScopeToDisk(memory, 'user')).toEqual([]);
  });

  it('writes world scope facts under the world root', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    process.env.WORLD_ROOT_OVERRIDE = path.join(tmp, 'world');
    const memory = {
      getAllFacts: (): ExportableFact[] => [
        fact({ scope: 'world', category: 'lesson', content: 'Agency-wide lesson' }),
      ],
    };
    const written = exportScopeToDisk(memory, 'world');
    expect(written).toContain('.atelier/memory/lessons.md');
    const lessonsPath = path.join(getWorldRoot(), '.atelier', 'memory', 'lessons.md');
    expect(fs.readFileSync(lessonsPath, 'utf-8')).toContain('Agency-wide lesson');
  });

  it("writes a client's disabled agents/MCP servers to enabled-agents.md / enabled-mcp.md", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'export-'));
    process.env.CLIENTS_ROOT_OVERRIDE = path.join(tmp, 'clients');

    const memory = {
      getAllFacts: (): ExportableFact[] => [
        fact({ category: 'enabled-agents', subject: 'atelier:design-reviewer', content: 'false' }),
        fact({ category: 'enabled-mcp', subject: 'atelier:notion', content: 'false' }),
        // Other-scope rows must be excluded from acme's export.
        fact({ scope: 'client:other', category: 'enabled-agents', subject: 'atelier:copywriter', content: 'false' }),
      ],
    };

    const written = exportScopeToDisk(memory, 'client:acme');
    expect(written).toContain('.atelier/memory/enabled-agents.md');
    expect(written).toContain('.atelier/memory/enabled-mcp.md');

    const p = clientPaths('acme');
    const agentsFile = path.join(p.memoryDir, 'enabled-agents.md');
    const mcpFile = path.join(p.memoryDir, 'enabled-mcp.md');
    expect(fs.readFileSync(agentsFile, 'utf-8')).toContain('atelier:design-reviewer');
    expect(fs.readFileSync(agentsFile, 'utf-8')).not.toContain('copywriter');
    expect(fs.readFileSync(mcpFile, 'utf-8')).toContain('atelier:notion');
  });
});
