/**
 * Sub-Agent Tool — spawns a clean, isolated in-process sub-agent using agentLoop().
 *
 * Sub-agents are stateless workers. They get:
 * - A task (user message)
 * - A minimal system prompt (no personality, no memory, no context)
 * - A small set of utility tools (web_fetch, shell, browser)
 * - Turn and output limits
 *
 * They do NOT get: facts, soul, conversation history, memory tools, scheduler, etc.
 * Clean slate. Do the job. Report back.
 */

import { z } from 'zod';
import { agentLoop } from '@kenkaiiii/gg-agent';
import type { AgentTool, AgentOptions, ToolContext } from '@kenkaiiii/gg-agent';
import type { Message } from '@kenkaiiii/gg-ai';
import type { StreamConfig } from '../agent/chat-providers';
import { registerSubAgent, updateSubAgent, removeSubAgent } from './subagent-registry';
import { SettingsManager } from '../settings';
import { allAgentsGrouped } from '../marketplace/registry';
import type { LaneId, PackAgent } from '../marketplace/types';
import { SUPPORTED_MODELS, isKnownModel, getProviderForModel } from '../agent/model-catalog';
import { resolvePackAgentForCurrentSession } from '../agent/agent-overrides';
import { isAgentEnabledForCurrentSession } from '../agent/enablement';
import { getCurrentSessionId } from './session-context';
import { recordRoutingDecision } from '../utils/routing-log';

// ── Constants ──

const SUB_AGENT_MAX_TURNS = 15;
const SUB_AGENT_MAX_OUTPUT_CHARS = 100_000;
const SUB_AGENT_TIMEOUT_MS = 300_000; // 5 minutes

/**
 * Resource ceilings for a single sub-agent run. Defaults to the module
 * constants above (production behavior, unchanged); `createSubAgentTool`'s
 * optional 4th param lets tests inject small values to force turn/timeout/
 * truncation limits without mocking timers or the whole module.
 */
export interface SubAgentLimits {
  maxTurns: number;
  maxOutputChars: number;
  timeoutMs: number;
}

const DEFAULT_SUB_AGENT_LIMITS: SubAgentLimits = {
  maxTurns: SUB_AGENT_MAX_TURNS,
  maxOutputChars: SUB_AGENT_MAX_OUTPUT_CHARS,
  timeoutMs: SUB_AGENT_TIMEOUT_MS,
};

/** Only these tools are available to sub-agents. Everything else is parent-only. */
const ALLOWED_SUB_AGENT_TOOLS = new Set([
  'web_fetch',
  'shell_command',
  'mcp__pocket-agent__browser',
  'mcp__pocket-agent__notify',
]);

const SUB_AGENT_SYSTEM_PROMPT =
  "You are a task worker. Execute the given task completely and efficiently. No small talk, no explanations unless asked. Do the work, report what you did and the result. If something fails, say what failed and why. That's it.";

/** Maps Claude Code tool names (used by marketplace pack agents) to r3to.os tool names. */
const CC_TO_POCKET_TOOL: Record<string, string> = {
  Read: 'read',
  Write: 'write',
  Edit: 'edit',
  Grep: 'shell_command',
  Glob: 'shell_command',
  Bash: 'shell_command',
  WebFetch: 'web_fetch',
  WebSearch: 'web_fetch',
};

/**
 * Look up a named specialist within a lane's pack agents, with any local
 * override (src/agent/agent-overrides.ts) for the current session merged over
 * the synced base. Returns null if the pack never defined this specialist for
 * this lane — an override alone can't invent one — or if the agent is
 * disabled for the current session's scope (src/agent/enablement.ts):
 * dispatch-time enforcement, not just a UI listing filter.
 */
export function resolveSpecialist(lane: LaneId, name: string): PackAgent | null {
  const found = allAgentsGrouped().find((g) => g.lane === lane && g.agent.name === name);
  if (!found) return null;
  if (!isAgentEnabledForCurrentSession(found.packId, found.agent.name)) return null;
  return resolvePackAgentForCurrentSession(found.packId, found.agent);
}

/**
 * Resolve a pack agent's declared `model` (e.g. "opus", a short Claude-Code-style
 * alias) to an actual app model id, falling back to the caller's configured model
 * when the agent declares none, when it's unresolvable, or when the best match's
 * provider differs from the configured model's (we never switch provider/credentials
 * on the user's behalf). Already-known full ids (e.g. "claude-opus-4-8") pass through.
 */
