/**
 * Fake-LLM scripted-conversation evals (STAGE B core deliverable).
 *
 * Every scenario below drives a real, multi-turn "conversation" through
 * tests/eval/harness.ts's `runScriptedConversation`: a scripted `Policy`
 * decides which tool to call each turn (standing in for the LLM), and
 * everything after that decision is genuine production code — the REAL
 * `remember`/`recall_memory`/`promote_memory`/`switch_agent`/`skill`/
 * `subagent`/`write` tool handlers, the REAL MemoryManager and scope
 * resolution, the REAL guardrail scanner, and the REAL routing log.
 *
 * This closes the gap the architecture audit flagged as highest-risk: every
 * prior "behavioral" test calls a tool handler directly with a hand-picked
 * input; none of them simulate a conversation where a fact told in one turn
 * has to survive (or correctly NOT survive) into a later turn, in a
 * DIFFERENT selected context, exactly the shape a real leak would take.
 *
 * Mocking policy (kept minimal and justified):
 *  - `@kenkaiiii/ggcoder` — stubs the write/edit/read file tools. Guardrail
 *    enforcement wraps these tools in REAL code (wrapWithWritePathSafety);
 *    only the underlying "did a byte hit disk" is stubbed, matching every
 *    other test in this repo that touches getChatAgentTools.
 *  - `../../src/tools` — returns a CURATED but 100% REAL subset
 *    (getMemoryTools() + getSwitchAgentTool(), both imported and called for
 *    real) instead of the full getCustomTools(), which also bundles heavy,
 *    unrelated modules (browser automation, macOS notifications, the cron
 *    scheduler) that no scenario here needs and that would make this suite
 *    slow and environment-fragile for no behavioral gain.
 *  - `../../src/agent/chat-providers` — stubs getStreamConfig (API key
 *    resolution) so the real `subagent` tool's setup can run without needing
 *    actual provider credentials.
 *  - `@kenkaiiii/gg-agent` — stubs ONLY the INNER agentLoop the real
 *    `subagent` tool calls when it actually dispatches a specialist. This is
 *    unrelated to this harness's own outer conversation loop (which never
 *    touches gg-agent at all) — see harness.ts's doc.
 *  - `../../src/memory/semantic` / `../../src/memory/embeddings` — stub only
 *    the async embedding writes and query embedding (forcing recall_memory's
 *    already-real keyword-search fallback), so no scenario needs the real
 *    MiniLM model. Every scope-resolution and filtering code path stays real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import type { MemoryManager } from '../../src/memory/index';
import {
  createEvalMemory,
  createEvalSession,
  personalContext,
  clientContext,
} from './setup';
import { runScriptedConversation, scriptedPolicy } from './harness';

const { mockWriteExecute } = vi.hoisted(() => ({ mockWriteExecute: vi.fn() }));

vi.mock('@kenkaiiii/ggcoder', () => ({
  createTools: () => ({
    tools: [
      { name: 'read', description: '', parameters: {}, execute: vi.fn(async () => '') },
      { name: 'write', description: '', parameters: {}, execute: mockWriteExecute },
      { name: 'edit', description: '', parameters: {}, execute: vi.fn(async () => '') },
    ],
  }),
}));

vi.mock('../../src/tools', async () => {
  const { getMemoryTools } = await import('../../src/tools/memory-tools');
  const { getSwitchAgentTool } = await import('../../src/tools/agent-mode-tools');
  return {
    getCustomTools: () => [...getMemoryTools(), { ...getSwitchAgentTool() }],
  };
});

vi.mock('../../src/agent/chat-providers', () => ({
  getStreamConfig: async () => ({ provider: 'anthropic', apiKey: 'x' }),
}));

vi.mock('@kenkaiiii/gg-agent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kenkaiiii/gg-agent')>();
  return {
    ...actual,
    agentLoop: async function* () {
      yield { type: 'text_delta', text: 'specialist work complete' };
      yield { type: 'agent_done', totalTurns: 1, totalUsage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
});

vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

vi.mock('../../src/memory/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/embeddings')>();
  return {
    ...actual,
    // Forces embedQuery() to null deterministically -> recall_memory's real
    // keyword-search-with-scope-filter fallback, no ML model needed.
    embedText: async () => {
      throw new Error('no embedding model in the eval harness (by design)');
    },
  };
});

async function getToolsFor(lane?: 'design' | 'product' | 'brand' | 'social'): Promise<AgentTool[]> {
  const { getChatAgentTools } = await import('../../src/agent/chat-tools');
  return getChatAgentTools({} as Parameters<typeof getChatAgentTools>[0], '/tmp', lane);
}

describe('eval: memory scope isolation through a scripted conversation', () => {
  let memory: MemoryManager;
  let tools: AgentTool[];

  beforeEach(async () => {
    memory = await createEvalMemory();
    tools = await getToolsFor();
  });

  afterEach(() => {
    memory.close();
  });

  it("a fact told in client A's conversation is recalled later in client A's own conversation", async () => {
    createEvalSession(memory, 'client-a-convo', clientContext('acme'));

    const result = await runScriptedConversation({
      tools,
      userMessage: 'Our primary brand color is a deep forest green.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'brand_facts', subject: 'primary_color', content: 'deep forest green' },
        },
        { type: 'respond', text: 'Got it, noted your primary brand color.' },
      ]),
    });
    expect(result.toolCalls[0].result).toContain('success');

    // A later turn (new session, same client) asks to recall it.
    createEvalSession(memory, 'client-a-later', clientContext('acme'));
    const recall = await runScriptedConversation({
      tools,
      userMessage: 'What is our primary brand color again?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'list_facts', input: { category: 'brand_facts' } },
        { type: 'respond', text: 'Your primary brand color is deep forest green.' },
      ]),
    });
    expect(recall.toolCalls[0].result).toContain('deep forest green');
  });

  it('the SAME fact is never recalled from a personal-context conversation (isolation, not just absence)', async () => {
    createEvalSession(memory, 'client-a-write', clientContext('acme'));
    await runScriptedConversation({
      tools,
      userMessage: 'Our primary brand color is a deep forest green.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'brand_facts', subject: 'primary_color', content: 'deep forest green' },
        },
        { type: 'respond', text: 'Noted.' },
      ]),
    });

    createEvalSession(memory, 'personal-convo', personalContext());
    const recall = await runScriptedConversation({
      tools,
      userMessage: 'What is our primary brand color?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'list_facts', input: {} },
        { type: 'respond', text: "I don't have that on file for you personally." },
      ]),
    });
    expect(recall.toolCalls[0].result).not.toContain('deep forest green');
  });

  it("the SAME fact is never recalled from a DIFFERENT client's conversation (Brand A never sees Brand B)", async () => {
    createEvalSession(memory, 'client-a-write-2', clientContext('acme'));
    await runScriptedConversation({
      tools,
      userMessage: 'Our primary brand color is a deep forest green.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'brand_facts', subject: 'primary_color', content: 'deep forest green' },
        },
        { type: 'respond', text: 'Noted.' },
      ]),
    });

    createEvalSession(memory, 'client-b-convo', clientContext('other-brand'));
    const recall = await runScriptedConversation({
      tools,
      userMessage: 'What is our primary brand color?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'list_facts', input: { category: 'brand_facts' } },
        { type: 'respond', text: "We haven't set a primary color yet." },
      ]),
    });
    expect(recall.toolCalls[0].result).not.toContain('deep forest green');
  });

  it('recall_memory (keyword-fallback path) is scope-filtered exactly like list_facts', async () => {
    createEvalSession(memory, 'client-a-write-3', clientContext('acme'));
    await runScriptedConversation({
      tools,
      userMessage: 'Our tagline is "Grow wild, grow real."',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'brand_facts', subject: 'tagline', content: 'Grow wild, grow real.' },
        },
        { type: 'respond', text: 'Noted.' },
      ]),
    });

    createEvalSession(memory, 'client-b-recall', clientContext('other-brand'));
    const recall = await runScriptedConversation({
      tools,
      userMessage: 'Remind me of our tagline.',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'recall_memory', input: { query: 'tagline' } },
        { type: 'respond', text: "We don't have one recorded yet." },
      ]),
    });
    expect(recall.toolCalls[0].result).not.toContain('Grow wild');
  });

  it("promoting a client-scoped lesson broadens it to world (agency-wide) — visible from another client's conversation by design, but STILL never visible from personal", async () => {
    // remember() while a client is active writes directly to that client's
    // scope (nearestScopeForCurrentSession) — there's no narrower "just this
    // chat" scope in the promotion ladder below a client. So the one legal
    // promotion step from a client-scoped fact is client -> world: a
    // DELIBERATE agency-wide broadening, not a leak. The isolation boundary
    // that must always hold regardless is personal (`user`) memory, which
    // this asserts stays untouched throughout.
    createEvalSession(memory, 'client-a-lesson', clientContext('acme'));
    const remembered = await runScriptedConversation({
      tools,
      userMessage: 'Lesson learned: always lead marketing copy with the benefit, not the feature.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'lessons', subject: 'copy_structure', content: 'Lead with the benefit' },
        },
        { type: 'respond', text: 'Got it, I\u2019ll apply that going forward.' },
      ]),
    });
    const savedId = JSON.parse(remembered.toolCalls[0].result).id as number;
    expect(typeof savedId).toBe('number');

    const promoted = await runScriptedConversation({
      tools,
      userMessage: 'That lesson should apply agency-wide, not just this brand.',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'promote_memory', input: { id: savedId } },
        { type: 'respond', text: 'Promoted \u2014 this now applies agency-wide.' },
      ]),
    });
    const promotedBody = JSON.parse(promoted.toolCalls[0].result);
    expect(promotedBody.success).toBe(true);
    expect(promotedBody.scope).toBe('world');

    // A brand-new conversation under a DIFFERENT client now sees it —
    // intentional, since promoting to world means "share with everyone".
    createEvalSession(memory, 'client-b-checks-lesson', clientContext('other-brand'));
    const otherBrandRecall = await runScriptedConversation({
      tools,
      userMessage: 'What have we learned about writing marketing copy?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'list_facts', input: { category: 'lessons' } },
        { type: 'respond', text: 'Lead with the benefit, not the feature.' },
      ]),
    });
    expect(otherBrandRecall.toolCalls[0].result).toContain('Lead with the benefit');

    // The one boundary that never moves: personal memory still sees nothing.
    createEvalSession(memory, 'personal-checks-lesson', personalContext());
    const personalRecall = await runScriptedConversation({
      tools,
      userMessage: 'What have we learned about writing marketing copy?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'list_facts', input: { category: 'lessons' } },
        { type: 'respond', text: "I don't have anything like that for you personally." },
      ]),
    });
    expect(personalRecall.toolCalls[0].result).not.toContain('Lead with the benefit');
  });

  it('a reserved-category write is blocked through the conversation path, and a corrective retry with a valid category succeeds', async () => {
    createEvalSession(memory, 'reserved-category-convo', clientContext('acme'));

    const result = await runScriptedConversation({
      tools,
      userMessage: 'Remember that our brand voice is playful and warm.',
      policy: scriptedPolicy([
        // First attempt: the (fake) model picks the WRONG, reserved category.
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'how_to_act', subject: 'voice', content: 'playful and warm' },
        },
        // Corrective retry after reading the tool's error, using an allowed category.
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'brand_facts', subject: 'voice_note', content: 'playful and warm' },
        },
        { type: 'respond', text: 'Noted your brand voice preference.' },
      ]),
    });

    expect(result.toolCalls[0].result).toContain('managed by its own dedicated flow');
    expect(JSON.parse(result.toolCalls[0].result).error).toBeDefined();
    expect(JSON.parse(result.toolCalls[1].result).success).toBe(true);
  });
});

describe('eval: how_to_act voice injection through a scripted conversation', () => {
  let memory: MemoryManager;

  beforeEach(async () => {
    memory = await createEvalMemory();
  });

  afterEach(() => {
    memory.close();
  });

  it("the client's brand voice is present in what the (fake) model sees for a client-context conversation", async () => {
    memory.saveFact('how_to_act', 'voice', 'Bold, punchy, never corporate', false, 'client:acme');
    createEvalSession(memory, 'voice-client-convo', clientContext('acme'));

    const { composeLaneRules } = await import('../../src/agent/lane-context');
    const composedForThisConversation = composeLaneRules('brand', clientContext('acme'));

    // The scripted "model" answers using exactly what its system prompt for
    // THIS conversation actually contains \u2014 the real composeLaneRules output.
    const result = await runScriptedConversation({
      tools: [],
      userMessage: "What's our brand voice?",
      policy: scriptedPolicy([{ type: 'respond', text: composedForThisConversation }]),
    });

    expect(result.finalText).toContain('Bold, punchy, never corporate');
  });

  it('the same brand voice is completely ABSENT from a personal-context conversation', async () => {
    memory.saveFact('how_to_act', 'voice', 'Bold, punchy, never corporate', false, 'client:acme');
    createEvalSession(memory, 'voice-personal-convo', personalContext());

    const { composeLaneRules } = await import('../../src/agent/lane-context');
    const composedForThisConversation = composeLaneRules('brand', personalContext());

    const result = await runScriptedConversation({
      tools: [],
      userMessage: "What's our brand voice?",
      policy: scriptedPolicy([{ type: 'respond', text: composedForThisConversation || 'no brand context here' }]),
    });

    expect(result.finalText).not.toContain('Bold, punchy, never corporate');
  });

  it('a banned-word write is blocked mid-conversation, and a corrective retry with clean copy succeeds', async () => {
    createEvalSession(memory, 'banned-word-convo', clientContext('acme'));
    memory.saveFact('how_to_act', 'banned_words', 'synergybuzzword', false, 'client:acme');
    mockWriteExecute.mockReset();
    mockWriteExecute.mockResolvedValue('wrote ok');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const tools = await getToolsFor('brand');
    const result = await runScriptedConversation({
      tools,
      userMessage: 'Draft the landing page headline.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'write',
          input: { file_path: '/tmp/headline.md', content: 'Unlock true synergybuzzword today.' },
        },
        {
          type: 'tool_call',
          name: 'write',
          input: { file_path: '/tmp/headline.md', content: 'Grow your brand, the honest way.' },
        },
        { type: 'respond', text: 'Headline drafted.' },
      ]),
    });

    expect(result.toolCalls[0].result).toContain('blocked by tone guard');
    // The underlying write stub was reached exactly once — by the corrective
    // retry, never by the first (blocked) attempt.
    expect(mockWriteExecute).toHaveBeenCalledTimes(1);
    expect(mockWriteExecute).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Grow your brand, the honest way.' }),
      expect.anything()
    );
    expect(result.toolCalls[1].result).toBe('wrote ok'); // corrective retry went through
    vi.restoreAllMocks();
  });
});

describe('eval: agentic-loop routing through a scripted conversation', () => {
  let memory: MemoryManager;
  let tmpAuditRoot: string;

  beforeEach(async () => {
    memory = await createEvalMemory();
    tmpAuditRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-routing-log-'));
    process.env.AUDIT_LOG_ROOT_OVERRIDE = tmpAuditRoot;
  });

  afterEach(() => {
    memory.close();
    delete process.env.AUDIT_LOG_ROOT_OVERRIDE;
    fs.rmSync(tmpAuditRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('an on-topic request triggers an ON-GRAPH mode handoff, accepted', async () => {
    const { setSwitchModeCallback, setGetSessionIdCallback, setGetCurrentModeCallback } = await import(
      '../../src/tools/agent-mode-tools'
    );
    const sessionId = createEvalSession(memory, 'handoff-ok-convo', clientContext('acme'));
    setGetSessionIdCallback(() => sessionId);
    setGetCurrentModeCallback(() => 'general');
    setSwitchModeCallback(async (_sid, mode) => `Switched to ${mode} mode.`);

    const tools = await getToolsFor();
    const result = await runScriptedConversation({
      tools,
      userMessage: 'Can you review this logo concept for accessibility contrast?',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'switch_agent',
          input: { mode: 'design', reason: 'user wants a design review' },
        },
        { type: 'respond', text: 'Switching to design mode to help with that.' },
      ]),
    });

    expect(result.toolCalls[0].result).toContain('Switched to design mode');
  });

  it('an off-graph handoff attempt is rejected with the corrective list of valid targets', async () => {
    const { setSwitchModeCallback, setGetSessionIdCallback, setGetCurrentModeCallback } = await import(
      '../../src/tools/agent-mode-tools'
    );
    const sessionId = createEvalSession(memory, 'handoff-reject-convo', personalContext());
    setGetSessionIdCallback(() => sessionId);
    setGetCurrentModeCallback(() => 'therapist'); // therapist can only hand off to 'general'
    setSwitchModeCallback(async (_sid, mode) => `Switched to ${mode} mode.`);

    const tools = await getToolsFor();
    const result = await runScriptedConversation({
      tools,
      userMessage: 'Can you write some code for me?',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'switch_agent', input: { mode: 'coder', reason: 'user wants code' } },
        { type: 'respond', text: "I can't jump straight to coder from here, let me hand off properly." },
      ]),
    });

    expect(result.toolCalls[0].result).toContain('Cannot switch directly from therapist to coder');
    expect(result.toolCalls[0].result).toContain('general'); // the one valid target is named
  });

  it('a valid skill load succeeds; an invalid one is rejected with the valid skill list', async () => {
    createEvalSession(memory, 'skill-convo', clientContext('acme'));
    const tools = await getToolsFor('design');

    const good = await runScriptedConversation({
      tools,
      userMessage: 'Walk me through a design review for this screen.',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'skill', input: { skill: 'design-review' } },
        { type: 'respond', text: 'Starting the design review workflow.' },
      ]),
    });
    expect(good.toolCalls[0].result).not.toContain('Unknown skill');

    const bad = await runScriptedConversation({
      tools,
      userMessage: 'Run the "brand-storytelling-arc" skill.',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'skill', input: { skill: 'brand-storytelling-arc' } },
        { type: 'respond', text: "That skill doesn't exist here \u2014 let me check what's available." },
      ]),
    });
    expect(bad.toolCalls[0].result).toContain('Unknown skill "brand-storytelling-arc"');
  });

  it('an enabled specialist dispatches successfully; a disabled one is rejected before spawning', async () => {
    createEvalSession(memory, 'specialist-convo', clientContext('acme'));
    const tools = await getToolsFor('design');

    const okRun = await runScriptedConversation({
      tools,
      userMessage: 'Have the design reviewer critique this mockup.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'subagent',
          input: { task: 'critique this mockup', agent: 'design-reviewer' },
        },
        { type: 'respond', text: 'Here is the critique.' },
      ]),
    });
    expect(okRun.toolCalls[0].result).toContain('specialist work complete');

    memory.saveFact('enabled-agents', 'atelier:design-reviewer', 'false', false, 'client:acme');
    const disabledTools = await getToolsFor('design');
    const blockedRun = await runScriptedConversation({
      tools: disabledTools,
      userMessage: 'Have the design reviewer critique this mockup.',
      policy: scriptedPolicy([
        {
          type: 'tool_call',
          name: 'subagent',
          input: { task: 'critique this mockup', agent: 'design-reviewer' },
        },
        { type: 'respond', text: 'That specialist is unavailable right now.' },
      ]),
    });
    expect(blockedRun.toolCalls[0].result).toContain('Unknown or disabled specialist "design-reviewer"');
  });

  it('the routing log captures every decision above (mode switch, skill load, specialist spawn) as queryable entries', async () => {
    const { setSwitchModeCallback, setGetSessionIdCallback, setGetCurrentModeCallback } = await import(
      '../../src/tools/agent-mode-tools'
    );
    const { getRecentRoutingLogEntries } = await import('../../src/utils/routing-log');
    const sessionId = createEvalSession(memory, 'routing-log-convo', clientContext('acme'));
    setGetSessionIdCallback(() => sessionId);
    setGetCurrentModeCallback(() => 'general');
    setSwitchModeCallback(async (_sid, mode) => `Switched to ${mode} mode.`);

    const tools = await getToolsFor('design');
    await runScriptedConversation({
      tools,
      userMessage: 'Switch to design mode, then review this using the design-review skill.',
      policy: scriptedPolicy([
        { type: 'tool_call', name: 'switch_agent', input: { mode: 'design', reason: 'design work' } },
        { type: 'tool_call', name: 'skill', input: { skill: 'design-review' } },
        { type: 'tool_call', name: 'skill', input: { skill: 'not-a-real-skill' } },
        {
          type: 'tool_call',
          name: 'subagent',
          input: { task: 'do it', agent: 'design-reviewer' },
        },
        { type: 'respond', text: 'All done.' },
      ]),
    });

    const entries = getRecentRoutingLogEntries(20);
    const kinds = entries.map((e) => `${e.kind}:${e.outcome}`);
    expect(kinds).toContain('mode_switch:accepted');
    expect(kinds).toContain('skill_load:accepted');
    expect(kinds).toContain('skill_load:rejected');
    expect(kinds).toContain('subagent_spawn:accepted');
  });
});
