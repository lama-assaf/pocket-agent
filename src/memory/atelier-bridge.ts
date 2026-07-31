import fs from 'fs';
import path from 'path';
import type { MemoryManager } from './index';
import type { MemoryTemplate } from '../marketplace/types';
import type { SessionContext } from './sessions';
import type { ScopeRoot } from '../clients/types';
import { scopeRootsForSelection } from '../clients/registry';
import { computeFactContentHash } from './facts';

const CATEGORY = 'atelier-memory';

/**
 * Extensions treated as plain text and mirrored into memory via a plain utf-8
 * `readFileSync` (no extraction step needed).
 */
const TEXT_INGEST_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.txt']);

/**
 * Extensions requiring real text extraction before they're recallable —
 * routed through `officeparser`'s `parseOffice(path).toText()`, the same API
 * already proven at `attachment:extract-text` (src/main/ipc/misc-ipc.ts) and
 * the Telegram document handler (src/channels/telegram/handlers/documents.ts).
 * officeparser 7.x supports many more formats (.xlsx/.odt/.odp/.ods/.rtf/.csv)
 * but this set is deliberately scoped to the three formats the docs-import
 * pipeline is expected to see in practice; extend here if a client repo needs
 * more. Images are NOT in this set — there's no OCR dependency in this
 * codebase, and adding one is out of scope here (see the explicit
 * skip-with-log for images below).
 */
const EXTRACTABLE_EXTENSIONS: ReadonlySet<string> = new Set(['.docx', '.pdf', '.pptx']);

/**
 * Image extensions explicitly recognized so they get a clear "skipped, here's
 * why" log instead of silently vanishing (or being misread as plain text).
 */
const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.tiff',
]);

/**
 * Hard cap on characters per memory-fact chunk. `Xenova/all-MiniLM-L6-v2`
 * (src/memory/embeddings.ts) has a 256-token context window; at a conservative
 * ~4 characters/token for English prose, 800 characters keeps a chunk to
 * roughly 200 tokens — comfortably inside the window so the embedding
 * represents the whole chunk rather than a silently-truncated prefix of it.
 */
const MAX_CHUNK_CHARS = 800;

/**
 * Heuristic binary check: a NUL byte in the first few KB. Mirrors
 * src/clients/docs-import.ts's `looksBinary` — duplicated locally (rather
 * than imported) because docs-import.ts already imports this module, and
 * importing it back would create a cycle.
 */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Legacy OLE/CFB compound-file magic (used by old binary .doc/.ppt/.xls, and
 * by password-encrypted OOXML files, which MS-OFFCRYPTO wraps in a CFB
 * container). A `.docx`/`.pptx` with this header is NOT a zip at all, so
 * officeparser's zip reader is guaranteed to fail on it — detecting it up
 * front lets us skip with a clear, specific reason instead of surfacing
 * officeparser's cryptic "unknown compression type" error.
 */
const OLE_CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

/**
 * A real OOXML file (.docx/.pptx/.xlsx) is a zip archive, which always
 * starts with a "PK" local-file-header signature (0x50 0x4b).
 */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b]);

/**
 * Sniff the first few bytes of a file claiming to be `.docx`/`.pptx` and
 * return a human-readable reason it's unsupported, or null if it looks like
 * a well-formed zip (i.e. worth handing to officeparser at all). Read
 * failures are left to the caller (returns null so officeparser's own error
 * surfaces normally).
 */
function detectUnsupportedOfficeFormat(abs: string): string | null {
  let header: Buffer;
  try {
    const fd = fs.openSync(abs, 'r');
    header = Buffer.alloc(8);
    fs.readSync(fd, header, 0, 8, 0);
    fs.closeSync(fd);
  } catch {
    return null;
  }
  if (header.subarray(0, OLE_CFB_MAGIC.length).equals(OLE_CFB_MAGIC)) {
    return 'legacy OLE/compound-file format (old binary .doc/.ppt/.xls renamed with an Office Open XML extension, or a password-encrypted file) — not a zip-based Office Open XML file';
  }
  if (!header.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
    return 'not a valid zip-based Office Open XML file (missing "PK" header) — likely corrupted or misnamed';
  }
  return null;
}

/** An ATX heading line, per CommonMark: 1-6 `#` followed by whitespace. */
const HEADING_RE = /^#{1,6}\s/;

interface ChunkBlock {
  type: 'heading' | 'fence' | 'table' | 'para';
  text: string;
}

