import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
// adm-zip ships no type declarations and no @types/adm-zip is installed —
// minimal local shim for the two methods this fixture builder needs.
const AdmZip = require('adm-zip') as new () => {
  addFile(entryName: string, content: Buffer): void;
  writeZip(targetPath: string): void;
};
import { AtelierMemoryBridge, chunkText } from '../../src/memory/atelier-bridge';
import { setWorldRoot, setClientsRoot, clientPaths, worldScopeRoot } from '../../src/clients/paths';

/**
 * Build a minimal-but-real .docx fixture at `destPath` containing `paragraphs`
 * as separate <w:p> paragraphs, so officeparser's real WordParser (not a
 * mock) extracts real, known text. A .docx is just a ZIP of OOXML parts —
 * this is the same technique verified against the installed officeparser
 * (7.0.3) before writing these tests: only [Content_Types].xml, _rels/.rels,
 * and word/document.xml are required for parseOffice to dispatch to the
 * Word parser and extract text (adm-zip is already a project dependency).
 */
function writeFixtureDocx(destPath: string, paragraphs: string[]): void {
  const zip = new AdmZip();
  const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('\n');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`;
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml));
  zip.addFile('_rels/.rels', Buffer.from(relsXml));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  zip.writeZip(destPath);
}

function fakeMemory() {
  const facts: any[] = [];
  let id = 1;
  // Fake stand-in for updated_at — an incrementing "version" bumped ONLY on
  // an actual write (insert or update), so a test can assert "this row was
  // never touched" via version equality, exactly like a real updated_at
  // timestamp would prove it. saveFactCallCount counts real write calls —
  // since the real facts.ts saveFact ALWAYS triggers embedFactAsync
  // internally, "saveFact was never called for this content" is the direct,
  // deterministic equivalent of "embedFactAsync never fired for it".
  let version = 1;
  let saveFactCallCount = 0;
  return {
    _facts: facts,
    get saveFactCallCount() {
      return saveFactCallCount;
    },
    resetSaveFactCallCount() {
      saveFactCallCount = 0;
    },
    // Mirrors the real facts.ts saveFact's upsert-by-(scope,category,subject)
    // semantics and its content_hash bookkeeping — the content-hash dedup
    // logic in mirrorMemoryDir relies on both: an existing subject must be
    // UPDATED in place (not duplicated), and content_hash must be populated
    // so "unchanged since last mirror" can actually be detected.
    saveFact: (
      category: string,
      subject: string,
      content: string,
      _sensitive?: boolean,
      scope: string = 'user'
    ) => {
      saveFactCallCount++;
      const contentHash = require('crypto')
        .createHash('sha256')
        .update(content, 'utf-8')
        .digest('hex');
      const existing = facts.find(
        (f) => f.category === category && f.subject === subject && (f.scope ?? 'user') === scope
      );
      if (existing) {
        existing.content = content;
        existing.content_hash = contentHash;
        existing.updated_at = version++;
        return existing.id;
      }
      const newId = id++;
      facts.push({
        id: newId,
        category,
        subject,
        content,
        scope,
        content_hash: contentHash,
        updated_at: version++,
      });
      return newId;
    },
    getFactsByCategory: (c: string) => facts.filter((f) => f.category === c),
    deleteFact: (i: number) => {
      const idx = facts.findIndex((f) => f.id === i);
      if (idx >= 0) facts.splice(idx, 1);
      return idx >= 0;
    },
  } as any;
}

describe('chunkText', () => {
  it('returns the whole trimmed content as a single chunk when it fits', () => {
    expect(chunkText('  # short doc\n\nfits in one chunk  ')).toEqual([
      '# short doc\n\nfits in one chunk',
    ]);
  });

  it('returns an empty array for empty/whitespace-only content', () => {
    expect(chunkText('   \n\n  ')).toEqual([]);
  });

  it('splits content over the cap into multiple bounded chunks on paragraph boundaries', () => {
    const paragraph = 'Sentence about brand voice and tone. '.repeat(15); // ~570 chars
    const doc = Array.from({ length: 5 }, (_, i) => `${paragraph}(${i})`).join('\n\n');
    const chunks = chunkText(doc, 800);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
    // No content lost: every paragraph marker survives somewhere in the chunks.
    for (let i = 0; i < 5; i++) {
      expect(chunks.some((c) => c.includes(`(${i})`))).toBe(true);
    }
  });

  it('hard-splits a single paragraph that alone exceeds the cap', () => {
    const singleParagraph = 'x'.repeat(2500); // no blank lines at all
    const chunks = chunkText(singleParagraph, 800);

    expect(chunks.length).toBe(Math.ceil(2500 / 800));
    expect(chunks.join('')).toBe(singleParagraph);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(800);
  });

  describe('structure-aware chunking (headings, fences, tables)', () => {
    it('keeps a heading attached to its section\'s first chunk, never repeated in later chunks', () => {
      const heading = '## Brand Voice Guidelines';
      const longBody = 'This is a sentence describing tone and voice consistency requirements. '.repeat(20);
      const content = `${heading}\n\n${longBody}`;

      const chunks = chunkText(content, 800);

      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks[0].startsWith(heading)).toBe(true);
      for (let i = 1; i < chunks.length; i++) {
        expect(chunks[i].startsWith(heading)).toBe(false);
        expect(chunks[i]).not.toContain(heading);
      }
      // No content lost across chunk boundaries.
      expect(chunks.join(' ')).toContain('tone and voice consistency requirements');
    });

    it('never splits inside a fenced code block, even one containing internal blank lines near the cap boundary', () => {
      // Internal blank lines between functions are exactly what the OLD
      // blank-line paragraph splitter (\n{2,}) would have broken on,
      // scattering the fence across multiple chunks and losing its
      // opening/closing markers from whichever chunk didn't get them.
      const fenceBody = Array.from(
        { length: 10 },
        (_, i) =>
          `function stepNumber${i}(inputValue) {\n  // computes the result for step ${i}\n  return inputValue + ${i};\n}`
      ).join('\n\n');
      const fence = '```js\n' + fenceBody + '\n```';
      const before = 'Intro paragraph before the code sample explaining context and setup.';
      const after = 'Explanation after the code sample describing the resulting behavior.';
      const content = `${before}\n\n${fence}\n\n${after}`;
      expect(content.length).toBeGreaterThan(800); // must actually require chunking

      const chunks = chunkText(content, 800);

      const chunksWithFence = chunks.filter((c) => c.includes('```js'));
      expect(chunksWithFence).toHaveLength(1); // opening marker appears in exactly one chunk
      expect(chunksWithFence[0]).toContain(fence); // the ENTIRE fence, contiguous and intact
      // The internal blank lines between functions did not fragment the fence.
      for (let i = 0; i < 10; i++) {
        expect(chunksWithFence[0]).toContain(`function stepNumber${i}(`);
      }
    });

    it('never splits inside a markdown table, even one spanning well over the cap', () => {
      const header = '| Feature | Description |';
      const separator = '| --- | --- |';
      const rows = Array.from(
        { length: 30 },
        (_, i) => `| Row ${i} | This is a fairly long description explaining feature number ${i} in detail. |`
      );
      const table = [header, separator, ...rows].join('\n');
      expect(table.length).toBeGreaterThan(800); // the table alone already exceeds the cap
      const content = `Intro text before the table.\n\n${table}\n\nOutro text after the table.`;

      const chunks = chunkText(content, 800);

      const chunksWithTable = chunks.filter((c) => c.includes(header));
      expect(chunksWithTable).toHaveLength(1);
      expect(chunksWithTable[0]).toContain(table); // fully intact, never sliced
      // This one chunk is allowed to exceed maxChars since the table is atomic.
      expect(chunksWithTable[0].length).toBeGreaterThan(800);
    });

    it('a nested fence (outer 4-backtick fence wrapping an inner 3-backtick example) is not closed prematurely by the inner marker', () => {
      const nested = '````markdown\nHere is an example:\n```js\nconsole.log(1);\n```\nEnd of example.\n````';
      const padding = 'Padding paragraph to force real chunking to occur in this test. '.repeat(15);
      const content = `Doc intro.\n\n${padding}\n\n${nested}\n\nDoc outro.`;
      expect(content.length).toBeGreaterThan(800); // must actually require chunking

      const chunks = chunkText(content, 800);

      const chunksWithNestedFence = chunks.filter((c) => c.includes('````markdown'));
      expect(chunksWithNestedFence).toHaveLength(1);
      // The whole outer fence — including the inner ``` example it wraps —
      // survives intact; the inner marker did not prematurely close it.
      expect(chunksWithNestedFence[0]).toContain(nested);
    });
  });
});

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

  it('re-syncing one scope never touches another scope’s mirrored rows (cross-scope isolation)', async () => {
    const mem = fakeMemory();
    const bridge = new AtelierMemoryBridge(mem);
    const memoryDir = path.join(dir, '.atelier', 'memory');

    await bridge.syncScopeRoot({ scope: 'client:acme', rootDir: dir, memoryDir });
    await bridge.syncScopeRoot({ scope: 'world', rootDir: dir, memoryDir });

    let rows = mem.getFactsByCategory('atelier-memory');
    expect(rows.map((r: { scope: string }) => r.scope).sort()).toEqual(['client:acme', 'world']);

    // Re-sync ONLY the client scope (e.g. a fresh pull for that brand) —
    // world's mirrored row must survive untouched.
    fs.writeFileSync(path.join(memoryDir, 'instincts.md'), '# instincts\n- ship smaller');
    await bridge.syncScopeRoot({ scope: 'client:acme', rootDir: dir, memoryDir });

    rows = mem.getFactsByCategory('atelier-memory');
    expect(rows).toHaveLength(2);
    const world = rows.find((r: { scope: string }) => r.scope === 'world');
    const client = rows.find((r: { scope: string }) => r.scope === 'client:acme');
    expect(world?.content).toContain('ship small');
    expect(world?.content).not.toContain('ship smaller');
    expect(client?.content).toContain('ship smaller');
  });

  describe('syncSelection — multi-root aggregation from a session context', () => {
    let worldRoot: string;
    let clientsRoot: string;

    beforeEach(() => {
      // syncSelection resolves roots via src/clients/registry.ts's
      // scopeRootsForSelection, which reads the injected world/clients roots
      // (src/clients/paths.ts) — inject tmp dirs there so this test controls
      // exactly what's on disk, same convention as clients-registry.test.ts.
      worldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-world-'));
      clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-clients-'));
      setWorldRoot(worldRoot);
      setClientsRoot(clientsRoot);

      fs.mkdirSync(worldScopeRoot().memoryDir, { recursive: true });
      fs.writeFileSync(path.join(worldScopeRoot().memoryDir, 'glossary.md'), '# world glossary');

      fs.mkdirSync(clientPaths('acme').memoryDir, { recursive: true });
      fs.writeFileSync(path.join(clientPaths('acme').memoryDir, 'voice.md'), '# client voice');
    });

    afterEach(() => {
      setWorldRoot('');
      setClientsRoot('');
    });

    it('syncs every root implied by a client-context selection (client + world), each under its own scope', async () => {
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      const res = await bridge.syncSelection(
        { contextType: 'client', clientId: 'acme', projectKey: null },
        null
      );

      expect(res.roots).toBe(2);
      expect(res.files).toBe(2);
    });

    it('a personal-context selection syncs nothing (personal memory never touches disk)', async () => {
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      const res = await bridge.syncSelection(
        { contextType: 'personal', clientId: null, projectKey: null },
        null
      );

      expect(res.roots).toBe(0);
      expect(res.files).toBe(0);
      expect(mem.getFactsByCategory('atelier-memory')).toHaveLength(0);
    });
  });

  describe('multi-format ingestion (.docx/.pdf/.pptx + image skip)', () => {
    it('mirrorDocsDir extracts and ingests real text from a .docx file via officeparser', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-docs-'));
      writeFixtureDocx(path.join(docsRoot, 'brand', 'onboarding.docx'), [
        'This is the first paragraph of a real onboarding document.',
        'Second paragraph describing brand voice and tone guidelines.',
      ]);
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      const result = await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      expect(result.files).toBe(1);
      const rows = mem.getFactsByCategory('atelier-memory');
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe('docs/brand/onboarding.docx');
      expect(rows[0].content).toContain('first paragraph of a real onboarding document');
      expect(rows[0].content).toContain('brand voice and tone guidelines');
    });

    it('re-importing the same .docx stays idempotent (no duplicate facts)', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-docs-'));
      writeFixtureDocx(path.join(docsRoot, 'onboarding.docx'), ['Stable content.']);
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      expect(mem.getFactsByCategory('atelier-memory')).toHaveLength(1);
    });

    it('a corrupt/unparseable .docx is skipped (logged), never crashes the mirror pass', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-docs-'));
      // Not a real zip/docx at all — the header sniff must catch this before
      // officeparser ever runs.
      fs.writeFileSync(path.join(docsRoot, 'corrupt.docx'), 'not a real docx file');
      // A valid file alongside it must still get ingested.
      writeFixtureDocx(path.join(docsRoot, 'valid.docx'), ['Valid content survives.']);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      await expect(bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/')).resolves.toBeDefined();

      const rows = mem.getFactsByCategory('atelier-memory');
      expect(rows).toHaveLength(1);
      expect(rows[0].subject).toBe('docs/valid.docx');
      expect(
        warnSpy.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            (args[0].includes('Failed to extract text from') ||
              args[0].includes('not a valid zip-based Office Open XML file'))
        )
      ).toBe(true);

      warnSpy.mockRestore();
    });

    it('images are skipped with a logged reason, never silently dropped or ingested raw', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-docs-'));
      fs.writeFileSync(path.join(docsRoot, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      writeFixtureDocx(path.join(docsRoot, 'notes.docx'), ['Real doc content.']);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      const result = await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      // Only the real doc counts as mirrored — the image never becomes a fact.
      expect(result.files).toBe(1);
      const rows = mem.getFactsByCategory('atelier-memory');
      expect(rows).toHaveLength(1);
      expect(rows.some((r: { subject: string }) => r.subject.includes('logo.png'))).toBe(false);

      expect(
        warnSpy.mock.calls.some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].includes('Skipping image') &&
            args[0].includes('logo.png')
        )
      ).toBe(true);

      warnSpy.mockRestore();
    });
  });

  describe('content-hash dedup — unchanged files are not re-saved/re-embedded', () => {
    it('re-mirroring byte-identical files makes zero saveFact calls and leaves ids/updated_at unchanged', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-hash-'));
      fs.writeFileSync(path.join(docsRoot, 'voice.md'), '# Voice\nBold and playful.');
      fs.writeFileSync(path.join(docsRoot, 'tone.md'), '# Tone\nWarm but direct.');
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);

      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');
      const before = mem
        .getFactsByCategory('atelier-memory')
        .map((f: { id: number; subject: string; updated_at: number }) => ({
          id: f.id,
          subject: f.subject,
          updated_at: f.updated_at,
        }))
        .sort((a: { subject: string }, b: { subject: string }) => a.subject.localeCompare(b.subject));
      expect(before).toHaveLength(2);
      mem.resetSaveFactCallCount();

      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');
      const after = mem
        .getFactsByCategory('atelier-memory')
        .map((f: { id: number; subject: string; updated_at: number }) => ({
          id: f.id,
          subject: f.subject,
          updated_at: f.updated_at,
        }))
        .sort((a: { subject: string }, b: { subject: string }) => a.subject.localeCompare(b.subject));

      // Same ids AND same updated_at — neither row was ever touched.
      expect(after).toEqual(before);
      // Zero saveFact calls at all: in the real system, saveFact is exactly
      // what triggers embedFactAsync, so zero calls == zero re-embeds.
      expect(mem.saveFactCallCount).toBe(0);
    });

    it('changing one file only re-saves/re-embeds that file, leaving its sibling completely untouched', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-hash-'));
      fs.writeFileSync(path.join(docsRoot, 'voice.md'), '# Voice\nOriginal voice content.');
      fs.writeFileSync(path.join(docsRoot, 'tone.md'), '# Tone\nWarm but direct.');
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      const findFact = (subject: string) =>
        mem.getFactsByCategory('atelier-memory').find((f: { subject: string }) => f.subject === subject);
      const beforeVoice = { ...findFact('docs/voice.md') };
      const beforeTone = { ...findFact('docs/tone.md') };

      mem.resetSaveFactCallCount();
      fs.writeFileSync(path.join(docsRoot, 'voice.md'), '# Voice\nCHANGED voice content.');
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      // Exactly one saveFact call — only the changed file's content re-wrote (and would re-embed).
      expect(mem.saveFactCallCount).toBe(1);

      const afterVoice = findFact('docs/voice.md');
      const afterTone = findFact('docs/tone.md');
      expect(afterVoice.id).toBe(beforeVoice.id); // upserted in place, not a new row
      expect(afterVoice.updated_at).not.toBe(beforeVoice.updated_at); // bumped
      expect(afterVoice.content).toContain('CHANGED voice content');
      // The untouched sibling is byte-for-byte identical, including updated_at.
      expect(afterTone).toEqual(beforeTone);
    });

    it('deleting a source file removes its stale fact while sibling facts are left completely untouched (true diff, not clear-then-readd)', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-hash-'));
      fs.writeFileSync(path.join(docsRoot, 'voice.md'), '# Voice\nStays around.');
      fs.writeFileSync(path.join(docsRoot, 'gone-soon.md'), '# Will be deleted');
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');
      const findFact = (subject: string) =>
        mem.getFactsByCategory('atelier-memory').find((f: { subject: string }) => f.subject === subject);
      const beforeVoice = { ...findFact('docs/voice.md') };
      expect(findFact('docs/gone-soon.md')).toBeDefined();

      fs.rmSync(path.join(docsRoot, 'gone-soon.md'));
      mem.resetSaveFactCallCount();
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      // The deleted file's content was byte-identical to what's stored where
      // it still exists (voice.md), so the only DB activity this run is the
      // stale-row deletion — zero saveFact (write/re-embed) calls.
      expect(mem.saveFactCallCount).toBe(0);
      expect(findFact('docs/gone-soon.md')).toBeUndefined();
      // The surviving sibling is completely untouched — same id, same
      // updated_at — proving this is a real diff, not a clear-everything-then-readd.
      expect(findFact('docs/voice.md')).toEqual(beforeVoice);
    });

    it('a chunk-boundary shift (1 chunk → 2 chunks) fully clears the old bare-path subject and creates fresh chunked subjects', async () => {
      const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'atelier-hash-'));
      const shortContent = '# Small\nFits in one chunk.';
      fs.writeFileSync(path.join(docsRoot, 'growing.md'), shortContent);
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      const rowsBefore = mem.getFactsByCategory('atelier-memory');
      expect(rowsBefore.map((f: { subject: string }) => f.subject)).toEqual(['docs/growing.md']);
      const oldId = rowsBefore[0].id;

      // Grow it past the chunk cap so it now splits into multiple chunks —
      // the bare-path subject 'docs/growing.md' no longer corresponds to
      // anything this run produces (the new subjects are '#chunk-0'/'#chunk-1').
      const paragraph = 'This is one paragraph of brand narrative prose. '.repeat(20);
      const bigContent = Array.from({ length: 6 }, (_, i) => `${paragraph} (section ${i})`).join(
        '\n\n'
      );
      fs.writeFileSync(path.join(docsRoot, 'growing.md'), bigContent);
      await bridge.mirrorDocsDir(docsRoot, 'client:acme', 'docs/');

      const rowsAfter = mem.getFactsByCategory('atelier-memory');
      const subjectsAfter = rowsAfter.map((f: { subject: string }) => f.subject).sort();
      // The old bare-path subject is gone (deleted as stale)...
      expect(subjectsAfter).not.toContain('docs/growing.md');
      // ...replaced by fresh chunked subjects, none reusing the old row's id.
      expect(subjectsAfter.length).toBeGreaterThan(1);
      for (const subject of subjectsAfter) {
        expect(subject).toMatch(/^docs\/growing\.md#chunk-\d+$/);
      }
      expect(rowsAfter.some((f: { id: number }) => f.id === oldId)).toBe(false);
    });
  });

  describe('onMemoryFileWritten', () => {
    it('re-syncs the project when a written path is under .atelier/memory', async () => {
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      const writtenPath = path.join(dir, '.atelier', 'memory', 'instincts.md');

      await bridge.onMemoryFileWritten(writtenPath, dir);

      expect(mem.getFactsByCategory('atelier-memory')).toHaveLength(1);
    });

    it('ignores a write outside .atelier/memory (never triggers a sync)', async () => {
      const mem = fakeMemory();
      const bridge = new AtelierMemoryBridge(mem);
      const unrelatedPath = path.join(dir, 'README.md');

      await bridge.onMemoryFileWritten(unrelatedPath, dir);

      expect(mem.getFactsByCategory('atelier-memory')).toHaveLength(0);
    });
  });
});
