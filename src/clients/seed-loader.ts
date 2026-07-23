// src/clients/seed-loader.ts
// Loads + schema-validates the bundled default-client seed JSON files, so ops
// can add or change pre-filled clients (Zilliqa, LTIN, ...) by dropping/editing
// a JSON file — no code change, no rebuild of TS literals. Mirrors
// src/marketplace/paths.ts's getSeedRoot(): packaged path via extraResources
// (see package.json's `build.extraResources`), dev fallback via this file's
// own sibling `seeds/` dir. Electron-free (only reads process.resourcesPath,
// which is simply undefined outside Electron) so this stays unit-testable
// with no Electron runtime, like the rest of src/clients/.
//
// Fail-safe by design: a missing seed dir, an unreadable/malformed JSON file,
// or a file that fails schema validation is logged and skipped — this module
// never throws past loadClientSeeds(), so a bad or absent bundle degrades to
// "no default clients seeded" rather than blocking app launch.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import type { ClientSeed } from './seed';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let seedRootOverride: string | null = null;

/** Test-only override (mirrors setPluginsRoot/setClientsRoot elsewhere in src/). */
export function setClientSeedRoot(dir: string | null): void {
  seedRootOverride = dir;
}

/**
 * Bundled client-seed dir. Resolution order: test override → packaged
 * `<resources>/seed-clients` (see extraResources in package.json) → dev
 * fallback `src/clients/seeds` (this file's sibling dir).
 */
export function getClientSeedRoot(): string {
  if (seedRootOverride) return seedRootOverride;
  const packaged = path.join(process.resourcesPath || '', 'seed-clients');
  if (process.resourcesPath && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'seeds');
}

const factSchema = z.object({
  subject: z.enum(['voice', 'tone', 'instincts', 'banned_words']),
  content: z.string().trim().min(1),
});

const lessonSchema = z.object({
  // Free-text label, may be '' (matches ClientSeedLesson's existing contract).
  subject: z.string(),
  content: z.string().trim().min(1),
});

// General `fact`-category memory (Brain panel Facts tab) — same shape as a
// lesson, distinct field so it never collides with the how_to_act `facts` key.
const generalFactSchema = z.object({
  subject: z.string(),
  content: z.string().trim().min(1),
});

const agentSchema = z.object({
  packId: z.string().trim().min(1),
  agentName: z.string().trim().min(1),
});

/** JSON-on-disk shape: snake_case to match the `clients` table's own column names. */
const seedFileSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9_-]*$/, 'id must be a lowercase slug (letters, digits, -, _)'),
  name: z.string().trim().min(1),
  sync_mode: z.enum(['live', 'manual']).optional(),
  repo_url: z.string().trim().min(1).optional(),
  facts: z.array(factSchema),
  lessons: z.array(lessonSchema),
  // Optional + defaults to [] so existing bundles (zilliqa, ltin) that predate
  // this field still parse unchanged.
  general_facts: z.array(generalFactSchema).optional(),
  agents: z.array(agentSchema),
});

type SeedFile = z.infer<typeof seedFileSchema>;

function toClientSeed(file: SeedFile): ClientSeed {
  return {
    id: file.id,
    name: file.name,
    syncMode: file.sync_mode,
    repoUrl: file.repo_url,
    facts: file.facts,
    lessons: file.lessons,
    generalFacts: file.general_facts ?? [],
    agents: file.agents,
  };
}

/**
 * Parse + schema-validate a single seed file's already-read JSON text. Thrown
 * errors are caught by loadClientSeeds() and logged; exported separately so
 * callers/tests can assert on validation failures directly.
 */
export function parseClientSeed(raw: string): ClientSeed {
  const data: unknown = JSON.parse(raw);
  return toClientSeed(seedFileSchema.parse(data));
}

/**
 * Load every bundled `*.json` seed file from `dir` (default: the resolved
 * seed root), schema-validating each. Sorted by id for deterministic output
 * regardless of filesystem directory-listing order. A malformed/unreadable
 * individual file, or an entirely missing/unreadable seed dir, is logged and
 * skipped rather than thrown, so main-process startup is never blocked by a
 * bad or absent bundle. Duplicate ids across files keep the first (by
 * filename order) and skip + log the rest.
 */
export function loadClientSeeds(dir: string = getClientSeedRoot()): ClientSeed[] {
  let filenames: string[];
  try {
    filenames = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch (e) {
    console.warn(
      `[clients] Seed dir unreadable (${dir}); no default clients seeded:`,
      (e as Error).message
    );
    return [];
  }

  const seeds: ClientSeed[] = [];
  const seenIds = new Set<string>();

  for (const filename of filenames) {
    const filePath = path.join(dir, filename);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const seed = parseClientSeed(raw);
      if (seenIds.has(seed.id)) {
        console.warn(`[clients] Duplicate seed id "${seed.id}" in ${filename}; skipping`);
        continue;
      }
      seenIds.add(seed.id);
      seeds.push(seed);
    } catch (e) {
      console.warn(
        `[clients] Skipping malformed client seed file ${filename}:`,
        (e as Error).message
      );
    }
  }

  return seeds.sort((a, b) => a.id.localeCompare(b.id));
}
