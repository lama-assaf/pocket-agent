/**
 * Retrieval-QUALITY benchmark for the docs-import -> recallable-memory
 * pipeline — the gap beyond isolation coverage (tests/unit/scoped-memory.test.ts's
 * 'Brand A cannot recall Brand B', and docs-import.test.ts's real-embeddings
 * cross-client isolation tests). Those only prove presence/absence (does the
 * right scope's content ever leak). This proves something different: given a
 * realistic multi-topic doc set actually imported through the real pipeline
 * (importDocsIntoClient -> AtelierMemoryBridge.mirrorDocsDir -> chunkText ->
 * saveFact -> real MiniLM embeddings), does semantic search reliably surface
 * the RIGHT doc for a query about its topic — a basic precision/recall
 * regression guard for future chunking/embedding changes.
 *
 * Deterministic by construction: MiniLM inference has no sampling/randomness,
 * so the same fixed docs + fixed queries + pinned model version
 * (Xenova/all-MiniLM-L6-v2, dtype: 'fp32' — see src/memory/embeddings.ts)
 * produce the same embeddings and the same ranking on every run. The 8
 * query->doc pairs below were chosen to be topically well-separated (pricing
 * vs. privacy vs. brand voice vs. support vs. architecture vs. social media
 * vs. onboarding vs. sales objections) specifically so this isn't a
 * borderline/ambiguous benchmark that could flip on minor embedding drift.
 *
 * Uses the real model (not mocked) — same as docs-import.test.ts's isolation
 * tests — so this needs the model available/cached; see embeddings.ts. Timeout
 * bumped per-test to comfortably cover a cold model load.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { importDocsIntoClient } from '../../src/clients/docs-import';
import { setClientsRoot } from '../../src/clients/paths';
import type { AtelierBridgeMemory } from '../../src/memory/atelier-bridge';
import { saveFact, getFactsByCategory, deleteFact, createFactsCache } from '../../src/memory/facts';
import { backfillMissingEmbeddings, semanticSearchFacts } from '../../src/memory/semantic';
import { embedText } from '../../src/memory/embeddings';

/** Fixture doc set: 8 topically distinct docs, one clear "home topic" each. */
const FIXTURE_DOCS: Record<string, string> = {
  'product/pricing.md': `# Pricing
We offer three billing plans: Starter, Growth, and Enterprise. Each pricing
tier includes a different number of seats and monthly usage credits. Annual
billing gets a 15% discount versus monthly billing. Enterprise plans include
custom invoicing and volume pricing negotiated directly with sales.`,

  'legal/privacy-policy.md': `# Privacy Policy
We collect only the personal data necessary to provide the service and never
sell it to third parties. Users in the EU are protected under GDPR and can
request data deletion or export at any time. We retain data only as long as
an account remains active plus a short grace period for backups.`,

  'brand/voice.md': `# Brand Voice
Our brand voice is bold, playful, and confident, never stiff or corporate.
We write like a knowledgeable friend, not a press release. Humor is welcome
but clarity always wins — never sacrifice understanding for a clever line.`,

  'support/faq.md': `# Support FAQ
If something isn't working, first check the status page for known outages.
Refund requests within 14 days of purchase are approved automatically. For
anything else, our support team replies within one business day on all
plans, and same-day on Enterprise.`,

  'engineering/architecture.md': `# System Architecture
The backend is a set of services behind an API gateway, backed by a
relational database for transactional data and a queue for async jobs. Each
service owns its own schema; cross-service reads go through published
events rather than direct database access.`,

  'marketing/social-media-calendar.md': `# Social Media Calendar
We post three times a week across our main channels: a product update on
Monday, a customer story on Wednesday, and a behind-the-scenes post on
Friday. Major launches get an extra coordinated post across every channel
the same day.`,

  'hr/onboarding-guide.md': `# New Employee Onboarding
On your first day you'll get your laptop, accounts, and a welcome chat with
your manager. Benefits enrollment (health, dental, retirement matching)
opens during your first week and must be completed within 30 days of your
start date.`,

  'sales/objection-handling.md': `# Objection Handling
When a prospect compares us to a cheaper competitor, focus on total cost of
ownership and support quality rather than matching price directly. When
asked about a missing feature, acknowledge the gap honestly and point to the
roadmap rather than overselling.`,
};

