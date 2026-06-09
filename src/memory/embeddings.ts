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
