// src/clients/seed.ts
// Bundled client (brand) seeds so known clients are available in-app at first
// launch, without an operator having to hand-create them. Each seed carries its
// `how_to_act` voice facts (see src/agent/how-to-act.ts), starter `lesson`
// facts (the Brain panel's Lessons tab, category 'lesson'), and the
// marketplace agents it should have explicitly enabled
// (src/marketplace/enablement.ts), so a brand shows up already voiced,
// lessoned, and wired to the right specialists.
//
// The actual seed content (Zilliqa, LTIN, ...) lives in bundled JSON — see
// src/clients/seed-loader.ts for how it's found/validated at runtime (dev vs
// packaged) — so ops can add or change a default pre-filled client without a
// code change. DEFAULT_CLIENT_SEEDS below is that loader's output, kept as
// this module's default so existing callers/tests need no changes; the
// src/main/index.ts call site loads explicitly at the point of use too.
//
// Seeding writes through the same paths a human would use in-app (createClient
// + saveFact), never a parallel storage path — so seeded clients are
// indistinguishable from ones created by hand.
//
// Backfill, not just first-create: a client row can already exist with zero
// facts (hand-created via the Clients picker before this seed ever ran, or a
// prior partial seed) — creation alone is NOT a reliable "already seeded"
// signal. So the gate for writing facts is "this scope has no how_to_act fact
// yet," independent of whether the client row itself is new. That backfills
// an empty pre-existing client exactly once, while never clobbering a real
// how_to_act edit an operator already made (its mere presence, of any
// subject, is enough to skip re-seeding that scope for good).

import type { ClientSyncMode } from '../memory/clients';
import { clientScope } from '../memory/scope';
import { HOW_TO_ACT_CATEGORY } from '../agent/how-to-act';
import { ENABLED_AGENTS_CATEGORY, agentEnablementSubject } from '../marketplace/enablement';
import { loadClientSeeds } from './seed-loader';

/** Fact category the Brain panel's Facts tab writes/reads (ui/chat/brain-panel.js's default `category`). */
export const GENERAL_FACT_CATEGORY = 'fact';

/** One `how_to_act` fact to seed for a client (subject 'voice' | 'tone' | 'instincts' | 'banned_words'). */
export interface ClientSeedFact {
  subject: string;
  content: string;
}

/** One starter `lesson` fact (Brain panel Lessons tab). Subject is a short free-text label, may be ''. */
export interface ClientSeedLesson {
  subject: string;
  content: string;
}

/**
 * One starter general-memory fact (Brain panel Facts tab, `category: 'fact'`)
 * — brand knowledge that isn't voice/tone/instincts/banned_words and isn't a
 * lesson-learned: key people, product facts, standing preferences. Named
 * `generalFacts` (JSON: `general_facts`) rather than `facts` because that
 * name is already taken by the how_to_act facts below — keeping the existing
 * field's meaning unchanged is what keeps bundled zilliqa/ltin seeds loading
 * unchanged.
 */
export interface ClientSeedGeneralFact {
  subject: string;
  content: string;
}

/** One marketplace agent to explicitly enable for a client's scope. */
export interface ClientSeedAgent {
  packId: string;
  agentName: string;
}

export interface ClientSeed {
  id: string;
  name: string;
  syncMode?: ClientSyncMode;
  /**
   * Optional git remote for this brand's brain. When present, it's set on the
   * created client row (never on an already-existing row — same no-clobber
   * rule as facts). Combined with `syncMode: 'live'` and a configured GitHub
   * token, the existing on-launch auto-pull (autoPullLiveClients, run right
   * after seeding in src/main/index.ts) picks it up and pulls real shared
   * content — no separate/duplicated pull call needed here.
   */
  repoUrl?: string;
  /** `how_to_act` facts (voice/tone/instincts/banned_words) seeded at `client:<id>` scope. */
  facts: ClientSeedFact[];
  /** `lesson`-category facts seeded at `client:<id>` scope (Brain panel Lessons tab). */
  lessons: ClientSeedLesson[];
  /**
   * Optional `fact`-category facts (Brain panel Facts tab) seeded at
   * `client:<id>` scope — general brand memories distinct from voice/tone
   * (`facts`) and learnings (`lessons`). Absent/empty is fine: existing
   * bundles (zilliqa, ltin) predate this field and load unchanged.
   */
  generalFacts?: ClientSeedGeneralFact[];
  /** Atelier/Salon agents wired to this brand via explicit `enabled-agents` facts. */
  agents: ClientSeedAgent[];
}

