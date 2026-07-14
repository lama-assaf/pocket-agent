// src/clients/seed.ts
// Bundled client (brand) seeds so known clients are available in-app at first
// launch, without an operator having to hand-create them. Each seed carries its
// `how_to_act` voice facts (see src/agent/how-to-act.ts) and the marketplace
// agents it should have explicitly enabled (src/marketplace/enablement.ts),
// so a brand shows up already voiced and wired to the right specialists.
//
// Seeding writes through the same paths a human would use in-app (createClient
// + saveFact), never a parallel storage path — so seeded clients are
// indistinguishable from ones created by hand, and re-running seeding is a
// no-op once a client id exists.

import type { ClientSyncMode } from '../memory/clients';
import { clientScope } from '../memory/scope';
import { HOW_TO_ACT_CATEGORY } from '../agent/how-to-act';
import { ENABLED_AGENTS_CATEGORY, agentEnablementSubject } from '../marketplace/enablement';

/** One `how_to_act` fact to seed for a client (subject 'voice' | 'tone' | 'instincts' | 'banned_words'). */
export interface ClientSeedFact {
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
  /** Atelier/Salon agents wired to this brand via explicit `enabled-agents` facts. */
  agents: ClientSeedAgent[];
}

/**
 * Zilliqa — the "category" voice (permissionless onchain finance, the
 * mediation layer). Extracted from Zilliqa-comms: `brand/voice-guide.md`
 * (voice/vocabulary/tone-by-surface) and `.atelier/memory/instincts.md`
 * (the locked Zilliqa x LTIN comms ground truth).
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

/** Memory-store surface seeding needs — a subset of MemoryManager, mirroring src/clients/export.ts's ExportMemory pattern. */
export interface SeedMemory {
  getClients(): { id: string }[];
  createClient(input: {
    id: string;
    name: string;
    syncMode?: ClientSyncMode;
    repoUrl?: string | null;
  }): unknown;
  saveFact(
    category: string,
    subject: string,
    content: string,
    sensitive?: boolean,
    scope?: string
  ): number;
}

/**
 * Create any bundled client that doesn't already exist, seeding its
 * `how_to_act` voice facts and explicit agent enablement facts. Idempotent —
 * an existing client id is left untouched (never overwrites operator edits).
 * `ensureScaffold` materializes the on-disk `.atelier/memory` + `guardrails`
 * scaffold (injected so this module stays Electron-free, like the rest of
 * src/clients/); callers pass `ensureClientScaffold` from ./registry.
 * Returns the ids of clients actually created.
 */
export function seedDefaultClients(
  memory: SeedMemory,
  ensureScaffold: (id: string) => void,
  seeds: ClientSeed[] = DEFAULT_CLIENT_SEEDS
): string[] {
  const existing = new Set(memory.getClients().map((c) => c.id));
  const created: string[] = [];

  for (const seed of seeds) {
    if (existing.has(seed.id)) continue;

    memory.createClient({ id: seed.id, name: seed.name, syncMode: seed.syncMode ?? 'manual' });
    ensureScaffold(seed.id);

    const scope = clientScope(seed.id);
    for (const fact of seed.facts) {
      memory.saveFact(HOW_TO_ACT_CATEGORY, fact.subject, fact.content, false, scope);
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

    created.push(seed.id);
  }

  return created;
}
