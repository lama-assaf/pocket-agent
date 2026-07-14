import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AtelierMemoryBridge } from '../../src/memory/atelier-bridge';

function fakeMemory() {
  const facts: any[] = [];
  let id = 1;
  return {
    _facts: facts,
    saveFact: (
      category: string,
      subject: string,
      content: string,
      _sensitive?: boolean,
      scope: string = 'user'
    ) => {
      facts.push({ id: id, category, subject, content, scope });
      return id++;
    },
    getFactsByCategory: (c: string) => facts.filter((f) => f.category === c),
    deleteFact: (i: number) => {
      const idx = facts.findIndex((f) => f.id === i);
      if (idx >= 0) facts.splice(idx, 1);
      return idx >= 0;
    },
  } as any;
}

describe('AtelierMemoryBridge', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-'));
    fs.mkdirSync(path.join(dir, '.atelier', 'memory'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.atelier', 'memory', 'instincts.md'),
      '# instincts\n- ship small'
    );
  });

  it('mirrors memory files into SQLite facts tagged by source', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const res = await bridge.syncProject(dir);
    expect(res.files).toBe(1);
    expect(mem.getFactsByCategory('atelier-memory').length).toBe(1);
  });

  it('is idempotent — re-sync does not duplicate', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    await bridge.syncProject(dir);
    await bridge.syncProject(dir);
    expect(mem.getFactsByCategory('atelier-memory').length).toBe(1);
  });

  it('syncScopeRoot tags mirrored rows with the root scope (client isolation)', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const memoryDir = path.join(dir, '.atelier', 'memory');
    await bridge.syncScopeRoot({ scope: 'client:acme', rootDir: dir, memoryDir });

    const rows = mem.getFactsByCategory('atelier-memory');
    expect(rows.length).toBe(1);
    expect(rows[0].scope).toBe('client:acme');
    // subject is the bare relative path within the scope — no projectDir prefix
    expect(rows[0].subject).toBe('instincts.md');
  });

  it('syncScopeRoot re-sync stays idempotent within a scope', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const memoryDir = path.join(dir, '.atelier', 'memory');
    await bridge.syncScopeRoot({ scope: 'client:acme', rootDir: dir, memoryDir });
    await bridge.syncScopeRoot({ scope: 'client:acme', rootDir: dir, memoryDir });
    expect(mem.getFactsByCategory('atelier-memory').length).toBe(1);
  });

  it('seed creates only missing files', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const created = await bridge.seed(dir, [
      { relativePath: 'instincts.md', content: 'template' }, // exists → skip
      { relativePath: 'voice.md', content: 'voice template' }, // missing → create
    ]);
    expect(created).toEqual(['voice.md']);
    expect(
      fs.readFileSync(path.join(dir, '.atelier', 'memory', 'instincts.md'), 'utf-8')
    ).toContain('ship small');
  });
});
