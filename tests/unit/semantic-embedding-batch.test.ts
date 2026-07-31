/**
 * Batched/retryable/resumable embedding pipeline (src/memory/semantic.ts +
 * src/memory/embeddings.ts). Mocks '../../src/memory/embeddings' so these
 * tests run instantly against a real in-memory `facts` table without ever
 * loading the actual MiniLM model — the thing under test is the retry/batch/
 * resumability logic in semantic.ts, not the model itself (that's covered by
 * tests/unit/embeddings.test.ts's cosineSimilarity/serialize round-trips).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { EMBEDDING_DIM } from '../../src/memory/embeddings';

const embedTextMock = vi.fn();
const embedTextBatchMock = vi.fn();

vi.mock('../../src/memory/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/embeddings')>();
  return {
    ...actual,
    embedText: (...args: [string]) => embedTextMock(...args),
    embedTextBatch: (...args: [string[]]) => embedTextBatchMock(...args),
  };
});

// Imported AFTER the mock is registered so semantic.ts picks up the mocked embeddings module.
const {
  embedFact,
  embedFactsBatch,
  backfillMissingEmbeddings,
  getPendingFactEmbeddingCount,
  retryEmbedding,
} = await import('../../src/memory/semantic');

function vec(seed: number): Float32Array {
  // Deterministic per-seed vector so tests can assert content by identity
  // without caring about real embedding semantics.
  return Float32Array.from({ length: EMBEDDING_DIM }, (_, i) => seed + i * 0.001);
}

describe('batched/retryable/resumable embedding pipeline', () => {
  let db: Database.Database;

  beforeEach(() => {
    embedTextMock.mockReset();
    embedTextBatchMock.mockReset();
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        embedding BLOB
      );
      -- backfillMissingEmbeddings also queries soul/daily_log_rollups; empty
      -- tables here since these tests focus on the facts batching path.
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
  });

  const insertFact = (subject: string, content: string): number => {
    const result = db
      .prepare('INSERT INTO facts (category, subject, content) VALUES (?, ?, ?)')
      .run('info', subject, content);
    return result.lastInsertRowid as number;
  };

  const embeddingIsNull = (id: number): boolean => {
    const row = db.prepare('SELECT embedding FROM facts WHERE id = ?').get(id) as {
      embedding: Buffer | null;
    };
    return row.embedding === null;
  };

  // ── retryEmbedding + single-row embedFact retry ─────────────────────────────

  describe('retryEmbedding', () => {
    it('returns the result on the first success without retrying', async () => {
      const fn = vi.fn(async () => 'ok');
      await expect(retryEmbedding(fn)).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries a failing fn and returns the eventual success', async () => {
      let calls = 0;
      const fn = vi.fn(async () => {
        calls++;
        if (calls < 3) throw new Error(`transient failure #${calls}`);
        return 'succeeded on 3rd try';
      });

      await expect(retryEmbedding(fn, 3)).resolves.toBe('succeeded on 3rd try');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws the last error after exhausting all attempts', async () => {
      const fn = vi.fn(async () => {
        throw new Error('always fails');
      });

      await expect(retryEmbedding(fn, 3)).rejects.toThrow('always fails');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('embedFact (single-row path) retries embedText before degrading to NULL', () => {
    it('a mocked embedText that fails twice then succeeds still lands a non-null embedding', async () => {
      const id = insertFact('voice', 'Playful and bold brand voice.');
      let calls = 0;
      embedTextMock.mockImplementation(async () => {
        calls++;
        if (calls < 3) throw new Error(`transient embedText failure #${calls}`);
        return vec(7);
      });

      await embedFact(db, id);

      expect(calls).toBe(3); // 2 failures + 1 success, all within one embedFact call
      expect(embeddingIsNull(id)).toBe(false);
    });

    it('embedText failing on every attempt leaves embedding=NULL (never throws out of embedFact)', async () => {
      const id = insertFact('voice', 'Content that will never embed.');
      embedTextMock.mockImplementation(async () => {
        throw new Error('model permanently unavailable');
      });

      await expect(embedFact(db, id)).resolves.toBeUndefined(); // never throws
      expect(embeddingIsNull(id)).toBe(true);
      expect(embedTextMock).toHaveBeenCalledTimes(3); // exhausted all retry attempts
    });
  });

  // ── embedTextBatch ordering (exercised through embedFactsBatch) ─────────────

  describe('embedFactsBatch', () => {
    it('writes vectors to the correct rows in input order (embedTextBatch order is preserved)', async () => {
      const idA = insertFact('a', 'Alpha content');
      const idB = insertFact('b', 'Bravo content');
      const idC = insertFact('c', 'Charlie content');

      embedTextBatchMock.mockImplementation(async (texts: string[]) =>
        texts.map((_, i) => vec(100 + i))
      );

      const result = await embedFactsBatch(db, [idA, idB, idC]);

      expect(result).toEqual({ embedded: 3, failed: 0 });
      expect(embedTextBatchMock).toHaveBeenCalledTimes(1); // one batch, one model call
      // Each row got the embedding at its OWN position, not a neighbor's.
      for (const [id, expectedSeed] of [
        [idA, 100],
        [idB, 101],
        [idC, 102],
      ] as const) {
        const row = db.prepare('SELECT embedding FROM facts WHERE id = ?').get(id) as {
          embedding: Buffer;
        };
        const stored = new Float32Array(
          row.embedding.buffer.slice(
            row.embedding.byteOffset,
            row.embedding.byteOffset + row.embedding.byteLength
          )
        );
        expect(stored[0]).toBeCloseTo(expectedSeed, 5);
      }
    });

    it('chunks ids into multiple batches of batchSize, one embedTextBatch call per chunk', async () => {
      const ids = Array.from({ length: 10 }, (_, i) => insertFact(`s${i}`, `content ${i}`));
      embedTextBatchMock.mockImplementation(async (texts: string[]) =>
        texts.map((_, i) => vec(i))
      );

      const result = await embedFactsBatch(db, ids, 4); // batchSize=4 -> 3 calls (4,4,2)

      expect(result).toEqual({ embedded: 10, failed: 0 });
      expect(embedTextBatchMock).toHaveBeenCalledTimes(3);
      expect(embedTextBatchMock.mock.calls[0][0]).toHaveLength(4);
      expect(embedTextBatchMock.mock.calls[1][0]).toHaveLength(4);
      expect(embedTextBatchMock.mock.calls[2][0]).toHaveLength(2);
      for (const id of ids) expect(embeddingIsNull(id)).toBe(false);
    });

    it('a batch that fails every retry attempt is left at embedding=NULL without throwing, and does not block other batches', async () => {
      const failingIds = [insertFact('fail1', 'x'), insertFact('fail2', 'y')];
      const okIds = [insertFact('ok1', 'z'), insertFact('ok2', 'w')];

      let call = 0;
      embedTextBatchMock.mockImplementation(async (texts: string[]) => {
        call++;
        if (call <= 3) {
          // First batch (failingIds) fails on all 3 retry attempts.
          throw new Error('batch embedding failed');
        }
        return texts.map((_, i) => vec(i));
      });

      const result = await embedFactsBatch(db, [...failingIds, ...okIds], 2);

      expect(result).toEqual({ embedded: 2, failed: 2 });
      for (const id of failingIds) expect(embeddingIsNull(id)).toBe(true);
      for (const id of okIds) expect(embeddingIsNull(id)).toBe(false);
    });

    it('writes a batch atomically via one transaction (all-or-nothing for that batch)', async () => {
      const ids = [insertFact('a', 'x'), insertFact('b', 'y')];
      let transactionSpyCalled = false;
      const realTransaction = db.transaction.bind(db);
      vi.spyOn(db, 'transaction').mockImplementation((fn) => {
        transactionSpyCalled = true;
        return realTransaction(fn);
      });

      embedTextBatchMock.mockImplementation(async (texts: string[]) => texts.map(() => vec(1)));
      await embedFactsBatch(db, ids);

      expect(transactionSpyCalled).toBe(true);
      for (const id of ids) expect(embeddingIsNull(id)).toBe(false);
    });
  });

  // ── getPendingFactEmbeddingCount ─────────────────────────────────────────────

  describe('getPendingFactEmbeddingCount', () => {
    it('counts only rows with embedding IS NULL', () => {
      const embedded = insertFact('has-embedding', 'x');
      db.prepare('UPDATE facts SET embedding = ? WHERE id = ?').run(Buffer.alloc(4), embedded);
      insertFact('pending-1', 'y');
      insertFact('pending-2', 'z');

      expect(getPendingFactEmbeddingCount(db)).toBe(2);
    });

    it('returns 0 when every fact is embedded', () => {
      const id = insertFact('has-embedding', 'x');
      db.prepare('UPDATE facts SET embedding = ? WHERE id = ?').run(Buffer.alloc(4), id);
      expect(getPendingFactEmbeddingCount(db)).toBe(0);
    });
  });

  // ── Resumability: crash mid-backfill, rerun, no duplicates, all embedded ────

  describe('backfillMissingEmbeddings resumability', () => {
    it('a partial run followed by a rerun embeds every remaining row exactly once, with no duplicate rows created', async () => {
      // 20 facts with backfillMissingEmbeddings's default batchSize (16)
      // means 2 batches (16 + 4) — enough to simulate the first batch
      // succeeding and the second "crashing" mid-backfill.
      const ids = Array.from({ length: 20 }, (_, i) => insertFact(`row-${i}`, `content ${i}`));

      let batchCall = 0;
      embedTextBatchMock.mockImplementation(async (texts: string[]) => {
        batchCall++;
        if (batchCall === 1) return texts.map((_, i) => vec(i));
        throw new Error('simulated crash for remaining batches');
      });

      expect(getPendingFactEmbeddingCount(db)).toBe(20);
      await backfillMissingEmbeddings(db);
      const pendingAfterFirstRun = getPendingFactEmbeddingCount(db);
      expect(pendingAfterFirstRun).toBe(4); // second (4-row) batch failed, stayed NULL
      expect(pendingAfterFirstRun).toBeLessThan(20); // but the first batch's 16 rows landed

      // "Rerun": now every batch succeeds — this is what a real restart of the
      // app / a rerun of the backfill script does.
      embedTextBatchMock.mockImplementation(async (texts: string[]) =>
        texts.map((_, i) => vec(100 + i))
      );
      await backfillMissingEmbeddings(db);

      expect(getPendingFactEmbeddingCount(db)).toBe(0); // every row now embedded
      // No duplicate rows were created — resumability came from re-selecting
      // `WHERE embedding IS NULL`, never from re-inserting.
      const total = db.prepare('SELECT COUNT(*) as count FROM facts').get() as { count: number };
      expect(total.count).toBe(20);
      for (const id of ids) expect(embeddingIsNull(id)).toBe(false);
      // The rerun only re-embedded the 4 still-pending rows, not all 20 again.
      expect(embedTextBatchMock.mock.calls.at(-1)?.[0]).toHaveLength(4);
    });

    it('is a no-op (no model calls) when nothing is pending', async () => {
      const id = insertFact('already-embedded', 'x');
      db.prepare('UPDATE facts SET embedding = ? WHERE id = ?').run(Buffer.alloc(4), id);

      await backfillMissingEmbeddings(db);

      expect(embedTextBatchMock).not.toHaveBeenCalled();
    });
  });
});
