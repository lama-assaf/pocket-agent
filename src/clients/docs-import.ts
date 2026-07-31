// src/clients/docs-import.ts
// Reusable "onboard external docs into a client brain" pipeline — the
// generalized, tested version of the one-off Zilliqa-comms import (see
// e2e/adhoc-zilliqa-publish.mjs and the git history around it). Turns
// "copy a folder of docs into a client repo, scan it for secrets first,
// never clobber the app's own generated files, optionally make it
// agent-recallable" into a single typed function instead of a hand-run
// rsync + grep + cp sequence.
//
// Not wired to any IPC handler or UI yet — this is the reusable core a
// future onboarding flow (or a marketplace/CLI import command) calls.

import fs from 'fs';
import path from 'path';
import { clientPaths } from './paths';
import { isReservedExportPath } from './export';
import { AtelierMemoryBridge, type AtelierBridgeMemory } from '../memory/atelier-bridge';
import { clientScope } from '../memory/scope';

/**
 * Directory/file names excluded everywhere they appear in the source tree,
 * regardless of depth (matched by exact path segment, not just at the root).
 * Mirrors the exclude list hand-run for the Zilliqa-comms import.
 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  '.env',
  '.git',
  '.claude',
  '.remember',
  '.gg',
  '.mcp-servers',
  '.DS_Store',
  'node_modules',
];

/** Obsidian's per-machine workspace-state files — never worth importing. */
const OBSIDIAN_WORKSPACE_FILE_RE = /(^|\/)\.obsidian\/workspace(-mobile)?\.json$/;

/**
 * Bookkeeping directory (rootDir-relative, NOT inside any imported subtree)
 * holding one manifest file per subtree, recording every path copied there on
 * the prior run. Compared against the current run's copiedFiles to detect
 * files deleted at the source, so they can be pruned from destRoot instead of
 * persisting forever. Deliberately kept OUTSIDE destRoot — e.g. `docs/` stays
 * exactly the doc tree a human (or Obsidian) browses, with no pipeline
 * artifact mixed into it — while still living inside rootDir so it round-trips
 * through the same git repo the docs themselves sync through.
 */
const MANIFEST_DIR = '.atelier/docs-import-manifests';

interface ImportManifest {
  /** destRoot-relative paths copied by the previous run. */
  files: string[];
}

/** One manifest file per subtree, so multiple imports into one client repo (different subtrees) never share state. */
function manifestPath(rootDir: string, subtree: string): string {
  const safeName = subtree.split(path.sep).join('/').replace(/[\\/]/g, '__') || 'root';
  return path.join(rootDir, MANIFEST_DIR, `${safeName}.json`);
}

function readManifest(rootDir: string, subtree: string): ImportManifest {
  try {
    const raw = fs.readFileSync(manifestPath(rootDir, subtree), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ImportManifest>;
    return {
      files: Array.isArray(parsed.files) ? parsed.files.filter((f) => typeof f === 'string') : [],
    };
  } catch {
    return { files: [] }; // no prior manifest (first import) or unreadable — treat as empty
  }
}

function writeManifest(rootDir: string, subtree: string, files: string[]): void {
  const target = manifestPath(rootDir, subtree);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ files: [...files].sort() }, null, 2) + '\n', 'utf-8');
}

/**
 * Delete destRoot files recorded in the previous manifest but absent from the
 * current copiedFiles set (i.e. removed at the source since the last import).
 * Guarded so it can only ever remove paths that resolve strictly inside
 * destRoot — a stale/tampered manifest entry with `..` segments is skipped
 * rather than followed outside the managed subtree. Returns the pruned paths
 * (destRoot-relative) for reporting. Best-effort: a file already gone (races,
 * manual cleanup) is silently skipped, not an error.
 */
function pruneStaleFiles(
  destRoot: string,
  previousFiles: string[],
  currentFiles: readonly string[]
): string[] {
  const current = new Set(currentFiles);
  const resolvedDestRoot = path.resolve(destRoot) + path.sep;
  const pruned: string[] = [];
  for (const rel of previousFiles) {
    if (current.has(rel)) continue;
    const abs = path.resolve(path.join(destRoot, rel));
    if (!abs.startsWith(resolvedDestRoot)) continue; // never delete outside the managed subtree
    try {
      if (fs.existsSync(abs)) {
        fs.rmSync(abs, { force: true });
        pruned.push(rel);
      }
    } catch {
      /* best-effort — leave it for a future run rather than fail the whole import */
    }
  }
  return pruned;
}

