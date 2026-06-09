/**
 * Shared provider configuration for LLM backends.
 * Single source of truth — imported by both coder mode (agent/index.ts)
 * and general/chat mode (chat-providers.ts).
 */

export type ProviderType =
  | 'anthropic'
  | 'moonshot'
  | 'glm'
  | 'xiaomi'
  | 'openai'
  | 'minimax'
  | 'deepseek';

export interface ProviderConfig {
  /** OpenAI-compatible base URL (used by gg-ai chat engine in General mode) */
  baseUrl?: string;
  /** Anthropic-compatible base URL (used by Claude Agent SDK subprocess in Coder mode) */
  sdkBaseUrl?: string;
}

export const PROVIDER_CONFIGS: Record<ProviderType, ProviderConfig> = {
  anthropic: {
    // No baseUrl = uses default Anthropic endpoint for both modes
  },
  moonshot: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default /v1)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.moonshot.ai/anthropic',
  },
  glm: {
    // General mode: no baseUrl — gg-ai's built-in GLM provider handles endpoint
    // selection with fallback (coding endpoint first, then regular).
    // Setting baseUrl would bypass this and break Coding Plan models like glm-5.1.
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.z.ai/api/anthropic',
  },
  xiaomi: {
    // General mode: gg-ai uses OpenAI-compat endpoint for Xiaomi models
    baseUrl: 'https://token-plan-sgp.xiaomimimo.com/v1',
  },
  openai: {
    // General mode: gg-ai uses OpenAI-compat endpoint (no baseUrl = gg-ai default)
    // Coder mode: SDK subprocess needs the Anthropic-compat endpoint
    sdkBaseUrl: 'https://api.openai.com/v1',
  },
  minimax: {
    // General mode: gg-ai uses Anthropic-compat endpoint for MiniMax models
    baseUrl: 'https://api.minimax.io/anthropic',
  },
  deepseek: {
    // General mode: gg-ai uses OpenAI-compat endpoint for DeepSeek models
    baseUrl: 'https://api.deepseek.com/v1',
  },
};

/**
 * Map a model id to its provider. Backed by the gg-core model registry via the
 * model-catalog adapter — unknown or unsupported-provider models fall back to
 * 'anthropic'. Re-exported here so existing imports of `./providers` keep working.
 */
export { getProviderForModel } from './model-catalog';
