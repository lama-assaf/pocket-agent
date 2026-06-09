/**
 * Shared configuration for the on-device transformers.js runtime.
 *
 * Both the embedding pipeline (`src/memory/embeddings.ts`) and the Whisper
 * transcription pipeline (`src/utils/transcribe.ts`) lazily import
 * `@huggingface/transformers`, which exposes a single global `env`. Pinning
 * `env.cacheDir` keeps downloaded models in a predictable location (the app's
 * userData dir) instead of transformers.js's default cache, so the ~25MB models
 * live alongside the database and survive cleanly across launches.
 *
 * The main process calls `setTransformersCacheDir()` once at startup. The lazy
 * loaders then call `applyTransformersEnv()` right after importing the library
 * to apply the pinned directory before any model download begins.
 */

let configuredCacheDir: string | null = null;

/**
 * Pin the directory transformers.js uses to cache downloaded models.
 * Call once at startup, before any embedding/transcription work begins.
 */
export function setTransformersCacheDir(dir: string): void {
  configuredCacheDir = dir;
}

/**
 * Apply the pinned cache directory to a transformers.js `env` object.
 * No-op when no directory has been configured (e.g. unit tests, CLI contexts).
 */
export function applyTransformersEnv(env: { cacheDir?: string | null }): void {
  if (configuredCacheDir) {
    env.cacheDir = configuredCacheDir;
  }
}
