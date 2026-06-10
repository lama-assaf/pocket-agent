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

const summarizeTextMock = vi.fn(async () => '');
vi.mock('../../src/memory/summarizer', () => ({
  summarizeText: (prompt: string, maxTokens?: number) => summarizeTextMock(prompt, maxTokens),
}));

const settingsMap = new Map<string, string>();
vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: (key: string) => settingsMap.get(key) ?? '',
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
import {
  gatherPulseSignals,
  hasPulseSignals,
  composePulsePrompt,
  composeDailyBriefPrompt,
  isQuietHour,
  localDayStartIso,
  wasLastPulseIgnored,
  isConversationActive,
} from '../../src/scheduler/pulse';

// Fixed clock: Wednesday 10 June 2026, 10:00 local time
const NOW = new Date(2026, 5, 10, 10, 0, 0);

function setDefaultSettings(): void {
  settingsMap.clear();
  settingsMap.set('pulse.enabled', 'true');
  settingsMap.set('pulse.maxPerDay', '2');
  settingsMap.set('pulse.quietHoursStart', '22');
  settingsMap.set('pulse.quietHoursEnd', '8');
  settingsMap.set('pulse.dailyBrief', 'false');
  settingsMap.set('pulse.briefHour', '8');
}

interface TestSetup {
  memory: MemoryManager;
  scheduler: CronScheduler;
  chatMessages: Array<{ jobName: string; response: string; sessionId: string }>;
  sessionId: string;
}

function createSetup(): TestSetup {
  const memory = new MemoryManager(':memory:');
  const session = memory.createSession('work');

  const scheduler = new CronScheduler();
  // Inject private deps directly: in-memory DB cannot be shared across
  // connections, so the scheduler reuses the MemoryManager's handle.
  scheduler['memory'] = memory;
  scheduler['db'] = memory['db'];

  const chatMessages: TestSetup['chatMessages'] = [];
  scheduler.setChatHandler((jobName, _prompt, response, sessionId) => {
    chatMessages.push({ jobName, response, sessionId });
  });

  return { memory, scheduler, chatMessages, sessionId: session.id };
}

function insertTask(memory: MemoryManager, sessionId: string, title: string, dueIso: string): void {
  memory['db']
    .prepare('INSERT INTO tasks (title, due_date, status, session_id) VALUES (?, ?, ?, ?)')
    .run(title, dueIso, 'pending', sessionId);
}

function insertEvent(
  memory: MemoryManager,
  sessionId: string,
  title: string,
  startIso: string
): void {
  memory['db']
    .prepare('INSERT INTO calendar_events (title, start_time, session_id) VALUES (?, ?, ?)')
    .run(title, startIso, sessionId);
}

beforeEach(() => {
  setDefaultSettings();
  summarizeTextMock.mockReset();
  summarizeTextMock.mockResolvedValue('');
});

describe('gatherPulseSignals', () => {
  it('returns session-scoped calendar/task signals plus global facts and loose ends', () => {
    const { memory, sessionId } = createSetup();
    const other = memory.createSession('personal');

    const inSixHours = new Date(NOW.getTime() + 6 * 3_600_000).toISOString();
    const dueTomorrow = new Date(NOW.getTime() + 24 * 3_600_000).toISOString();
    insertEvent(memory, sessionId, 'Demo with Sarah', inSixHours);
    insertTask(memory, sessionId, 'Email Sarah', dueTomorrow);
    insertTask(memory, other.id, 'Buy groceries', dueTomorrow);

    // High-importance stale fact (global memory)
    const factId = memory.saveFact('user_info', 'commitment', 'promised to ship v2 by Friday');
    const old = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
    memory['db']
      .prepare('UPDATE facts SET importance = 90, last_accessed_at = ? WHERE id = ?')
      .run(old, factId);

    // Yesterday's daily log
    memory['db']
      .prepare('INSERT INTO daily_logs (date, content) VALUES (?, ?)')
      .run('2026-06-09', 'Started drafting demo notes; left TODO for slides');

    const signals = gatherPulseSignals(memory['db'], sessionId, NOW);
    expect(signals.upcomingEvents.map((e) => e.title)).toEqual(['Demo with Sarah']);
    expect(signals.dueTasks.map((t) => t.title)).toEqual(['Email Sarah']);
    expect(signals.staleCommitments.map((f) => f.id)).toContain(factId);
    expect(signals.yesterdayLog).toContain('demo notes');
    expect(hasPulseSignals(signals)).toBe(true);

    // Other session must not see this session's events/tasks
    const otherSignals = gatherPulseSignals(memory['db'], other.id, NOW);
    expect(otherSignals.upcomingEvents).toEqual([]);
    expect(otherSignals.dueTasks.map((t) => t.title)).toEqual(['Buy groceries']);
  });

  it('marks overdue open tasks and excludes completed ones', () => {
    const { memory, sessionId } = createSetup();
    const yesterdayIso = new Date(NOW.getTime() - 86_400_000).toISOString();
    insertTask(memory, sessionId, 'Overdue thing', yesterdayIso);
    memory['db']
      .prepare('INSERT INTO tasks (title, due_date, status, session_id) VALUES (?, ?, ?, ?)')
      .run('Done thing', yesterdayIso, 'completed', sessionId);

    const signals = gatherPulseSignals(memory['db'], sessionId, NOW);
    expect(signals.dueTasks).toHaveLength(1);
    expect(signals.dueTasks[0]!.title).toBe('Overdue thing');
    expect(signals.dueTasks[0]!.overdue).toBe(true);
  });

  it('excludes sensitive facts', () => {
    const { memory, sessionId } = createSetup();
    const factId = memory.saveFact('user_info', 'secret', 'private detail', true);
    const old = new Date(NOW.getTime() - 60 * 86_400_000).toISOString();
    memory['db']
      .prepare('UPDATE facts SET importance = 95, last_accessed_at = ? WHERE id = ?')
      .run(old, factId);

    const signals = gatherPulseSignals(memory['db'], sessionId, NOW);
    expect(signals.staleCommitments.map((f) => f.id)).not.toContain(factId);
  });
});

