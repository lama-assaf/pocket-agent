/**
 * Thin, ChatEngine-independent text summarizer used by daily-log rollups,
 * consolidation, and resurfacing. Wraps the in-process `ggStream` LLM call so
 * those memory modules don't need a reference to the ChatEngine.
 */

import { stream as ggStream } from '@kenkaiiii/gg-ai';
import type { StreamResponse, TextContent } from '@kenkaiiii/gg-ai';
import { getStreamConfig } from '../agent/chat-providers';
import { resolveModel } from '../agent/resolve-model';
import { SettingsManager } from '../settings';

/** A function that turns a prompt into model text output. */
export type Summarizer = (prompt: string, maxTokens?: number) => Promise<string>;

/**
 * Extract concatenated text from a streamed model response.
 */
function extractText(response: StreamResponse): string {
  const parts = (
    Array.isArray(response.message.content)
      ? response.message.content
      : [{ type: 'text' as const, text: response.message.content }]
  ).filter((p): p is TextContent => p.type === 'text');
  return parts.map((p) => p.text).join('');
}

/**
 * Summarize/transform `prompt` into model text using the configured agent model.
 * Returns trimmed text, or '' on failure (callers degrade gracefully).
 */
export async function summarizeText(prompt: string, maxTokens = 1024): Promise<string> {
  try {
    const model = resolveModel(SettingsManager.get('agent.model'));
    const cfg = await getStreamConfig(model);
    const result = ggStream({
      provider: cfg.provider,
      model,
      maxTokens,
      messages: [{ role: 'user', content: prompt }],
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      accountId: cfg.accountId,
    });
    const response: StreamResponse = await result.response;
    return extractText(response).trim();
  } catch (e) {
    console.warn('[Summarizer] summarizeText failed:', e);
    return '';
  }
}
