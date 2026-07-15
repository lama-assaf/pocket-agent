// src/clients/seed.ts
// Bundled client (brand) seeds so known clients are available in-app at first
// launch, without an operator having to hand-create them. Each seed carries its
// `how_to_act` voice facts (see src/agent/how-to-act.ts), starter `lesson`
// facts (the Brain panel's Lessons tab, category 'lesson'), and the
// marketplace agents it should have explicitly enabled
// (src/marketplace/enablement.ts), so a brand shows up already voiced,
// lessoned, and wired to the right specialists.
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

/** One marketplace agent to explicitly enable for a client's scope. */
export interface ClientSeedAgent {
  packId: string;
  agentName: string;
}

export interface ClientSeed {
  id: string;
  name: string;
  syncMode?: ClientSyncMode;
  /** `how_to_act` facts (voice/tone/instincts/banned_words) seeded at `client:<id>` scope. */
  facts: ClientSeedFact[];
  /** `lesson`-category facts seeded at `client:<id>` scope (Brain panel Lessons tab). */
  lessons: ClientSeedLesson[];
  /** Atelier/Salon agents wired to this brand via explicit `enabled-agents` facts. */
  agents: ClientSeedAgent[];
}

/**
 * Zilliqa — the "category" voice (permissionless onchain finance, the
 * mediation layer). Extracted from Zilliqa-comms: `brand/voice-guide.md`
 * (voice/vocabulary/tone-by-surface), `.atelier/memory/instincts.md`
 * (the locked Zilliqa x LTIN comms ground truth), and `.atelier/memory/
 * lessons.md` (dated, brand-specific takeaways — NOT the atelier
 * marketplace pack's own generic template examples, which lessons.md still
 * carries unremoved and which must never be mistaken for real Zilliqa
 * history).
 */