/**
 * Bundled client seeds, applied once each at first launch (see
 * seedDefaultClients). Loaded + schema-validated from bundled JSON (see
 * src/clients/seed-loader.ts); a missing/malformed bundle degrades to an
 * empty array (no default clients seeded) rather than throwing at import
 * time.
 */
export const DEFAULT_CLIENT_SEEDS: ClientSeed[] = loadClientSeeds();

/** Minimal fact shape the seeding backfill check needs. */
export interface SeedFactRow {
  category: string;
  scope: string;
}

/** Memory-store surface seeding needs — a subset of MemoryManager, mirroring src/clients/export.ts's ExportMemory pattern. */
export interface SeedMemory {
  getClients(): { id: string }[];
  createClient(input: {
    id: string;
    name: string;
    syncMode?: ClientSyncMode;
    repoUrl?: string | null;
  }): unknown;
  getAllFacts(): SeedFactRow[];
  saveFact(
    category: string,
    subject: string,
    content: string,
    sensitive?: boolean,
    scope?: string
  ): number;
}

/**
 * Ensure every bundled client exists and is voiced: creates a missing client
 * row, and — independent of whether the row was just created or already
 * existed — backfills its `how_to_act` voice facts, starter `lesson` facts,
 * and explicit agent-enablement facts whenever that scope has no
 * `how_to_act` fact yet. A client hand-created via the Clients picker before
 * this seed ran (or seeded by an older build that only wrote a bare client
 * row) is exactly that case: creation alone is not a reliable "already
 * seeded" signal, so the gate checks the facts store directly. Once a scope
 * has any `how_to_act` fact (seeded or hand-authored), it is left alone for
 * good — this never overwrites an operator's edits.
 * `ensureScaffold` materializes the on-disk `.atelier/memory` + `guardrails`
 * scaffold (injected so this module stays Electron-free, like the rest of
 * src/clients/); callers pass `ensureClientScaffold` from ./registry.
 * Returns the ids of clients that were newly created OR backfilled.
 */
export function seedDefaultClients(
  memory: SeedMemory,
  ensureScaffold: (id: string) => void,
  seeds: ClientSeed[] = DEFAULT_CLIENT_SEEDS
): string[] {
  const existingClients = new Set(memory.getClients().map((c) => c.id));
  const scopesWithVoice = new Set(
    memory
      .getAllFacts()
      .filter((f) => f.category === HOW_TO_ACT_CATEGORY)
      .map((f) => f.scope)
  );
  const touched: string[] = [];

  for (const seed of seeds) {
    const scope = clientScope(seed.id);
    if (scopesWithVoice.has(scope)) continue; // already voiced — never re-seed or clobber

    if (!existingClients.has(seed.id)) {
      memory.createClient({
        id: seed.id,
        name: seed.name,
        syncMode: seed.syncMode ?? 'manual',
        repoUrl: seed.repoUrl,
      });
    }
    ensureScaffold(seed.id);

    for (const fact of seed.facts) {
      memory.saveFact(HOW_TO_ACT_CATEGORY, fact.subject, fact.content, false, scope);
    }
    for (const lesson of seed.lessons) {
      memory.saveFact('lesson', lesson.subject, lesson.content, false, scope);
    }
    for (const generalFact of seed.generalFacts ?? []) {
      memory.saveFact(
        GENERAL_FACT_CATEGORY,
        generalFact.subject,
        generalFact.content,
        false,
        scope
      );
    }
    for (const agent of seed.agents) {
      memory.saveFact(
        ENABLED_AGENTS_CATEGORY,
        agentEnablementSubject(agent.packId, agent.agentName),
        'true',
        false,
        scope
      );
    }

    touched.push(seed.id);
  }

  return touched;
}
