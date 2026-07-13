/**
 * F2: the scheduler's proactive-resurfacing nudge must resolve the target
 * session's memory context and only ever deliver a candidate visible to that
 * session's scopes — never an unrelated brand's (or personal) fact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/memory/semantic', () => ({
  embedFactAsync: vi.fn(),
  embedSoulAspectAsync: vi.fn(),
  embedRollup: vi.fn(async () => {}),
  findNearDuplicateFacts: vi.fn(() => []),
  retrieveRelevantFacts: vi.fn(() => ''),
  retrieveRelevantSoul: vi.fn(() => ''),
  retrieveRelevantRollups: vi.fn(() => ''),
  semanticSearchFacts: vi.fn(() => []),
  backfillMissingEmbeddings: vi.fn(async () => {}),
}));

const summarizeTextMock = vi.fn(async () => 'A gentle nudge about that memory.');
vi.mock('../../src/memory/summarizer', () => ({
  summarizeText: (prompt: string, maxTokens?: number) => summarizeTextMock(prompt, maxTokens),
}));

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(() => ''),
  },
}));

vi.mock('../../src/agent', () => ({
  AgentManager: {
    isInitialized: vi.fn(() => true),
    processMessage: vi.fn(async () => ({ response: 'mock', messages: [] })),
  },
}));

import { MemoryManager } from '../../src/memory/index';
import { CronScheduler } from '../../src/scheduler';
import { clientScope } from '../../src/memory/scope';

const NOW = new Date(2026, 5, 10, 10, 0, 0);

function createSetup() {
  const memory = new MemoryManager(':memory:');
  const scheduler = new CronScheduler();
  scheduler['memory'] = memory;
  scheduler['db'] = memory['db'];

  const chatMessages: Array<{ jobName: string; response: string; sessionId: string }> = [];
  scheduler.setChatHandler((jobName, _prompt, response, sessionId) => {
    chatMessages.push({ jobName, response, sessionId });
  });

  return { memory, scheduler, chatMessages };
}

function makeStaleFact(
  memory: MemoryManager,
  subject: string,
  content: string,
  scope: string,
  importance = 90
): number {
  const id = memory.saveFact('user_info', subject, content, false, scope);
  const old = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
  memory['db']
    .prepare('UPDATE facts SET importance = ?, last_accessed_at = ? WHERE id = ?')
    .run(importance, old, id);
  return id;
}

describe('CronScheduler.maybeResurfaceMemory scope isolation (F2)', () => {
  beforeEach(() => {
    summarizeTextMock.mockClear();
    summarizeTextMock.mockResolvedValue('A gentle nudge about that memory.');
  });

  it('never delivers another client\u2019s fact into a client-scoped session', async () => {
    const { memory, scheduler, chatMessages } = createSetup();
    memory.createClient({ id: 'brandB', name: 'Brand B' });
    const session = memory.createSession('brandB-work');
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'brandB',
      projectKey: null,
    });

    makeStaleFact(memory, 'secret', 'Brand A confidential pricing', clientScope('brandA'));

    await scheduler['maybeResurfaceMemory'](NOW);

    // No candidate visible to Brand B's session — nothing delivered.
    expect(chatMessages).toHaveLength(0);
    expect(summarizeTextMock).not.toHaveBeenCalled();
  });

  it('delivers the session\u2019s own client fact when one is visible', async () => {
    const { memory, scheduler, chatMessages } = createSetup();
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    const session = memory.createSession('brandA-work');
    memory.setSessionContext(session.id, {
      contextType: 'client',
      clientId: 'brandA',
      projectKey: null,
    });

    makeStaleFact(memory, 'launch', 'Brand A launch retro notes', clientScope('brandA'));

    await scheduler['maybeResurfaceMemory'](NOW);

    expect(chatMessages).toHaveLength(1);
    expect(chatMessages[0].sessionId).toBe(session.id);
    expect(chatMessages[0].response).toBe('A gentle nudge about that memory.');
  });

  it('never delivers a client fact into a personal-context session', async () => {
    const { memory, scheduler, chatMessages } = createSetup();
    memory.createClient({ id: 'brandA', name: 'Brand A' });
    // Default session context is personal (unset).
    memory.createSession('personal-work');

    makeStaleFact(memory, 'secret', 'Brand A confidential pricing', clientScope('brandA'));

    await scheduler['maybeResurfaceMemory'](NOW);

    expect(chatMessages).toHaveLength(0);
  });
});
