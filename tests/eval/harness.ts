/**
 * Fake-LLM scripted-conversation eval harness (STAGE B).
 *
 * The gap this closes: every existing behavioral test calls a REAL tool
 * handler directly with a hand-picked input (routing-guard.test.ts,
 * how-to-act-injection.test.ts, subagent-named.test.ts, etc.) — none of them
 * simulate an actual multi-turn CONVERSATION where a (fake) model decides,
 * turn by turn, which tool to call next based on what happened so far. This
 * harness is that missing layer: a scripted `Policy` function stands in for
 * "what would the LLM do next", and everything downstream of that decision —
 * tool execution, MemoryManager, scope resolution, guardrail scanning,
 * routing-log writes — is 100% real production code, unmocked.
 *
 * This is NOT a mock of `@kenkaiiii/gg-agent`'s agentLoop event protocol
 * (turn_start/tool_call_start/tool_call_end/turn_end/agent_done) — that
 * protocol is already covered by chat-engine.test.ts's plumbing tests, and
 * replicating it here would only add ceremony without adding behavioral
 * coverage. Instead this harness models the same DECISION LOOP shape
 * agentLoop drives — "given the conversation so far and the tools available,
 * what's the next action" — directly against real `AgentTool[]`, which is
 * the same tool-array shape every real chat mode/lane assembles via
 * `getChatAgentTools`/`getCoderAgentTools` (src/agent/chat-tools.ts).
 */
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';

/** One entry in the scripted conversation transcript, in chronological order. */
export type ScriptEntry =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }
  | { role: 'tool_call'; name: string; input: unknown }
  | { role: 'tool_result'; name: string; result: string };

/** The fake model's next move: call a tool, or produce a final response. */
export type PolicyAction =
  | { type: 'tool_call'; name: string; input: unknown }
  | { type: 'respond'; text: string };

/**
 * A scripted policy stands in for the LLM's decision-making. It receives the
 * conversation transcript so far and the tools actually available this turn,
 * and returns what the (fake) model decides to do next. Scenario tests
 * typically implement this as a simple turn-indexed script (see
 * `scriptedPolicy` below) rather than hand-rolling a closure each time.
 */
export type Policy = (
  transcript: ScriptEntry[],
  availableTools: AgentTool[]
) => PolicyAction | Promise<PolicyAction>;

export interface RunScriptedConversationOptions {
  /** The REAL tool array for this scenario (e.g. from getChatAgentTools). */
  tools: AgentTool[];
  /** The scripted "model". */
  policy: Policy;
  /** The user's opening message. */
  userMessage: string;
  /** Safety cap so a buggy policy can't spin forever. Default 10. */
  maxTurns?: number;
}

export interface ScriptedConversationResult {
  transcript: ScriptEntry[];
  /** The final `respond` action's text, or null if maxTurns was hit first. */
  finalText: string | null;
  /** Convenience view: every tool_call/tool_result pair, in order. */
  toolCalls: Array<{ name: string; input: unknown; result: string }>;
}

/** Fresh, unaborted ToolContext for one tool call. */
function makeToolContext(): ToolContext {
  return { signal: new AbortController().signal, toolCallId: `eval_${Math.random().toString(36).slice(2)}` };
}

/** Render a tool's execute() result (string | StructuredToolResult) down to a plain string for the transcript. */
function resultToString(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content;
    return typeof content === 'string' ? content : JSON.stringify(content);
  }
  return JSON.stringify(result);
}

/**
 * Run one scripted conversation against a REAL tool array. Each turn: ask the
 * policy what to do next given the transcript so far; if it calls a tool,
 * find that tool BY NAME in the real `tools` array (an unknown name is not
 * special-cased — the scenario author is expected to name a real tool, same
 * as a real model would; a hallucinated tool name is a policy bug, not
 * something this harness papers over) and execute it for real; if it
 * responds, stop. This is the FakeModel: the only scripted part is which
 * tool to call and with what input — the tool call itself, the memory
 * writes/reads, the scope resolution, and the guardrail scans it triggers
 * are all the genuine production code path.
 */
export async function runScriptedConversation(
  opts: RunScriptedConversationOptions
): Promise<ScriptedConversationResult> {
  const { tools, policy, userMessage, maxTurns = 10 } = opts;
  const transcript: ScriptEntry[] = [{ role: 'user', content: userMessage }];
  const toolCalls: ScriptedConversationResult['toolCalls'] = [];

  for (let turn = 0; turn < maxTurns; turn++) {
    const action = await policy(transcript, tools);

    if (action.type === 'respond') {
      transcript.push({ role: 'assistant', content: action.text });
      return { transcript, finalText: action.text, toolCalls };
    }

    const tool = tools.find((t) => t.name === action.name);
    if (!tool) {
      throw new Error(
        `Scripted policy called unknown tool "${action.name}". Available: ${tools.map((t) => t.name).join(', ')}`
      );
    }

    transcript.push({ role: 'tool_call', name: action.name, input: action.input });
    const rawResult = await tool.execute(action.input as never, makeToolContext());
    const result = resultToString(rawResult);
    transcript.push({ role: 'tool_result', name: action.name, result });
    toolCalls.push({ name: action.name, input: action.input, result });
  }

  return { transcript, finalText: null, toolCalls };
}

/**
 * Build a Policy from a plain ordered script of actions — the common case
 * for scenario tests ("call tool X, then respond with Y"), so most scenarios
 * never need to hand-write a policy closure. `scriptFn` receives the same
 * (transcript, tools) the real Policy type does, in case a scenario needs to
 * branch on a tool's result (e.g. "if the skill load failed, retry with the
 * corrected name") — most scripts ignore it and just return `steps[turn]`.
 */
export function scriptedPolicy(steps: PolicyAction[]): Policy {
  let turn = 0;
  return () => {
    const action = steps[turn];
    turn++;
    if (!action) {
      throw new Error(
        `scriptedPolicy exhausted its ${steps.length}-step script but the conversation asked for another turn — add a step or a terminal 'respond'.`
      );
    }
    return action;
  };
}