/** query -> expected doc subject (as it will appear post-import, `docs/<path>`). */
const QUERY_CASES: Array<{ query: string; expectedSubject: string }> = [
  { query: 'What are our pricing tiers and billing plans?', expectedSubject: 'docs/product/pricing.md' },
  {
    query: 'How do we handle customer data privacy and GDPR requests?',
    expectedSubject: 'docs/legal/privacy-policy.md',
  },
  { query: "What's our brand voice and tone?", expectedSubject: 'docs/brand/voice.md' },
  {
    query: 'How do I request a refund or get help with something broken?',
    expectedSubject: 'docs/support/faq.md',
  },
  {
    query: 'Describe our backend system architecture and database design.',
    expectedSubject: 'docs/engineering/architecture.md',
  },
  {
    query: "What's our social media posting schedule and content calendar?",
    expectedSubject: 'docs/marketing/social-media-calendar.md',
  },
  {
    query: "What happens on a new employee's first day, and how do benefits work?",
    expectedSubject: 'docs/hr/onboarding-guide.md',
  },
  {
    query: 'How should sales respond when a prospect compares us to a cheaper competitor?',
    expectedSubject: 'docs/sales/objection-handling.md',
  },
];

/** How many top results we allow before considering a query "missed" — generous enough to absorb near-topic overlap without masking a real regression. */
const TOP_K = 3;

describe('retrieval quality benchmark — real docs-import pipeline, real embeddings', () => {
  let clientsRoot: string;
  let sourceDir: string;
  let db: Database.Database;
  const clientId = 'acme';

  beforeAll(
    async () => {
      clientsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-quality-clients-'));
      setClientsRoot(clientsRoot);
      sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'retrieval-quality-source-'));
      for (const [rel, content] of Object.entries(FIXTURE_DOCS)) {
        const abs = path.join(sourceDir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf-8');
      }

      db = new Database(':memory:');
      db.exec(`
        CREATE TABLE facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'user',
          importance INTEGER DEFAULT 50,
          sensitive INTEGER DEFAULT 0,
          last_accessed_at TEXT,
          created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
          updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
          embedding BLOB,
          content_hash TEXT
        );
        CREATE TABLE soul (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          aspect TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding BLOB
        );
        CREATE TABLE daily_log_rollups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content TEXT NOT NULL,
          embedding BLOB
        );
      `);
      const cache = createFactsCache();
      const memory: AtelierBridgeMemory = {
        saveFact: (category, subject, content, sensitive, scope) =>
          saveFact(db, category, subject, content, cache, sensitive, scope),
        getFactsByCategory: (category) => getFactsByCategory(db, category),
        deleteFact: (id) => deleteFact(db, id, cache),
      };

      await importDocsIntoClient({ clientId, sourceDir, ingestToMemory: true, memory });
      // Force every fire-and-forget embedFactAsync call to actually land
      // before any query runs — no reliance on timing.
      await backfillMissingEmbeddings(db);

      // Sanity: every fixture doc actually made it into memory as exactly one
      // fact each (none of them are large enough to get chunked) — if this
      // fails, the benchmark below is measuring the wrong thing.
      const rows = getFactsByCategory(db, 'atelier-memory');
      expect(rows).toHaveLength(Object.keys(FIXTURE_DOCS).length);
    },
    30000
  );

  afterAll(() => {
    db.close();
    setClientsRoot('');
    fs.rmSync(clientsRoot, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it.each(QUERY_CASES)(
    'top-$TOP_K recall for "$query" includes $expectedSubject',
    async ({ query, expectedSubject }) => {
      const queryVector = await embedText(query);
      const hits = semanticSearchFacts(db, queryVector, TOP_K);
      const subjects = hits.map((h) => h.subject);
      expect(subjects).toContain(expectedSubject);
    },
    30000
  );

  it(
    'aggregate hit-rate across the whole benchmark stays at or above 75% (regression guard, not just per-query)',
    async () => {
      let hits = 0;
      for (const { query, expectedSubject } of QUERY_CASES) {
        const queryVector = await embedText(query);
        const results = semanticSearchFacts(db, queryVector, TOP_K).map((h) => h.subject);
        if (results.includes(expectedSubject)) hits++;
      }
      const hitRate = hits / QUERY_CASES.length;
      console.log(`[retrieval-quality] hit-rate: ${hits}/${QUERY_CASES.length} (${(hitRate * 100).toFixed(0)}%)`);
      expect(hitRate).toBeGreaterThanOrEqual(0.75);
    },
    30000
  );
});
