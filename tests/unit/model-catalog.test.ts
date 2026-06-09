/**
 * Unit tests for the model-catalog adapter and its consumers.
 *
 * Verifies the gg-core model registry is correctly narrowed to the app's
 * supported providers and that provider routing, default-model overrides,
 * model-id validation, and context-window delegation behave as designed.
 */

import { describe, it, expect, vi } from 'vitest';

// resolve-model pulls in SettingsManager → settings schema → electron.
// Mock electron so the import chain loads in a plain Node test environment.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((v: string) => Buffer.from(v)),
    decryptString: vi.fn((b: Buffer) => b.toString()),
  },
  app: { getPath: vi.fn(() => '/tmp') },
}));

import {
  SUPPORTED_MODELS,
  getProviderForModel,
  getDefaultModelFor,
  isKnownModel,
  getContextWindow,
} from '../../src/agent/model-catalog';
import { getContextWindow as ggGetContextWindow } from '@kenkaiiii/gg-core/models';
import { resolveModel, type AvailableKeys } from '../../src/agent/resolve-model';

const NO_KEYS: AvailableKeys = {
  anthropic: false,
  anthropicOAuth: false,
  openai: false,
  openaiOAuth: false,
  moonshot: false,
  glm: false,
  xiaomi: false,
  minimax: false,
  deepseek: false,
};

describe('SUPPORTED_MODELS provider filtering', () => {
  it('excludes gemini, openrouter and palsu models', () => {
    const providers = new Set(SUPPORTED_MODELS.map((m) => m.provider));
    expect(providers.has('gemini' as never)).toBe(false);
    expect(providers.has('openrouter' as never)).toBe(false);
    expect(providers.has('palsu' as never)).toBe(false);
  });

  it('only contains the seven app-supported providers', () => {
    const allowed = new Set([
      'anthropic',
      'openai',
      'moonshot',
      'glm',
      'xiaomi',
      'minimax',
      'deepseek',
    ]);
    for (const m of SUPPORTED_MODELS) {
      expect(allowed.has(m.provider)).toBe(true);
    }
  });

  it('includes at least one anthropic and one openai model', () => {
    expect(SUPPORTED_MODELS.some((m) => m.provider === 'anthropic')).toBe(true);
    expect(SUPPORTED_MODELS.some((m) => m.provider === 'openai')).toBe(true);
  });
});

describe('getProviderForModel', () => {
  it('resolves a known model to its registry provider', () => {
    expect(getProviderForModel('claude-opus-4-8')).toBe('anthropic');
    expect(getProviderForModel('kimi-k2.6')).toBe('moonshot');
  });

  it('falls back to anthropic for unknown ids', () => {
    expect(getProviderForModel('totally-made-up-model')).toBe('anthropic');
  });

  it('falls back to anthropic for unsupported-provider models (gemini)', () => {
    // gemini models exist in gg-core but not in the app's supported set.
    expect(getProviderForModel('gemini-3.5-flash')).toBe('anthropic');
  });
});

describe('getDefaultModelFor', () => {
  it('overrides anthropic to Fable (not gg-core Sonnet default)', () => {
    expect(getDefaultModelFor('anthropic')).toBe('claude-fable-5');
  });

  it('returns a known registry model for every supported provider', () => {
    for (const provider of [
      'anthropic',
      'openai',
      'moonshot',
      'glm',
      'xiaomi',
      'minimax',
      'deepseek',
    ] as const) {
      expect(isKnownModel(getDefaultModelFor(provider))).toBe(true);
    }
  });
});

describe('isKnownModel', () => {
  it('is true for registry models and false for stale ids', () => {
    expect(isKnownModel('claude-opus-4-8')).toBe(true);
    expect(isKnownModel('claude-opus-4-7')).toBe(false);
    expect(isKnownModel('gpt-5.5-pro')).toBe(false);
  });
});

describe('resolveModel with stale configured ids', () => {
  it('ignores an unknown configured id and falls through to the provider default', () => {
    const keys: AvailableKeys = { ...NO_KEYS, anthropic: true };
    expect(resolveModel('claude-opus-4-7', keys)).toBe('claude-fable-5');
  });

  it('keeps a known configured id whose provider has a credential', () => {
    const keys: AvailableKeys = { ...NO_KEYS, moonshot: true };
    expect(resolveModel('kimi-k2.6', keys)).toBe('kimi-k2.6');
  });

  it('returns the anthropic default when no keys exist and id is stale', () => {
    expect(resolveModel('mimo-v2-pro', NO_KEYS)).toBe('claude-fable-5');
  });
});

describe('getContextWindow delegation', () => {
  it('delegates to gg-core getContextWindow', () => {
    expect(getContextWindow('claude-opus-4-8')).toBe(
      ggGetContextWindow('claude-opus-4-8')
    );
  });
});
