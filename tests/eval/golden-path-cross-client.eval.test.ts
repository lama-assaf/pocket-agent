/**
 * STAGE C — golden-path replay of the hand-authored fixtures in
 * tests/eval/fixtures/cross-client-leakage.fixture.ts, through the SAME
 * scripted-conversation harness as scripted-conversations.eval.test.ts. See
 * that fixture file's header for why hand-authored fixtures (not live
 * recording) were chosen.
 *
 * Same mocking policy as scripted-conversations.eval.test.ts, trimmed to
 * just what these fixtures use (remember/list_facts only \u2014 no write/skill/
 * subagent/switch_agent turns in any golden path here, so no ggcoder/
 * chat-providers/gg-agent mocks are needed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { vi } from 'vitest';
import type { AgentTool } from '@kenkaiiii/gg-agent';
import type { MemoryManager } from '../../src/memory/index';
import { createEvalMemory, createEvalSession } from './setup';
import { runScriptedConversation } from './harness';
import {
  ALL_GOLDEN_PATH_FIXTURES,
  TWO_COMPETING_BRANDS_FIXTURE,
  PERSONAL_HEALTH_VS_SHARED_FACT_FIXTURE,
  RAPID_CONTEXT_SWITCHING_FIXTURE,
  type Fixture,
} from './fixtures/cross-client-leakage.fixture';

vi.mock('../../src/tools', async () => {
  const { getMemoryTools } = await import('../../src/tools/memory-tools');
  return { getCustomTools: () => [...getMemoryTools()] };
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
    embedText: async () => {
      throw new Error('no embedding model in the eval harness (by design)');
    },
  };
});

async function getEvalTools(): Promise<AgentTool[]> {
  // These fixtures only exercise remember/list_facts \u2014 the curated real
  // subset above is enough; no lane, no ggcoder file tools needed.
  const { getMemoryTools } = await import('../../src/tools/memory-tools');
  const { jsonSchemaToZod } = await import('../../src/agent/schema-utils');
  return getMemoryTools().map((tool) => {
    const schema = tool.input_schema as { properties?: Record<string, unknown>; required?: string[] };
    return {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchemaToZod(schema.properties || {}, schema.required || []),
      execute: async (args: unknown) => tool.handler(args),
    } as AgentTool;
  });
}

/** Replay every turn in a fixture in order, keyed by its label for assertions. */
async function replayFixture(
  memory: MemoryManager,
  tools: AgentTool[],
  fixture: Fixture
): Promise<Map<string, Awaited<ReturnType<typeof runScriptedConversation>>>> {
  const results = new Map<string, Awaited<ReturnType<typeof runScriptedConversation>>>();
  for (const turn of fixture.turns) {
    createEvalSession(memory, turn.sessionName, turn.context);
    const result = await runScriptedConversation({
      tools,
      userMessage: turn.userMessage,
      policy: (() => {
        let i = 0;
        return () => {
          const step = turn.steps[i];
          i++;
          if (!step) throw new Error(`Fixture turn "${turn.label}" ran out of scripted steps`);
          return step;
        };
      })(),
    });
    results.set(turn.label, result);
  }
  return results;
}

describe('eval golden paths: cross-client / personal leakage (hand-authored recorded-style fixtures)', () => {
  let memory: MemoryManager;
  let tools: AgentTool[];

  beforeEach(async () => {
    memory = await createEvalMemory();
    tools = await getEvalTools();
  });

  afterEach(() => {
    memory.close();
  });

  it('sanity: all fixtures are wired up and non-empty', () => {
    expect(ALL_GOLDEN_PATH_FIXTURES.length).toBe(3);
    for (const fixture of ALL_GOLDEN_PATH_FIXTURES) {
      expect(fixture.turns.length).toBeGreaterThan(0);
    }
  });

  it('golden path 1: two competing brands\u2019 confidential positioning never crosses, even under a broad discovery question', async () => {
    const results = await replayFixture(memory, tools, TWO_COMPETING_BRANDS_FIXTURE);

    const lumenDiscovery = results.get('Brand Lumen: broad discovery question (the leak test)')!;
    expect(lumenDiscovery.toolCalls[0].result).toContain('Accessible pricing');
    expect(lumenDiscovery.toolCalls[0].result).not.toContain('$85');
    expect(lumenDiscovery.toolCalls[0].result).not.toContain('Lumen Skincare'); // Aurora's competitive intel about Lumen must not leak INTO Lumen's own view either

    const auroraDiscovery = results.get('Brand Aurora: broad discovery question (the leak test)')!;
    expect(auroraDiscovery.toolCalls[0].result).toContain('$85');
    expect(auroraDiscovery.toolCalls[0].result).toContain('Lumen Skincare'); // Aurora's OWN sensitive note about its target is visible to Aurora
    expect(auroraDiscovery.toolCalls[0].result).not.toContain('Accessible pricing');
  });

  it('golden path 2: a personal health disclosure never reaches any client, but a genuinely agency-wide rule reaches every client', async () => {
    const results = await replayFixture(memory, tools, PERSONAL_HEALTH_VS_SHARED_FACT_FIXTURE);

    const auroraView = results.get('Client Aurora: checks what it can see')!;
    expect(auroraView.toolCalls[0].result).not.toContain('anxiety');
    expect(auroraView.toolCalls[0].result).toContain('utilize');

    const lumenView = results.get('Client Lumen: checks what it can see')!;
    expect(lumenView.toolCalls[0].result).not.toContain('anxiety');
    expect(lumenView.toolCalls[0].result).toContain('utilize');
  });

  it('golden path 3: rapid context-switching in one sitting never cross-contaminates, and the origin client still sees its own fact after two hops away', async () => {
    const results = await replayFixture(memory, tools, RAPID_CONTEXT_SWITCHING_FIXTURE);

    const bView = results.get('Client B: second hop, immediately after A \u2014 must see nothing of A')!;
    expect(bView.toolCalls[0].result).not.toContain('Built for Winter');

    const worldView = results.get('World: third hop \u2014 must see neither client\u2019s campaign fact')!;
    expect(worldView.toolCalls[0].result).not.toContain('Built for Winter');

    const aAgainView = results.get('Client A: fourth hop, back to A \u2014 must still see its OWN fact from the first hop')!;
    expect(aAgainView.toolCalls[0].result).toContain('Built for Winter');
  });
});
