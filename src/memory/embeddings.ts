/**
 * On-device text embeddings via @huggingface/transformers (transformers.js).
 *
 * Uses the small, fast `Xenova/all-MiniLM-L6-v2` model (384-dim, mean-pooled,
 * normalized). The model downloads once on first use and is cached in a lazy
 * singleton, mirroring the pattern in `src/utils/transcribe.ts`.
 *
 * Vectors are stored inline as BLOBs (Float32Array buffers) and compared with
 * brute-force cosine similarity in JS — personal memory is small enough that a
 * native vector index is unnecessary.
 */

import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { applyTransformersEnv } from '../utils/transformers-env';

/** Embedding model identifier. */
export const EMBEDDING_MODEL_ID = 'Xenova/all-MiniLM-L6-v2';

/** Dimensionality of the embedding vectors produced by the model. */
export const EMBEDDING_DIM = 384;

let embedder: FeatureExtractionPipeline | null = null;
let loadPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Get or initialize the local feature-extraction pipeline (lazy singleton).
 */
async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder;

  if (!loadPromise) {
    loadPromise = (async () => {
      console.log(`[Embeddings] Loading local embedding model: ${EMBEDDING_MODEL_ID}`);
      const { pipeline, env } = await import('@huggingface/transformers');
      applyTransformersEnv(env);
      const instance = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
        dtype: 'fp32',
      });
      embedder = instance;
      return instance;
    })();
  }

  return loadPromise;
}

/**
 * Embed a single text string into a normalized 384-dim vector.
 * Returns a Float32Array. Throws if the model fails to load or run.
 */
export async function embedText(text: string): Promise<Float32Array> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // transformers.js returns a Tensor with a typed `data` array.
  return Float32Array.from(output.data as Iterable<number>);
}

/**
 * Embed multiple texts in a single batched model call. transformers.js's
 * feature-extraction pipeline accepts `string[]` natively (its `_call` passes
 * `texts` straight through to the tokenizer with no reordering — see
 * node_modules/@huggingface/transformers/src/pipelines/feature-extraction.js),
 * so a batch of N texts produces one Tensor with `dims = [N, EMBEDDING_DIM]`
 * and a flat `data` array of length `N * EMBEDDING_DIM`, in the SAME order as
 * the input texts (verified against the installed 4.2.0 package before this
 * was written). This is far faster than N sequential `embedText` calls (one
 * model forward pass instead of N) — the difference measured live during a
 * prior embedding backfill was ~3.6 rows/sec sequential.
 *
 * Returns `[]` for an empty input without invoking the model. Throws (like
 * `embedText`) if the model fails to load or run — callers that want
 * resilience against a bad batch should wrap this in retry/fallback logic
 * (see semantic.ts's `embedFactsBatch`), not swallow errors here.
 */
export async function embedTextBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const pipe = await getEmbedder();
  const output = await pipe(texts, { pooling: 'mean', normalize: true });
  const flat = Float32Array.from(output.data as Iterable<number>);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i++) {
    vectors.push(flat.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
  }
  return vectors;
}

/**
 * Compute cosine similarity between two equal-length vectors.
 * Assumes inputs may not be normalized; computes the full cosine.
 * Returns 0 when either vector has zero magnitude or lengths differ.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Serialize a vector to a Buffer suitable for storage in a SQLite BLOB column.
 */
export function serializeVector(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserialize a SQLite BLOB back into a Float32Array.
 * Returns null when the blob is empty or has an invalid byte length.
 */
export function deserializeVector(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob || blob.byteLength === 0) return null;
  if (blob.byteLength % 4 !== 0) return null;

  // Copy into a fresh, 4-byte-aligned buffer so the Float32Array view is valid
  // regardless of the source buffer's byte offset/alignment.
  const aligned = new ArrayBuffer(blob.byteLength);
  new Uint8Array(aligned).set(blob);
  return new Float32Array(aligned);
}