const ZILLIQA_SEED: ClientSeed = {
  id: 'zilliqa',
  name: 'Zilliqa',
  syncMode: 'manual',
  facts: [
    {
      subject: 'voice',
      content:
        "Understated, evidence-first, institutional — the restraint is the brand. Never claims ahead of what's shipped; proof does the persuading ('No claim without something shipped behind it'). Say the mechanism, not the magic: explain concretely how something works, no mystique. Speaks to regulated institutional finance in precise vocabulary (settlement, mediation, credentials, policy, compliance, validation fees). Short, declarative, structurally parallel sentences; the semicolon and the comma-fronted conditional are the punctuation signature (em dash is occasional, not the tell). Economics stated plainly, never hyped. Point of view: 'we' for commitments/intent, 'you' for the builder/partner, third person/neutral for mechanism explanations. Figurative range is minimal — almost entirely literal, no jokes, no winking.",
    },
    {
      subject: 'tone',
      content:
        "Category identity: 'the named leader of permissionless onchain finance' is approved in Zilliqa voice, and 'creates a new category' as vision — but proof discipline stays fierce: claim the category, never an unshipped capability as done. By surface: homepage hero is confident/compact (fragments allowed); roadmap is disciplined/evidence-led (every milestone pairs a deliverable with its proof); FAQ is plain/reassuring (reader's-words questions, literal answers); technical pillars are explanatory and precise even at length; CTAs are calm and literal ('Start Building', 'Partner With Us') — never urgency theater.",
    },
    {
      subject: 'instincts',
      content:
        "Locked Zilliqa x LTIN ground truth: role split is LTIN issues the vLEI credential -> Zilliqa's mediation layer enforces it before settlement -> settlement is joint, on any chain. Never merge the LTIN and Zilliqa narratives in one output; Zilliqa cites LTIN only as 'the sovereign substrate' (subordinate cross-ref), never as an equal narrator. The mediation layer is a blockchain in its own right — it mediates (checks credential + policy before settlement) AND can also facilitate settlement, agnostic to the settlement network, non-custodial; never say it 'steps aside' or 'settles nothing'. Figures: Zilliqa-solo leads with confirmed current numbers (~$33T stablecoin transfers FY2025) and attributes any projection; joint/LTIN-aligned assets use the BCG $16T-by-2030 figure instead. Milestone dates are published as accountability commitments ('dates you can hold us to'), not blanket-confidential. Never present-tense LTIN's GLEIF accreditation as done, though 'the vLEI is a GLEIF-governed, ISO 17442 credential' is approved.",
    },
    {
      subject: 'banned_words',
      content:
        'revolutionary, game-changing, cutting-edge, world-class, unleash, supercharge, the best, the leading, the #1, sign up now, mediation not settlement, settlement stays where it is, validation not settlement per transaction, settles nothing, clears no trades, cannot be the layer that settles, steps aside, zilliqa vs solana tps, why zilliqa chose liechtenstein',
    },
  ],
  lessons: [
    {
      subject: 'canon reconciliation must sweep every surface',
      content:
        "When a claim or wedge is reconciled and phrases are banned, the sweep must cover every surface the campaign lives on, not just repo markdown. A banned-phrase check against only local files missed the same retired language ('settles nothing', 'clears no trades', 'steps aside', 'cannot be the layer that settles') sitting live in the master content-calendar Google Doc, which lags repo canon by weeks. Re-run banned-phrase sweeps against the Doc export whenever ground truth changes.",
    },
    {
      // Replaces a prior entry that was actually the atelier marketplace
      // pack's own generic onboarding-template example lesson ("brand voice
      // extraction skipped, copy drift accelerated" — see src/marketplace/
      // seed/atelier/memory/lessons.md's "(delete these once you have your
      // own.)" examples), never a real Zilliqa-specific takeaway. This is
      // the project's actual second dated lesson from `.atelier/memory/
      // lessons.md`.
      subject: "reconciled canon to LTIN's authoritative OneDrive positioning docs",
      content:
        "Derived instincts drift from the principals' own source docs over weeks — the board decks used to draft this brand's memory were a SUPERSEDED source that still carried CEO-retired language. When a canon dispute arises, go to the source-owner's approved docs (LTIN's AL-approved OneDrive positioning set) before picking a side; don't arbitrate from secondary/derived notes.",
    },
  ],
  agents: [
    { packId: 'atelier', agentName: 'copywriter' },
    { packId: 'atelier', agentName: 'brand-voice-keeper' },
    { packId: 'atelier', agentName: 'narrative-architect' },
    { packId: 'salon', agentName: 'campaign-strategist' },
    { packId: 'salon', agentName: 'community-manager' },
    { packId: 'salon', agentName: 'engagement-manager' },
  ],
};

/**
 * LTIN (Liechtenstein Trust and Integrity Network) — the "authority" voice
 * (sovereignty, standards, identity, governance). Extracted from
 * LTIN-comms: `.atelier/memory/voice.md`, `instincts.md`, and `project.md`
 * (the LTIN x Zilliqa twin-narrative project brief).
 */