export function resolveSpecialistModel(alias: string | undefined, configuredModel: string): string {
  if (!alias) return configuredModel;
  if (isKnownModel(alias)) return alias;
  const needle = alias.toLowerCase();
  const provider = getProviderForModel(configuredModel);
  const match = SUPPORTED_MODELS.find(
    (m) => m.provider === provider && m.id.toLowerCase().includes(needle)
  );
  return match ? match.id : configuredModel;
}

/** Map Claude Code tool names to r3to.os tool names, dropping unknown ones. */
export function mapAgentTools(tools: string[]): string[] {
  const out = new Set<string>();
  for (const t of tools) {
    const mapped = CC_TO_POCKET_TOOL[t];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

// ── Parameters ──

const SubAgentParams = z.object({
  task: z.string().describe('The task to delegate to the sub-agent'),
  agent: z.string().optional().describe('Optional named specialist for this lane'),
});

// ── Factory ──

/**
 * Create the sub-agent tool.
 *
 * @param parentTools - The parent agent's full tool array (we pick only allowed ones)
 * @param getStreamConfig - Async function returning current provider/model config
 * @param lane - Optional lane the caller is operating in; when set, enables dispatch to
 *   named pack specialists via the `agent` param.
 * @param limits - Resource ceilings (maxTurns/maxOutputChars/timeoutMs). Defaults to
 *   the production constants; tests inject small values to force each limit.
 */
export function createSubAgentTool(
  parentTools: AgentTool[],
  getStreamConfig: (model: string) => Promise<StreamConfig>,
  lane?: LaneId,
  limits: SubAgentLimits = DEFAULT_SUB_AGENT_LIMITS
): AgentTool<typeof SubAgentParams> {
  const specialistNames = lane
    ? allAgentsGrouped()
        .filter((g) => g.lane === lane && isAgentEnabledForCurrentSession(g.packId, g.agent.name))
        .map((g) => g.agent.name)
    : [];
  const description = specialistNames.length
    ? `Spawn a clean, isolated sub-agent to handle a focused task. The sub-agent has no memory, no personality, no conversation context — just tools (web_fetch, shell, browser) and a task. Use for work that benefits from isolation or parallelism. Blocks until complete. Optionally set "agent" to dispatch to a named specialist for this lane: ${specialistNames.join(', ')}.`
    : 'Spawn a clean, isolated sub-agent to handle a focused task. The sub-agent has no memory, no personality, no conversation context — just tools (web_fetch, shell, browser) and a task. Use for work that benefits from isolation or parallelism. Blocks until complete.';

  return {
    name: 'subagent',
    description,
    parameters: SubAgentParams,
    execute: async (
      args: z.infer<typeof SubAgentParams>,
      context: ToolContext
    ): Promise<string> => {
      const { task } = args;

      // Validate a named-specialist request BEFORE spawning anything — an
      // unknown or disabled specialist used to fall through silently to the
      // generic worker prompt with no feedback to the caller at all. Now it
      // gets a corrective, actionable error (the valid specialist list for
      // this lane) and never starts a sub-agent run.
      if (args.agent) {
        if (!lane) {
          recordRoutingDecision({
            sessionId: getCurrentSessionId(),
            kind: 'subagent_spawn',
            target: args.agent,
            outcome: 'rejected',
            detail: 'No lane is active for specialist dispatch',
          });
          return `Error: no lane is active, so named specialists aren't available ("${args.agent}" requires a design/product/brand/social lane). Call subagent without "agent" for a generic worker.`;
        }
        const validNames = allAgentsGrouped()
          .filter((g) => g.lane === lane && isAgentEnabledForCurrentSession(g.packId, g.agent.name))
          .map((g) => g.agent.name);
        if (!validNames.includes(args.agent)) {
          const detail = `Unknown or disabled specialist "${args.agent}" for the ${lane} lane. Available: ${validNames.join(', ') || 'none'}.`;
          recordRoutingDecision({
            sessionId: getCurrentSessionId(),
            kind: 'subagent_spawn',
            target: args.agent,
            lane,
            outcome: 'rejected',
            detail,
          });
          return `Error: ${detail}`;
        }
        recordRoutingDecision({
          sessionId: getCurrentSessionId(),
          kind: 'subagent_spawn',
          target: args.agent,
          lane,
          outcome: 'accepted',
        });
      }

      const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Register for tracking
      registerSubAgent({
        id,
        task,
        status: 'running',
        startedAt: new Date(),
        toolUseCount: 0,
        tokenUsage: { input: 0, output: 0 },
        currentActivity: 'starting',
      });

      try {
        // Resolve a named specialist when the caller asked for one and a lane is set.
        // Falls back to the generic worker prompt/tool set otherwise — unchanged behavior.
        // (Already validated as resolvable above when args.agent is set.)
        const spec = args.agent && lane ? resolveSpecialist(lane, args.agent) : null;
        const system = spec ? spec.prompt : SUB_AGENT_SYSTEM_PROMPT;
        const allowedToolNames = spec
          ? new Set([...mapAgentTools(spec.tools), ...ALLOWED_SUB_AGENT_TOOLS])
          : ALLOWED_SUB_AGENT_TOOLS;

        // Build sub-agent tool set — only explicitly allowed tools
        const subTools = parentTools.filter((t) => allowedToolNames.has(t.name));

        // Get provider config — a named specialist's declared model (e.g. "opus")
        // wins when it resolves to a same-provider app model; otherwise falls back
        // to the user's configured model, same as the generic worker path.
        const configuredModel = SettingsManager.get('agent.model') || 'claude-sonnet-4-6';
        const model = spec ? resolveSpecialistModel(spec.model, configuredModel) : configuredModel;
        const streamConfig = await getStreamConfig(model);

        // Clean agent options — no context, no facts, no memory, no soul
        const agentOptions: AgentOptions = {
          provider: streamConfig.provider,
          model,
          system,
          tools: subTools,
          webSearch: true,
          maxTurns: limits.maxTurns,
          maxTokens: 8192,
          apiKey: streamConfig.apiKey,
          baseUrl: streamConfig.baseUrl,
          signal: context.signal,
        };

        // Fresh messages — just the task, nothing else
        const messages: Message[] = [{ role: 'user', content: task }];

        // Run with timeout
        const result = await Promise.race([
          runSubAgent(id, messages, agentOptions, context),
          timeout(limits.timeoutMs, context.signal),
        ]);

        // Truncate output
        const output = truncateOutput(result, limits.maxOutputChars);

        updateSubAgent(id, { status: 'done', result: output });
        return output;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateSubAgent(id, { status: 'error', error: errorMsg });

        if (errorMsg.includes('aborted') || errorMsg.includes('timed out')) {
          return `Sub-agent was stopped: ${errorMsg}`;
        }
        return `Sub-agent failed: ${errorMsg}`;
      } finally {
        // Clean up after a delay to allow status reads
        setTimeout(() => removeSubAgent(id), 60_000);
      }
    },
  };
}

// ── Helpers ──

/**
 * Run the sub-agent loop and collect the response text.
 */
async function runSubAgent(
  id: string,
  messages: Message[],
  options: AgentOptions,
  context: ToolContext
): Promise<string> {
  const loop = agentLoop(messages, options);
  let response = '';
  let toolUseCount = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for await (const event of loop) {
    // Check abort
    if (context.signal.aborted) {
      throw new Error('Sub-agent aborted');
    }

    switch (event.type) {
      case 'text_delta':
        response += event.text;
        break;

      case 'tool_call_start':
        toolUseCount++;
        updateSubAgent(id, {
          toolUseCount,
          currentActivity: `Using ${event.name}`,
        });
        break;

      case 'tool_call_end':
        updateSubAgent(id, { currentActivity: 'processing' });
        break;

      case 'turn_end':
        totalInput += event.usage.inputTokens;
        totalOutput += event.usage.outputTokens;
        updateSubAgent(id, {
          tokenUsage: { input: totalInput, output: totalOutput },
        });
        break;

      case 'agent_done':
        console.log(
          `[SubAgent:${id}] Done — ${event.totalTurns} turns, ${event.totalUsage.inputTokens + event.totalUsage.outputTokens} tokens`
        );
        break;

      case 'error':
        console.error(`[SubAgent:${id}] Error:`, event.error);
        throw event.error;
    }
  }

  return response || 'Sub-agent completed with no text output.';
}

/**
 * Truncate output to fit within parent context limits.
 */
function truncateOutput(text: string, maxChars: number = SUB_AGENT_MAX_OUTPUT_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[Output truncated at ${maxChars.toLocaleString()} chars]`;
}

/**
 * Create a timeout promise that rejects after the given duration.
 */
function timeout(ms: number, signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sub-agent timed out after ${ms}ms`)), ms);

    // If parent is aborted, clear the timer and reject
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Sub-agent aborted'));
      },
      { once: true }
    );
  });
}
