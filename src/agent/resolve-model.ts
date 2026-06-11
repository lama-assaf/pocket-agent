/**
 * Model resolver — single source of truth for selecting which model to use.
 *
 * Reads the user's configured model and the set of currently available API
 * keys / OAuth tokens, and returns a model whose provider has credentials.
 * If the user's configured model has a matching key, it is preserved. If
 * not, we fall back to a sensible default for whatever the user has.
 *
 * This is called both at agent init time AND whenever a key changes, so
 * `agent.model` always tracks reality. Used by initializeAgent (main),
 * chat-engine (provider routing), and settings:set (auto-restart on key
 * change).
 */

import { SettingsManager } from '../settings';
import { getProviderForModel, type ProviderType } from './providers';
import { getDefaultModelFor, isKnownModel } from './model-catalog';

/**
 * Default model for each provider when fallback is required. Derived from the
 * gg-core registry (via the model-catalog adapter) so it never drifts from the
 * canonical catalog. Anthropic keeps the app's Opus preference via the adapter.
 */
const PROVIDER_DEFAULT_MODEL: Record<ProviderType, string> = {
  anthropic: getDefaultModelFor('anthropic'),
  openai: getDefaultModelFor('openai'),
  moonshot: getDefaultModelFor('moonshot'),
  glm: getDefaultModelFor('glm'),
  xiaomi: getDefaultModelFor('xiaomi'),
  minimax: getDefaultModelFor('minimax'),
  deepseek: getDefaultModelFor('deepseek'),
};

/**
 * Preference order when the user has multiple providers configured but
 * the currently-selected model has no key. We pick the first provider in
 * this list that has a key. Anthropic remains preferred when available
 * because most of the app's prompts/caching are tuned for it.
 */
const PROVIDER_PREFERENCE: ProviderType[] = [
  'anthropic',
  'openai',
  'moonshot',
  'glm',
  'xiaomi',
  'minimax',
  'deepseek',
];

export interface AvailableKeys {
  anthropic: boolean;
  /** Anthropic OAuth (Claude Pro/Max sign-in). */
  anthropicOAuth: boolean;
  openai: boolean;
  /** OpenAI OAuth (Codex sign-in). */
  openaiOAuth: boolean;
  moonshot: boolean;
  /** Kimi (Moonshot) OAuth (device-code sign-in). */
  moonshotOAuth: boolean;
  glm: boolean;
  xiaomi: boolean;
  minimax: boolean;
  deepseek: boolean;
}

/** Read which providers currently have credentials available. */
export function getAvailableKeys(): AvailableKeys {
  return {
    anthropic: !!SettingsManager.get('anthropic.apiKey'),
    anthropicOAuth:
      SettingsManager.get('auth.method') === 'oauth' && !!SettingsManager.get('auth.oauthToken'),
    openai: !!SettingsManager.get('openai.apiKey'),
    openaiOAuth: SettingsManager.get('openai.auth.method') === 'oauth',
    moonshot: !!SettingsManager.get('moonshot.apiKey'),
    moonshotOAuth: SettingsManager.get('kimi.auth.method') === 'oauth',
    glm: !!SettingsManager.get('glm.apiKey'),
    xiaomi: !!SettingsManager.get('xiaomi.apiKey'),
    minimax: !!SettingsManager.get('minimax.apiKey'),
    deepseek: !!SettingsManager.get('deepseek.apiKey'),
  };
}

/** Does the given provider have any credential (API key or OAuth)? */
function providerHasCredential(provider: ProviderType, keys: AvailableKeys): boolean {
  switch (provider) {
    case 'anthropic':
      return keys.anthropic || keys.anthropicOAuth;
    case 'openai':
      return keys.openai || keys.openaiOAuth;
    case 'moonshot':
      return keys.moonshot || keys.moonshotOAuth;
    case 'glm':
      return keys.glm;
    case 'xiaomi':
      return keys.xiaomi;
    case 'minimax':
      return keys.minimax;
    case 'deepseek':
      return keys.deepseek;
  }
}

/**
 * Resolve the model to use right now.
 *
 * @param configuredModel - the model the user has selected (e.g. from `agent.model`).
 *   When empty/undefined, falls through to the preference list.
 * @param keys - which providers have credentials. Defaults to live settings.
 * @returns A model whose provider has a credential, or the configured model
 *   unchanged when no credentials are available at all (caller decides what
 *   to do — usually skip init).
 */
export function resolveModel(
  configuredModel?: string,
  keys: AvailableKeys = getAvailableKeys()
): string {
  // If the user's model matches an available provider, keep it. Ignore a
  // configured id that is no longer in the registry (e.g. a now-removed model
  // persisted from an older version) so it self-heals to a valid default on the
  // next resolve, rather than being routed to a dead model.
  if (configuredModel && isKnownModel(configuredModel)) {
    const provider = getProviderForModel(configuredModel);
    if (providerHasCredential(provider, keys)) {
      return configuredModel;
    }
  }

  // Otherwise pick the first provider in the preference list that has a key.
  for (const provider of PROVIDER_PREFERENCE) {
    if (providerHasCredential(provider, keys)) {
      return PROVIDER_DEFAULT_MODEL[provider];
    }
  }

  // No keys at all — return the configured model (or a safe default) so callers
  // can detect this state via hasRequiredKeys() rather than via this function.
  // A stale/unknown configured id is ignored in favor of the anthropic default.
  return configuredModel && isKnownModel(configuredModel)
    ? configuredModel
    : PROVIDER_DEFAULT_MODEL.anthropic;
}

/**
 * Resolve and persist the model. If the resolved model differs from what's
 * stored in settings, updates `agent.model`. Returns the resolved model.
 */
export function resolveAndPersistModel(): string {
  const configured = SettingsManager.get('agent.model');
  const resolved = resolveModel(configured);
  if (resolved !== configured) {
    SettingsManager.set('agent.model', resolved);
  }
  return resolved;
}