const LTIN_SEED: ClientSeed = {
  id: 'ltin',
  name: 'LTIN',
  syncMode: 'manual',
  facts: [
    {
      subject: 'voice',
      content:
        "A sovereign institution speaking to regulators, banks, and standards bodies — sober, structural, standards-first. Cares about legal accountability, jurisdiction, and proof; would never hype, never self-certify legitimacy, never claim a layer before it ships. More formal, more buttoned-up, and more polished than Zilliqa's register; confident on shipped facts, carefully hedged on roadmap items. Shared spine with Zilliqa: 'open by default, accountable by design' — sober beats hype, and if a regulator would wince, rewrite it. Signature lines: 'Products win quarters; standards win decades', 'Be the source in the footnote, not the footnote', 'Our root is a standard, not a login'.",
    },
    {
      subject: 'tone',
      content:
        "X (LTIN): short thesis/standards/proof/vision posts, Tue-Thu mornings plus mid-afternoon, sober authority register. LinkedIn (LTIN): long-form authority essays ('why start at identity', standards-authority pieces) — loosen less than you think. LTIN cites Zilliqa only as 'the flagship deployment of LTIN's platform', never as an equal narrator, never merging the two streams in one output.",
    },
    {
      subject: 'instincts',
      content:
        "Twin-narrative single-pillar test (never skip): before publishing, ask which single pillar a piece serves — LTIN carries authority (sovereignty, standards, identity, governance), Zilliqa carries category (mediation, permissionless onchain finance). 'Both streams' -> split into two outputs; 'neither' -> kill it. Proof discipline: content without proof is noise, every claim traces to a shipped component; a regulator or standards body citing LTIN is proof, a product launch is not. QVI status is the single point of catastrophic failure — regulatory/GLEIF-accreditation claims stay gated until secured, never claimed ahead of shipping. Stealth topics, never public until proven: Alatau/Kazakhstan trade hub, China/EU corridors, agentic AI (MCP/x402), academic partners, SCION/SSFN, GSMA Verifiable Calling. Spokespeople: AL - Andres Luther (narrative/comms lead, approves evergreen copy), AZ - Alexander Zahnd (program lead, vLEI Issuer/GLEIF-QVI path), SU - Sacha Uhlmann (mediation layer/protocol lead).",
    },
    {
      subject: 'banned_words',
      content:
        "revolutionary, game-changing, the future of, disrupt, 10x, synergy, circle back, zilliqa vs solana tps, why zilliqa chose liechtenstein, zilliqa enables liechtenstein's sovereign vision, mediation not settlement, settlement stays where it is",
    },
  ],
  lessons: [
    {
      subject: 'positioning evolved hard — use the May–June 2026 material, not June 2025',
      content:
        "The earliest strategy asset (June 2025) frames LTIN generically as 'the regulatory-compliant blockchain infrastructure leader' — renewable energy, data sovereignty, competing with AWS/Infura. The May–June 2026 board decks are a completely different, sharper strategy: twin narrative (LTIN authority / Zilliqa category), the vLEI value chain, mediation-above-settlement, ZIL as meter, revenue-vs-subsidy proof. Default to the 2026 material for all positioning and proof; treat the 2025 doc as historical context only — publishing the old framing would sound generic and merge the streams the new strategy works hard to keep apart.",
    },
    {
      subject: 'gate confidential material before it reaches public content',
      content:
        'Memory synthesized from internal board decks (several marked confidential) surfaces the richest material — stakeholder maps, opposition architecture, stealth track, ZIL economics — but most of it is internal only. When drafting public content, pull the principle and mechanism, but gate anything naming unshipped partners, numbers, or stealth items (Alatau, China/EU corridors, agentic AI, academic partners, SCION/SSFN, GSMA). Leaking a stealth item or an unshipped partner number would break proof discipline before anchors are validated.',
    },
  ],
  agents: [
    { packId: 'atelier', agentName: 'copywriter' },
    { packId: 'atelier', agentName: 'brand-voice-keeper' },
    { packId: 'atelier', agentName: 'narrative-architect' },
    { packId: 'salon', agentName: 'campaign-strategist' },
    { packId: 'salon', agentName: 'community-manager' },
    { packId: 'salon', agentName: 'engagement-manager' },
  ],
};

/** Bundled client seeds, applied once each at first launch (see seedDefaultClients). */
export const DEFAULT_CLIENT_SEEDS: ClientSeed[] = [ZILLIQA_SEED, LTIN_SEED];

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
      memory.createClient({ id: seed.id, name: seed.name, syncMode: seed.syncMode ?? 'manual' });
    }
    ensureScaffold(seed.id);

    for (const fact of seed.facts) {
      memory.saveFact(HOW_TO_ACT_CATEGORY, fact.subject, fact.content, false, scope);
    }
    for (const lesson of seed.lessons) {
      memory.saveFact('lesson', lesson.subject, lesson.content, false, scope);
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