describe('composePulsePrompt', () => {
  it('includes recent pulse topics as an exclusion list (dedup)', () => {
    const { memory, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    memory.recordPulse(sessionId, 'checkin', 'Reminded about emailing Sarah', NOW);

    const signals = gatherPulseSignals(memory['db'], sessionId, NOW);
    const prompt = composePulsePrompt(signals);
    expect(prompt).toContain('do NOT repeat');
    expect(prompt).toContain('Reminded about emailing Sarah');
    expect(prompt).toContain('HEARTBEAT_OK');
  });
});

describe('quiet hours and day-start helpers', () => {
  it('detects quiet hours across midnight wrap', () => {
    expect(isQuietHour(23, 22, 8)).toBe(true);
    expect(isQuietHour(3, 22, 8)).toBe(true);
    expect(isQuietHour(10, 22, 8)).toBe(false);
    expect(isQuietHour(12, 9, 17)).toBe(true);
    expect(isQuietHour(8, 9, 17)).toBe(false);
    expect(isQuietHour(5, 6, 6)).toBe(false);
  });

  it('localDayStartIso is at or before now and within 24h', () => {
    const start = new Date(localDayStartIso(NOW));
    expect(start.getTime()).toBeLessThanOrEqual(NOW.getTime());
    expect(NOW.getTime() - start.getTime()).toBeLessThan(86_400_000);
  });
});

describe('maybeRunPulse gates', () => {
  it('delivers a check-in to the session and records it in pulse_log', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('Heads up — you still owe Sarah that email.');

    await scheduler['maybeRunPulse'](NOW);

    expect(chatMessages).toHaveLength(1);
    expect(chatMessages[0]).toMatchObject({ jobName: 'pulse', sessionId });
    expect(memory.countPulsesSince('checkin', localDayStartIso(NOW))).toBe(1);
    const saved = memory.getRecentMessages(5, sessionId);
    expect(saved.some((m) => m.content.includes('Sarah'))).toBe(true);
  });

  it('does not call the LLM when there are no signals', async () => {
    const { scheduler, chatMessages } = createSetup();
    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it('blocks during quiet hours', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('should never be delivered');

    const lateNight = new Date(2026, 5, 10, 23, 0, 0);
    await scheduler['maybeRunPulse'](lateNight);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it('blocks when the global daily cap is reached', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('should never be delivered');

    memory.recordPulse(sessionId, 'checkin', 'first', NOW);
    memory.recordPulse(sessionId, 'checkin', 'second', NOW);

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it('blocks when pulse is disabled globally', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    settingsMap.set('pulse.enabled', 'false');

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it('skips sessions that opted out of pulse', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    memory.setSessionPulseEnabled(sessionId, false);

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);
  });

  it('backs off when the previous check-in got no user reply', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('Nudge about Sarah');

    // Yesterday's check-in, never answered
    const yesterday = new Date(NOW.getTime() - 86_400_000);
    memory.recordPulse(sessionId, 'checkin', 'old unanswered nudge', yesterday);
    expect(wasLastPulseIgnored(memory['db'], sessionId)).toBe(true);

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);

    // User replies (an hour before NOW → not an "active conversation"):
    // backoff lifts and the next tick can deliver again
    const replyAt = new Date(NOW.getTime() - 3_600_000).toISOString();
    memory['db']
      .prepare('INSERT INTO messages (role, content, timestamp, session_id) VALUES (?, ?, ?, ?)')
      .run('user', 'thanks, on it', replyAt, sessionId);
    expect(wasLastPulseIgnored(memory['db'], sessionId)).toBe(false);

    await scheduler['maybeRunPulse'](NOW);
    expect(chatMessages).toHaveLength(1);
  });

  it('suppresses check-ins during an active conversation (user message <15 min ago)', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('Nudge about Sarah');

    // User message 5 minutes ago → conversation is live, stay quiet
    const fiveMinAgo = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    memory['db']
      .prepare('INSERT INTO messages (role, content, timestamp, session_id) VALUES (?, ?, ?, ?)')
      .run('user', 'hey, quick question', fiveMinAgo, sessionId);
    expect(isConversationActive(memory['db'], sessionId, NOW)).toBe(true);

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).not.toHaveBeenCalled();
    expect(chatMessages).toHaveLength(0);

    // 20 minutes later the conversation has gone quiet → pulse may fire
    const later = new Date(NOW.getTime() + 20 * 60_000);
    expect(isConversationActive(memory['db'], sessionId, later)).toBe(false);

    await scheduler['maybeRunPulse'](later);
    expect(chatMessages).toHaveLength(1);
  });

  it('HEARTBEAT_OK suppresses delivery and does not consume the cap', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('HEARTBEAT_OK');

    await scheduler['maybeRunPulse'](NOW);
    expect(summarizeTextMock).toHaveBeenCalledTimes(1);
    expect(chatMessages).toHaveLength(0);
    expect(memory.countPulsesSince('checkin', localDayStartIso(NOW))).toBe(0);
  });
});