interface ChunkSection {
  /** The heading text starting this section, or null for content before any heading. */
  heading: string | null;
  body: ChunkBlock[];
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.length > 0 && t.includes('|');
}

/** A GFM table separator/delimiter row, e.g. `| --- | :--: |` or `---|---`. */
function isTableSeparatorRow(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^[\s|:-]+$/.test(t) && t.includes('-');
}

/** The fence marker (e.g. ` ``` ` or ` ```` ` or `~~~`) opening a fenced code block, if `line` starts one. */
function fenceMarkerAt(line: string): string | null {
  const m = /^\s*(`{3,}|~{3,})/.exec(line);
  return m ? m[1] : null;
}

/** A closing fence: a line consisting solely of `marker`'s character, at least as long as `marker`. */
function isFenceClose(line: string, marker: string): boolean {
  const t = line.trim();
  if (t.length < marker.length) return false;
  const ch = marker[0];
  for (let i = 0; i < t.length; i++) {
    if (t[i] !== ch) return false;
  }
  return true;
}

/**
 * Scan `text` line-by-line into an ordered list of structural blocks:
 * headings (own block, never merged with surrounding text), fenced code
 * blocks and markdown tables (atomic — captured verbatim from open to close,
 * including any blank lines or lookalike syntax nested inside), and plain
 * paragraphs (runs of other lines, blank-line-separated, exactly like the
 * pre-existing behavior). A longer-than-3-backtick/tilde fence marker (e.g.
 * annnnn outer ```` fence wrapping an inner ``` example) is only closed by a
 * line of >= the same marker length, so nested fences of that shape survive
 * intact rather than closing prematurely on the inner marker.
 */
function tokenizeBlocks(text: string): ChunkBlock[] {
  const lines = text.split('\n');
  const blocks: ChunkBlock[] = [];
  let paraLines: string[] = [];

  const flushPara = (): void => {
    if (paraLines.length > 0) {
      blocks.push({ type: 'para', text: paraLines.join('\n') });
      paraLines = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    if (HEADING_RE.test(line)) {
      flushPara();
      blocks.push({ type: 'heading', text: line.trim() });
      i++;
      continue;
    }

    const marker = fenceMarkerAt(line);
    if (marker) {
      flushPara();
      const fenceLines: string[] = [line];
      i++;
      while (i < lines.length) {
        fenceLines.push(lines[i]);
        const closed = isFenceClose(lines[i], marker);
        i++;
        if (closed) break;
      }
      blocks.push({ type: 'fence', text: fenceLines.join('\n') });
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const tableLines: string[] = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim() !== '' && isTableRow(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'table', text: tableLines.join('\n') });
      continue;
    }

    paraLines.push(line);
    i++;
  }
  flushPara();

  return blocks;
}

/**
 * Group ordered blocks into sections at each heading — a heading starts a new
 * section and stays with it; everything before the first heading (if any)
 * forms its own leading section with `heading: null`.
 */
function groupIntoSections(blocks: ChunkBlock[]): ChunkSection[] {
  const sections: ChunkSection[] = [];
  let current: ChunkSection = { heading: null, body: [] };
  let hasContent = false;

  for (const block of blocks) {
    if (block.type === 'heading') {
      if (hasContent) sections.push(current);
      current = { heading: block.text, body: [] };
      hasContent = true;
    } else {
      current.body.push(block);
      hasContent = true;
    }
  }
  if (hasContent) sections.push(current);

  return sections;
}

/**
 * Greedily pack one section's heading + body blocks into `chunks`, bounded by
 * `maxChars`. The heading (if any) seeds the accumulator so it rides along
 * with as much following content as fits into the section's first chunk;
 * later chunks of the same section never repeat it.
 *
 * Fences and tables are atomic: if one doesn't fit alongside whatever's
 * accumulated, the accumulator is flushed and the block starts its own chunk
 * whole — even if it alone still exceeds `maxChars` (a table/fence is never
 * sliced mid-structure). Plain paragraphs may still be partially sliced to
 * top up the accumulator (e.g. filling the rest of a heading's first chunk)
 * before hard-splitting whatever's left, matching the pre-existing
 * blind-character-slicing fallback for oversized non-structural text.
 */
function packSection(section: ChunkSection, maxChars: number, chunks: string[]): void {
  let current = section.heading ?? '';

  const flush = (): void => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  for (const block of section.body) {
    const text = block.text;
    const candidate = current ? `${current}\n\n${text}` : text;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (block.type === 'fence' || block.type === 'table') {
      // Atomic — never partial-slice. Flush whatever's accumulated, then
      // this block becomes (the start of) the next chunk intact, however
      // large — it gets flushed either by a future iteration or the final
      // flush() below, never sliced apart.
      flush();
      current = text;
      continue;
    }

    const availableForFirstPiece = current ? maxChars - current.length - 2 : maxChars;
    let rest = text;
    if (availableForFirstPiece > 0) {
      const firstPiece = text.slice(0, availableForFirstPiece).trim();
      if (firstPiece.length > 0) {
        current = current ? `${current}\n\n${firstPiece}` : firstPiece;
      }
      rest = text.slice(availableForFirstPiece);
    }
    flush();
    for (let i = 0; i < rest.length; i += maxChars) {
      const piece = rest.slice(i, i + maxChars).trim();
      if (piece.length > 0) chunks.push(piece);
    }
  }

  flush();
}

/**
 * Split `content` into bounded chunks for embedding. Structure-aware: markdown
 * headings, fenced code blocks, and tables are recognized (see tokenizeBlocks)
 * so a fence or table is never sliced mid-structure, and a heading stays
 * attached to its section's first chunk. Falls back to the pre-existing
 * blank-line-paragraph packing (with blind character-slicing for a single
 * oversized non-structural block) for everything else. Returns exactly one
 * chunk (the whole trimmed content) when it already fits — keeping the common
 * case's subject key unchanged (no `#chunk-N` suffix; see mirrorMemoryDir).
 */
export function chunkText(content: string, maxChars: number = MAX_CHUNK_CHARS): string[] {
  const trimmed = content.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const blocks = tokenizeBlocks(trimmed);
  const sections = groupIntoSections(blocks);

  const chunks: string[] = [];
  for (const section of sections) {
    packSection(section, maxChars, chunks);
  }

  return chunks.length > 0 ? chunks : [trimmed.slice(0, maxChars)];
}

/**
 * Minimal memory-store surface this bridge needs — exported so other modules
 * (docs-import.ts's onboarding pipeline, tests) can construct a bridge
 * without depending on the full MemoryManager class type.
 */
export interface AtelierBridgeMemory {
  saveFact(
    category: string,
    subject: string,
    content: string,
    sensitive?: boolean,
    scope?: string
  ): number;
  getFactsByCategory(
    category: string
  ): { id: number; subject: string; scope?: string; content_hash?: string | null }[];
  deleteFact(id: number): boolean;
}

export class AtelierMemoryBridge {
  constructor(private memory: AtelierBridgeMemory | MemoryManager) {}

  private memDir(projectDir: string): string {
    return path.join(projectDir, '.atelier', 'memory');
  }

  /**
   * Recursively list ingestible files under `memoryRoot`: plain-text formats
   * (TEXT_INGEST_EXTENSIONS, read as-is) and extractable formats
   * (EXTRACTABLE_EXTENSIONS, routed through officeparser). Image files are
   * intentionally excluded from the returned list — they're logged and
   * skipped explicitly here (not silently dropped), so the "why" is visible.
   */
  private listMemoryFiles(memoryRoot: string): { abs: string; kind: 'text' | 'extract' }[] {
    const out: { abs: string; kind: 'text' | 'extract' }[] = [];
    const walk = (d: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(abs);
          continue;
        }
        if (!e.isFile()) continue;
        const ext = path.extname(e.name).toLowerCase();
        if (TEXT_INGEST_EXTENSIONS.has(ext)) {
          out.push({ abs, kind: 'text' });
        } else if (EXTRACTABLE_EXTENSIONS.has(ext)) {
          out.push({ abs, kind: 'extract' });
        } else if (IMAGE_EXTENSIONS.has(ext)) {
          console.warn(
            `[AtelierMemoryBridge] Skipping image (no OCR support): ${path.relative(memoryRoot, abs)}`
          );
        }
        // Any other extension (binary or otherwise unsupported) is silently
        // excluded, matching the pre-existing behavior for non-doc files.
      }
    };
    walk(memoryRoot);
    return out;
  }

  /**
   * Extract plain text from a `.docx`/`.pdf`/`.pptx` file via officeparser.
   * Returns null (never throws) on any extraction failure — a malformed or
   * unsupported-variant office file must never crash the whole mirror pass,
   * it should just be skipped like any other unreadable file, with a logged
   * reason so the gap is visible rather than silent.
   */
  private async extractText(abs: string): Promise<string | null> {
    // Sniff the header before handing off to officeparser: a legacy
    // OLE/CFB file (old binary .doc renamed to .docx) or a non-zip file
    // (corrupted/misnamed) is guaranteed to fail officeparser's zip reader
    // with a cryptic "unknown compression type" error. Catching it here
    // gives a clear, specific reason instead.
    const unsupportedReason = detectUnsupportedOfficeFormat(abs);
    if (unsupportedReason) {
      console.warn(
        `[AtelierMemoryBridge] Skipping ${abs}: ${unsupportedReason}. Skipped, not fatal to the mirror pass.`
      );
      return null;
    }
    try {
      const { parseOffice } = await import('officeparser');
      const ast = await parseOffice(abs);
      return ast.toText();
    } catch (e) {
      // A malformed or unsupported-variant office file (encrypted,
      // corrupted, or otherwise not a well-formed Office Open XML zip) must
      // never crash the whole mirror pass — it's skipped like any other
      // unreadable file, with a logged reason so the gap is visible rather
      // than silent.
      console.warn(
        `[AtelierMemoryBridge] Failed to extract text from ${abs} (likely corrupted, password-encrypted, or not a real Office Open XML file) — skipping, mirror pass continues:`,
        e
      );
      return null;
    }
  }

  /**
   * Mirror a `.atelier/memory` tree into SQLite facts under CATEGORY, tagged with
   * `scope`. `subjectPrefix` disambiguates multiple dirs sharing one scope
   * (legacy 'user').
   *
   * Content-hash dedup: rather than the old unconditional "clear every row for
   * this scope+prefix, then re-save everything" (which re-embedded all rows on
   * every mirror, even byte-identical ones — confirmed live during a backfill
   * that re-embedded 2038/2038 already-current rows), this now diffs against
   * what's already stored:
   *   - A candidate subject whose freshly-computed sha256 matches the stored
   *     fact's `content_hash` is skipped entirely (no saveFact call at all —
   *     no write, no re-embed).
   *   - A subject that's new, or whose hash differs, goes through saveFact as
   *     before (upsert + re-embed).
   *   - Any subject that existed before this run but wasn't produced this run
   *     (deleted at the source, renamed, or — critically — a chunked file
   *     whose chunk BOUNDARIES shifted so its old `#chunk-N` subjects no
   *     longer match any subject this run produces) is deleted. This is what
   *     preserves the original clear-then-readd's cross-chunk-boundary-change
   *     correctness: e.g. a 2-chunk file edited down to 1 chunk drops its old
   *     `#chunk-0`/`#chunk-1` subjects (untouched → stale → deleted) while the
   *     new bare-path subject is created fresh, rather than leaving a
   *     dangling, doubly-wrong old chunk behind.
   */
  private async mirrorMemoryDir(
    memoryRoot: string,
    scope: string,
    subjectPrefix = ''
  ): Promise<number> {
    const mem = this.memory as AtelierBridgeMemory;

    // Snapshot existing rows for this scope+prefix BEFORE touching anything,
    // so we can tell "unchanged" (skip) from "stale" (delete) from "new/changed"
    // (write) after processing every file.
    const existingBySubject = new Map<string, { id: number; contentHash: string | null }>();
    for (const f of mem.getFactsByCategory(CATEGORY)) {
      const inScope = (f.scope ?? 'user') === scope;
      const matchesPrefix = subjectPrefix ? f.subject.startsWith(subjectPrefix) : true;
      if (inScope && matchesPrefix) {
        existingBySubject.set(f.subject, { id: f.id, contentHash: f.content_hash ?? null });
      }
    }
    const touchedSubjects = new Set<string>();

    const files = this.listMemoryFiles(memoryRoot);
    for (const { abs, kind } of files) {
      const rel = path.relative(memoryRoot, abs);
      let content: string;

      if (kind === 'extract') {
        // officeparser handles its own file I/O; extractText already logs and
        // returns null on any failure (corrupt file, unsupported variant, etc.)
        const extracted = await this.extractText(abs);
        if (extracted === null) continue;
        content = extracted.trim();
      } else {
        let buf: Buffer;
        try {
          buf = fs.readFileSync(abs);
        } catch {
          continue;
        }
        if (looksBinary(buf)) {
          console.warn(
            `[AtelierMemoryBridge] Skipping binary-looking content despite text extension: ${rel}`
          );
          continue;
        }
        content = buf.toString('utf-8').trim();
      }
      if (!content) continue;

      // Large files are split into bounded chunks (see chunkText) so each
      // embedding represents one coherent, model-sized piece rather than one
      // oversized/truncated embedding for the whole file. A file that fits in
      // one chunk keeps the original bare-path subject (no suffix) so
      // existing subjects/tests are unaffected.
      const chunks = chunkText(content);
      chunks.forEach((chunk, i) => {
        const subject =
          chunks.length === 1 ? `${subjectPrefix}${rel}` : `${subjectPrefix}${rel}#chunk-${i}`;
        touchedSubjects.add(subject);

        const existing = existingBySubject.get(subject);
        const newHash = computeFactContentHash(chunk);
        if (existing && existing.contentHash === newHash) {
          // Byte-identical to what's already stored — skip entirely, no
          // write and no re-embed triggered.
          return;
        }
        // saveFact triggers async embedding; scope isolates this brand's memory.
        mem.saveFact(CATEGORY, subject, chunk, false, scope);
      });
    }

    // Delete stale rows: existed before this run but nothing produced this
    // run touched them (source file deleted, or its chunk boundaries shifted
    // so its old subjects no longer correspond to anything current).
    for (const [subject, { id }] of existingBySubject) {
      if (!touchedSubjects.has(subject)) mem.deleteFact(id);
    }

    return files.length;
  }

  /**
   * Legacy per-project sync (user scope, projectDir-prefixed subjects). Kept for
   * the fire-and-forget write hook that mirrors edits made outside memory_init.
   */
  async syncProject(projectDir: string): Promise<{ files: number; chunks: number }> {
    const files = await this.mirrorMemoryDir(this.memDir(projectDir), 'user', `${projectDir}::`);
    return { files, chunks: files };
  }

  /**
   * Mirror a single scope root (world / client / project) into SQLite under its
   * own scope, so recall in that context surfaces the brand's files.
   */
  async syncScopeRoot(root: ScopeRoot): Promise<{ files: number }> {
    const files = await this.mirrorMemoryDir(root.memoryDir, root.scope);
    return { files };
  }

  /**
   * Mirror an arbitrary text-doc directory — e.g. docs-import.ts's imported
   * `docs/` subtree — into recallable memory (see TEXT_INGEST_EXTENSIONS for
   * which formats qualify), sharing the same content-hash-diffed mechanism as
   * syncScopeRoot (see mirrorMemoryDir). `subjectPrefix` MUST be distinct from
   * the `.atelier/memory` mirror's own prefix (bare relative paths, no prefix)
   * so re-syncing one never touches rows the other wrote — callers should pass
   * something like `'docs/'` (the subtree name + '/'), never `''`.
   */
  async mirrorDocsDir(
    docsRoot: string,
    scope: string,
    subjectPrefix: string
  ): Promise<{ files: number }> {
    if (!subjectPrefix) {
      throw new Error(
        'mirrorDocsDir: subjectPrefix must be non-empty to avoid colliding with the .atelier/memory mirror'
      );
    }
    const files = await this.mirrorMemoryDir(docsRoot, scope, subjectPrefix);
    return { files };
  }

  /**
   * Sync every on-disk root implied by the session's selected context (world,
   * active client, active project), each tagged with its matching scope. This is
   * how a shared brain becomes visible in the selected space without leaking
   * into any other.
   */
  async syncSelection(
    context: SessionContext,
    projectRoot?: ScopeRoot | null
  ): Promise<{ roots: number; files: number }> {
    const roots = scopeRootsForSelection(context, projectRoot ?? null);
    let files = 0;
    for (const root of roots) {
      const res = await this.syncScopeRoot(root);
      files += res.files;
    }
    return { roots: roots.length, files };
  }

  async onMemoryFileWritten(absPath: string, projectDir: string): Promise<void> {
    if (!absPath.includes(path.join('.atelier', 'memory'))) return;
    await this.syncProject(projectDir);
  }

  async seed(projectDir: string, templates: MemoryTemplate[]): Promise<string[]> {
    const created: string[] = [];
    for (const t of templates) {
      const abs = path.join(this.memDir(projectDir), t.relativePath);
      if (fs.existsSync(abs)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, t.content, 'utf-8');
      created.push(t.relativePath);
    }
    return created;
  }
}
