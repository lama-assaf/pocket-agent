/**
 * Model catalog adapter — the single source of truth for the app's model list.
 *
 * Wraps `@kenkaiiii/gg-core/models` (the canonical, provider-agnostic registry)
 * and narrows it to the providers this app actually supports. This is the ONLY
 * module that imports `@kenkaiiii/gg-core/models`; everything else (provider
 * routing, model resolution, the settings picker, context-window math) goes
 * through here so there is exactly one place the catalog can drift.
 *
 * App-specific concerns — transport base URLs, credential gating, OAuth — stay
 * in their own modules; gg-core has no opinion on those.
 */

import {
  MODELS,
  getModel,
  getDefaultModel,
  getContextWindow,
  getMaxThinkingLevel,
  type ModelInfo,
  type ContextWindowOptions,
} from '@kenkaiiii/gg-core/models';
import type { ProviderType } from './providers';

export type { ModelInfo, ContextWindowOptions };
export { getModel, getContextWindow, getMaxThinkingLevel };

/**
 * Providers this app supports. gg-core also ships gemini, openrouter and palsu
 * models — those must never leak into the picker or the resolver, so we filter
 * `MODELS` down to this set.
 */
const SUPPORTED_PROVIDERS: ReadonlySet<ProviderType> = new Set<ProviderType>([
  'anthropic',
  'openai',
  'moonshot',
  'glm',
  'xiaomi',
  'minimax',
  'deepseek',
]);

/** Type guard: is the given registry provider one this app supports? */
function isSupportedProvider(provider: string): provider is ProviderType {
  return (SUPPORTED_PROVIDERS as ReadonlySet<string>).has(provider);
}

/**
 * The registry filtered to the app's supported providers. gg-core types
 * `ModelInfo.provider` as the gg-ai `Provider` union (which omits gemini), but
 * the runtime data includes gemini/openrouter/palsu — so we compare as strings.
 */
export const SUPPORTED_MODELS: readonly ModelInfo[] = MODELS.filter((m) =>
  isSupportedProvider(m.provider)
);

/**
 * App preference overrides for per-provider defaults. gg-core defaults anthropic
 * to Sonnet; this app prefers Fable because its prompts/caching are tuned for it.
 */
const PROVIDER_DEFAULT_OVERRIDE: Partial<Record<ProviderType, string>> = {
  anthropic: 'claude-fable-5',
};

/**
 * Resolve a model id to its provider. Unknown ids, or models whose provider the
 * app does not support (gemini/openrouter/palsu), fall back to 'anthropic' —
 * preserving the previous `MODEL_PROVIDERS[model] || 'anthropic'` behavior.
 */
export function getProviderForModel(id: string): ProviderType {
  const model = getModel(id);
  if (model && isSupportedProvider(model.provider)) {
    return model.provider;
  }
  return 'anthropic';
}

/**
 * The default model id for a provider, applying the app's explicit overrides
 * (anthropic → Fable) before deferring to gg-core's registry default.
 */
export function getDefaultModelFor(provider: ProviderType): string {
  const override = PROVIDER_DEFAULT_OVERRIDE[provider];
  if (override) return override;
  return getDefaultModel(provider).id;
}

/** Is this id a known, app-supported model? Used for settings validation. */
export function isKnownModel(id: string): boolean {
  return SUPPORTED_MODELS.some((m) => m.id === id);
}