/**
 * Strict secret-detection patterns — the same set used to manually vet the
 * Zilliqa-comms import before it was pushed. Deliberately strict (favors
 * false negatives over false positives on prose that merely mentions
 * "password" or "token" as a concept) — this is a last-resort guard, not a
 * replacement for reviewing what you're importing.
 */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'AWS access/secret key reference', pattern: /aws_(access|secret)/i },
  { name: 'GitHub PAT (classic)', pattern: /ghp_[a-zA-Z0-9]{20,}/ },
  { name: 'GitHub PAT (fine-grained)', pattern: /github_pat_[a-zA-Z0-9_]{20,}/ },
  { name: 'Private key header', pattern: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'api_key assignment', pattern: /api[_-]?key\s*[:=]\s*['"]?[a-zA-Z0-9]{16,}/i },
  { name: 'password assignment', pattern: /password\s*[:=]\s*['"]?[^\s'"]{6,}/i },
  { name: 'secret assignment', pattern: /secret\s*[:=]\s*['"]?[a-zA-Z0-9]{12,}/i },
];

/** One file that tripped the secret scan. */
export interface SecretScanHit {
  /** Path relative to sourceDir. */
  path: string;
  /** Which SECRET_PATTERNS rule matched. */
  rule: string;
}

/**
 * Thrown by importDocsIntoClient when the secret scan finds a hit — nothing
 * is written to disk when this is thrown (the scan runs entirely before any
 * copy). `offending` lists every match found, not just the first, so the
 * caller can report/fix them all at once.
 */
export class SecretScanError extends Error {
  constructor(public readonly offending: SecretScanHit[]) {
    super(
      `importDocsIntoClient refused: ${offending.length} file(s) matched a secret pattern — ` +
        offending.map((o) => `${o.path} (${o.rule})`).join('; ')
    );
    this.name = 'SecretScanError';
  }
}

export interface ImportDocsOptions {
  /** Client id (see src/clients/paths.ts's clientPaths). */
  clientId: string;
  /** Directory tree to import from. */
  sourceDir: string;
  /**
   * rootDir-relative destination subtree. Defaults to 'docs'. Any individual
   * source file whose destination path under this subtree collides with a
   * RESERVED_EXPORT_PATHS entry is skipped (not copied) rather than causing
   * the whole import to fail — see ImportDocsResult.skippedReservedPaths.
   */
  subtree?: string;
  /** Additional exclude segment names, layered on top of DEFAULT_EXCLUDES. */
  excludes?: readonly string[];
  /**
   * When true, mirrors every imported plain-text-ish file (.md, .markdown,
   * .txt — see AtelierMemoryBridge's TEXT_INGEST_EXTENSIONS; binary formats
   * like .docx/images are copied to the repo but skipped for ingestion) into
   * recallable agent memory via AtelierMemoryBridge (namespaced under
   * `<subtree>/`, so it can never collide with — or be cleared by — the
   * `.atelier/memory` mirror). Large files are chunked (see chunkText).
   * Requires `memory`.
   */
  ingestToMemory?: boolean;
  /** Required when ingestToMemory is true. */
  memory?: AtelierBridgeMemory;
}

export interface ImportDocsResult {
  /** sourceDir-relative paths actually copied. */
  copiedFiles: string[];
  /**
   * Candidate paths that were skipped because their destination would fall
   * under a RESERVED_EXPORT_PATHS entry. Normally empty for the default
   * `subtree: 'docs'` — populated when a caller points subtree at (or a
   * source file happens to be named like) an exporter-owned path.
   */
  skippedReservedPaths: string[];
  /**
   * destRoot-relative paths removed because they were copied by a previous
   * run of this pipeline (recorded in the manifest) but no longer exist at
   * the source — i.e. deleted upstream since the last import. Empty on a
   * first import (no prior manifest).
   */
  prunedFiles: string[];
  /** Number of imported text-ish files mirrored into memory (0 when ingestToMemory is false). */
  ingestedFiles: number;
}

function isExcludedSegment(relPath: string, excludes: readonly string[]): boolean {
  const norm = relPath.split(path.sep).join('/');
  const segments = norm.split('/');
  return excludes.some((ex) => segments.includes(ex));
}

/** Heuristic binary check: a NUL byte in the first few KB (mirrors `grep -I`). */
function looksBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8000);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/** Recursively list files under `dir` (relative to `base`), applying excludes. */
function walk(dir: string, base: string, excludes: readonly string[], out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(base, abs);
    const relNorm = rel.split(path.sep).join('/');
    if (isExcludedSegment(relNorm, excludes) || OBSIDIAN_WORKSPACE_FILE_RE.test(relNorm)) continue;
    if (entry.isDirectory()) {
      walk(abs, base, excludes, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

/**
 * Onboard an external directory of docs into a client brain.
 *
 * Order of operations (secret scan strictly before any write, so a refusal
 * never leaves a partial copy on disk):
 *   1. Walk sourceDir, applying DEFAULT_EXCLUDES + excludes + the Obsidian
 *      workspace-file rule.
 *   2. Scan every non-binary candidate for SECRET_PATTERNS; throw
 *      SecretScanError (no writes) if anything matches.
 *   3. Copy each candidate into `<clientRoot>/<subtree>/`, skipping (and
 *      recording) any whose destination path is exporter-owned
 *      (isReservedExportPath, from export.ts's RESERVED_EXPORT_PATHS —
 *      the same list the app's own Publish flow treats as generated).
 *   4. Prune: any file recorded in the previous run's manifest (stored
 *      outside destRoot, under `.atelier/docs-import-manifests/`) but not
 *      copied this run (i.e. deleted at the source since) is removed from
 *      destRoot, then the manifest is rewritten with this run's file list.
 *      Deletion is confined to destRoot by construction (see
 *      pruneStaleFiles) — never touches `.git`, `.obsidian` scaffolding, or
 *      anything outside the managed subtree.
 *   5. If ingestToMemory, mirror the (now pruned) destRoot into recallable
 *      memory via AtelierMemoryBridge.mirrorDocsDir — since stale files are
 *      already gone from disk by this point, the mirror's own full
 *      delete-then-readd resync naturally stops re-ingesting them too.
 */
export async function importDocsIntoClient(options: ImportDocsOptions): Promise<ImportDocsResult> {
  const {
    clientId,
    sourceDir,
    subtree = 'docs',
    excludes = [],
    ingestToMemory = false,
    memory,
  } = options;

  if (ingestToMemory && !memory) {
    throw new Error('importDocsIntoClient: `memory` is required when ingestToMemory is true');
  }
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw new Error(
      `importDocsIntoClient: sourceDir does not exist or is not a directory: ${sourceDir}`
    );
  }

  const allExcludes = [...DEFAULT_EXCLUDES, ...excludes];
  const rootDir = clientPaths(clientId).rootDir;
  const destRoot = path.join(rootDir, subtree);

  // 1) Discover candidates.
  const candidates: string[] = [];
  walk(sourceDir, sourceDir, allExcludes, candidates);

  // 2) Secret scan — strictly before any write.
  const offending: SecretScanHit[] = [];
  for (const rel of candidates) {
    const abs = path.join(sourceDir, rel);
    let buf: Buffer;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf-8');
    for (const { name, pattern } of SECRET_PATTERNS) {
      if (pattern.test(text)) {
        offending.push({ path: rel, rule: name });
        break;
      }
    }
  }
  if (offending.length > 0) {
    throw new SecretScanError(offending);
  }

  // 3) Copy, skipping anything that would land on a reserved exporter path.
  const copiedFiles: string[] = [];
  const skippedReservedPaths: string[] = [];
  for (const rel of candidates) {
    const relUnderClientRoot = path.join(subtree, rel).split(path.sep).join('/');
    if (isReservedExportPath(relUnderClientRoot)) {
      skippedReservedPaths.push(relUnderClientRoot);
      continue;
    }
    const srcAbs = path.join(sourceDir, rel);
    const destAbs = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.copyFileSync(srcAbs, destAbs);
    copiedFiles.push(rel);
  }

  // 4) Prune files that a prior run copied but the source no longer has.
  const previousManifest = readManifest(rootDir, subtree);
  const prunedFiles = pruneStaleFiles(destRoot, previousManifest.files, copiedFiles);
  writeManifest(rootDir, subtree, copiedFiles);

  // 5) Optional: mirror imported text docs into recallable memory.
  let ingestedFiles = 0;
  if (ingestToMemory && memory) {
    const bridge = new AtelierMemoryBridge(memory);
    const scope = clientScope(clientId);
    const result = await bridge.mirrorDocsDir(destRoot, scope, `${subtree}/`);
    ingestedFiles = result.files;
  }

  return { copiedFiles, skippedReservedPaths, prunedFiles, ingestedFiles };
}