describe('maybeRunDailyBrief', () => {
  it('fires once per session per day at/after briefHour', async () => {
    const { memory, scheduler, chatMessages, sessionId } = createSetup();
    settingsMap.set('pulse.dailyBrief', 'true');
    insertTask(memory, sessionId, 'Email Sarah', NOW.toISOString());
    summarizeTextMock.mockResolvedValue('Morning! One task due today: email Sarah.');

    await scheduler['maybeRunDailyBrief'](NOW);
    expect(chatMessages).toHaveLength(1);
    expect(chatMessages[0]).toMatchObject({ jobName: 'daily-brief', sessionId });
    expect(memory.countSessionPulsesSince(sessionId, 'brief', localDayStartIso(NOW))).toBe(1);

    // Second tick on the same day: no second brief
    await scheduler['maybeRunDailyBrief'](NOW);
    expect(chatMessages).toHaveLength(1);
  });

  it('does not fire before briefHour or when opted out', async () => {
    const { scheduler, chatMessages } = createSetup();
    settingsMap.set('pulse.dailyBrief', 'true');
    summarizeTextMock.mockResolvedValue('too early');

    const earlyMorning = new Date(2026, 5, 10, 6, 0, 0);
    await scheduler['maybeRunDailyBrief'](earlyMorning);
    expect(chatMessages).toHaveLength(0);

    settingsMap.set('pulse.dailyBrief', 'false');
    await scheduler['maybeRunDailyBrief'](NOW);
    expect(chatMessages).toHaveLength(0);
  });

  it('brief prompt always produces output instructions even with no signals', () => {
    const { memory, sessionId } = createSetup();
    const signals = gatherPulseSignals(memory['db'], sessionId, NOW);
    const prompt = composeDailyBriefPrompt(signals);
    expect(prompt).toContain('morning brief');
    expect(prompt).not.toContain('HEARTBEAT_OK');
  });
});

describe('pulse-enabled session defaults', () => {
  it('defaults to the primary (non-default) session when no flags are set', () => {
    const { memory, sessionId } = createSetup();
    const enabled = memory.getPulseEnabledSessions();
    expect(enabled.map((s) => s.id)).toEqual([sessionId]);
  });

  it('only explicit opt-ins count once any flag is set', () => {
    const { memory, sessionId } = createSetup();
    const other = memory.createSession('personal');
    memory.setSessionPulseEnabled(other.id, true);

    const enabled = memory.getPulseEnabledSessions();
    expect(enabled.map((s) => s.id)).toEqual([other.id]);
    expect(enabled.map((s) => s.id)).not.toContain(sessionId);
  });
});

describe('deleteSession cleanup', () => {
  it('removes pulse_log rows for the deleted session', () => {
    const { memory, sessionId } = createSetup();
    memory.recordPulse(sessionId, 'checkin', 'hello', NOW);
    expect(memory.getRecentPulses(sessionId, 7, NOW)).toHaveLength(1);

    memory.deleteSession(sessionId);
    expect(memory.getRecentPulses(sessionId, 7, NOW)).toHaveLength(0);
  });
});
