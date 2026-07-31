/**
 * STAGE D — nightly LIVE-MODEL eval suite: does the guardrail/voice
 * injection actually change what a REAL model writes, not just what our
 * deterministic scanner would flag if it did.
 *
 * Every other eval in this repo (Stage A-C) proves the deterministic side:
 * given some text, does scanForBannedTone flag the right words, does
 * composeLaneRules assemble the right prompt. None of them prove a live LLM
 * actually WRITES compliant copy when handed that prompt — that's
 * fundamentally unprovable without a real model call, which is why this
 * suite is gated and separate from the fast/deterministic unit + eval
 * suites (Stage A-C run in every `npm test`; this does not).
 *
 * Design: each case builds a REAL client voice/guardrail system prompt via
 * the REAL src/agent/lane-context.ts + src/agent/write-guards.ts code (same
 * as production), makes ONE live one-shot completion call (no tools, no
 * conversation state — keeps cost/flakiness minimal), and then checks the
 * LIVE output against a real, falsifiable property: either the REAL
 * `scanForBannedTone` scanner (banned-word cases) or a structural/semantic
 * property derived directly from that client's configured `voice` fact
 * (voice-consistency cases) — never exact-text matching.
 *
 * TWO BACKENDS (select via LIVE_EVAL_BACKEND):
 *  - 'api' (default): calls the Anthropic API directly via
 *    @kenkaiiii/gg-agent's agentLoop. Requires ANTHROPIC_API_KEY with an
 *    active credit balance.
 *  - 'claude-cli': shells out to the `claude` CLI (Claude Code), reusing the
 *    operator's already-authenticated subscription session — no API key or
 *    credit balance needed. Requires the `claude` binary on PATH and logged
 *    in. Model defaults to the fast/cheap `haiku` alias (override via
 *    LIVE_EVAL_CLI_MODEL). Invoked from a neutral cwd (os.tmpdir()), not this
 *    repo, so Claude Code doesn't pull this project's own CLAUDE.md/context
 *    into the completion (that would contaminate a from-scratch voice test).
 *
 * 6 cases: 3 clients x (banned-word compliance + voice-consistency), each
 * independent — one case failing doesn't invalidate the others.
 *
 * Gating (never runs as part of `npm test`/CI):
 *  - Requires RUN_LIVE_EVALS=1 in the environment.
 *  - Requires the SELECTED backend to actually be usable (API key present
 *    for 'api'; `claude` binary reachable for 'claude-cli') — the suite
 *    never silently falls back from one backend to the other; an
 *    unavailable backend skips cleanly via describe.skipIf, same contract
 *    as the missing-API-key case always had.
 *  - Run explicitly via:
 *      RUN_LIVE_EVALS=1 ANTHROPIC_API_KEY=sk-ant-... npm run eval:live
 *      RUN_LIVE_EVALS=1 LIVE_EVAL_BACKEND=claude-cli npm run eval:live
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import os from 'os';
import { agentLoop } from '@kenkaiiii/gg-agent';
import type { AgentOptions } from '@kenkaiiii/gg-agent';
import type { Message } from '@kenkaiiii/gg-ai';
import type { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import { clientContext } from './setup';

const LIVE_MODEL = 'claude-sonnet-4-6';
const CLI_MODEL = process.env.LIVE_EVAL_CLI_MODEL || 'haiku';
const BACKEND: 'api' | 'claude-cli' = process.env.LIVE_EVAL_BACKEND === 'claude-cli' ? 'claude-cli' : 'api';

/** Synchronous, cheap check — `describe.skipIf` needs its condition at collection time, before any test's async setup runs. */
function isClaudeCliAvailable(): boolean {
  try {
    execFileSync('claude', ['--version'], { encoding: 'utf-8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

const canRunLive =
  process.env.RUN_LIVE_EVALS === '1' &&
  (BACKEND === 'api' ? Boolean(process.env.ANTHROPIC_API_KEY) : isClaudeCliAvailable());

/** API backend: one live, tool-free completion call via the Anthropic SDK. Kept to a single turn (maxTurns: 1) to bound cost/latency. */
async function liveCompleteViaApi(system: string, userMessage: string): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: userMessage }];
  const options: AgentOptions = {
    provider: 'anthropic',
    model: LIVE_MODEL,
    system,
    tools: [],
    maxTurns: 1,
    maxTokens: 512,
    apiKey: process.env.ANTHROPIC_API_KEY,
  };
  let text = '';
  for await (const event of agentLoop(messages, options)) {
    if (event.type === 'text_delta') text += event.text;
  }
  return text;
}

/**
 * Appended to the CLI backend's system prompt only. Claude Code (unlike a
 * raw API completion) is a coding-agent product by default — even with
 * --disable-slash-commands and no tools, it can still volunteer a
 * conversational preamble and a trailing "Why this works" self-critique
 * around the requested copy. That self-critique is exactly where the aurora
 * banned-word case previously false-failed: the wrapper text NAMED a banned
 * word as an example of what it avoided, which the scanner (correctly) still
 * flags, since it can't distinguish "I used X" from "I did NOT use X" in
 * prose. Instructing the CLI to output ONLY the copy is the first, primary
 * fix; stripWrapperCommentary below is the belt-and-braces second layer for
 * whatever slips through.
 */
const CLI_OUTPUT_FORMAT_INSTRUCTION =
  '\n\nOutput format: respond with ONLY the requested copy itself. No preamble ' +
  '("Here is...", "I\'ve searched for..."), no explanation, no "Why this works" ' +
  'commentary, no headers, no bullet points, no markdown separators. Just the ' +
  'plain copy text and nothing else.';

/**
 * Belt-and-braces safety net for the claude-cli backend: even with
 * CLI_OUTPUT_FORMAT_INSTRUCTION above, a completion can still append
 * self-explanatory commentary after the actual copy (observed shape: the
 * requested copy, then a "---" separator, then a "**Why this works**"
 * heading and a bulleted rationale that can itself name a banned word as an
 * example of what it avoided). This mirrors production exactly:
 * `scanForBannedTone` (src/agent/write-guards.ts) only ever scans real
 * `write`-tool FILE content — it never sees an LLM's conversational
 * preamble/commentary, because that text never reaches a file in the real
 * write path. Stripping a trailing commentary block before assertions run
 * makes the eval measure the same thing production's guardrail actually
 * measures, instead of penalizing a CLI-only wrapper string that could never
 * occur in a real write() call. Scoped deliberately to TRAILING wrapper
 * sections only (a "---" line followed by a "Why this works"-style heading
 * or a bulleted rationale block) — never touches a leading preamble, so it
 * can't accidentally eat real copy that happens to start with a list.
 */
function stripWrapperCommentary(output: string): string {
  const lines = output.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!/^\s*-{3,}\s*$/.test(lines[i])) continue;
    const after = lines.slice(i + 1).join('\n');
    if (/why (this|it) works/i.test(after) || /^\s*[-*]\s+/m.test(after)) {
      return lines.slice(0, i).join('\n').trim();
    }
  }
  // No "---" separator found; still strip a bare "Why this works" heading
  // (and everything after it) in case the model omits the separator.
  const headingMatch = /^\s*#{0,6}\s*\*{0,2}why (this|it) works\*{0,2}\s*:?\s*$/im.exec(output);
  if (headingMatch) {
    return output.slice(0, headingMatch.index).trim();
  }
  return output.trim();
}

/**
 * claude-cli backend: shells out to `claude -p <prompt> --system-prompt
 * <system> --output-format text`, using the operator's own authenticated
 * Claude Code session instead of a metered API key. `--allowed-tools ""`
 * disables tool use (this is a one-shot completion, not an agent run);
 * `--disable-slash-commands` disables Claude Code's own built-in skills
 * (discovered the hard way: without it, an open-ended creative-writing
 * prompt sometimes triggers Claude Code's bundled "brainstorming" skill,
 * which asks clarifying questions and echoes the system prompt's own banned-
 * word list back as a bullet point instead of writing copy — a false
 * banned-word "violation" that's an artifact of Claude Code's own agentic
 * behavior, not the model ignoring the guardrail); `cwd: os.tmpdir()` runs
 * from a directory with no CLAUDE.md/project settings, so the completion
 * reflects ONLY the system prompt this test built, not this repo's own
 * agent context. The CLI_OUTPUT_FORMAT_INSTRUCTION suffix and
 * stripWrapperCommentary post-processing (both above) exist because Claude
 * Code, unlike a raw API completion, can still volunteer conversational
 * preamble/commentary around the requested copy even with tools disabled.
 */
function liveCompleteViaClaudeCli(system: string, userMessage: string): string {
  const raw = execFileSync(
    'claude',
    [
      '-p',
      userMessage,
      '--system-prompt',
      system + CLI_OUTPUT_FORMAT_INSTRUCTION,
      '--model',
      CLI_MODEL,
      '--output-format',
      'text',
      '--allowed-tools',
      '',
      '--disable-slash-commands',
    ],
    { encoding: 'utf-8', timeout: 60_000, cwd: os.tmpdir() }
  ).trim();
  return stripWrapperCommentary(raw);
}

async function liveComplete(system: string, userMessage: string): Promise<string> {
  return BACKEND === 'claude-cli'
    ? liveCompleteViaClaudeCli(system, userMessage)
    : liveCompleteViaApi(system, userMessage);
}

/** Structural/semantic voice-consistency check derived from a client's configured `voice` fact — never exact-text matching. */
interface VoiceCheck {
  /** Human-readable description of what's being asserted and why, tied to the voice fact's own wording. */
  description: string;
  check: (output: string) => { pass: boolean; detail: string };
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

describe.skipIf(!canRunLive)(
  `LIVE eval [backend=${BACKEND}${BACKEND === 'claude-cli' ? `, model=${CLI_MODEL}` : ''}]: guardrails measurably shape real model output`,
  () => {
    let memory: MemoryManager;

    beforeEach(async () => {
      const { MemoryManager: MM } = await import('../../src/memory/index');
      memory = new MM(':memory:');
      setMemoryManager(memory);
    });

    afterEach(() => {
      memory.close();
    });

    /**
     * Table of (client, banned words, voice, prompt, voice check) cases.
     * Each client independently covers both an enforcement axis (banned
     * words) and a style axis (voice-consistency) — 3 clients x 2 = 6 cases.
     */
    const CASES: Array<{
      clientId: string;
      voice: string;
      bannedWords: string;
      prompt: string;
      voiceCheck: VoiceCheck;
    }> = [
      {
        clientId: 'aurora',
        voice: 'Clinical, precise, zero hype — like a dermatologist, not a marketer.',
        bannedWords: 'revolutionary, game-changing, cutting-edge, unlock, elevate',
        prompt: 'Write two sentences of product copy for a new vitamin C serum.',
        // "zero hype" is the voice fact's own explicit claim — hype-driven marketing
        // copy leans on exclamation points and marks of excitement; clinical/precise
        // copy doesn't. This is the most direct structural proxy for "zero hype"
        // available without a second live model call to judge tone.
        voiceCheck: {
          description: 'zero hype (per the voice fact) -> no exclamation marks in the output',
          check: (output) => ({
            pass: !output.includes('!'),
            detail: `expected no "!" (hype marker) given voice="Clinical, precise, zero hype"; output had ${(output.match(/!/g) || []).length}`,
          }),
        },
      },
      {
        clientId: 'lumen',
        voice: 'Warm, casual, like a friend giving skincare advice over coffee.',
        bannedWords: 'leverage, synergy, utilize, robust, seamless',
        prompt: 'Write two sentences of product copy for a gentle daily moisturizer.',
        // "like a friend giving advice" is a direct-address relationship, not a
        // third-person product description — a friend talks TO you, not about
        // "the product". Checking for second-person address ("you"/"your") is a
        // direct structural read of that specific phrase in the voice fact.
        voiceCheck: {
          description: '"like a friend giving advice" (per the voice fact) -> addresses the reader directly ("you"/"your")',
          check: (output) => ({
            pass: /\b(you|your|you're|youre)\b/i.test(output),
            detail: `expected direct second-person address ("you"/"your") given voice mentions "a friend giving...advice"; output: ${output}`,
          }),
        },
      },
      {
        clientId: 'northwind',
        voice: 'Confident and short — never more than 12 words per sentence.',
        bannedWords: 'delve, tapestry, boundless, transformative, journey',
        prompt: 'Write two sentences of product copy for a winter-weight jacket.',
        // The voice fact states an explicit, checkable numeric constraint
        // ("never more than 12 words per sentence") — this is the strongest
        // possible structural assertion in this suite because it's not a proxy
        // for the voice, it IS the voice, verbatim.
        voiceCheck: {
          description: 'explicit numeric constraint in the voice fact -> every sentence has <=12 words',
          check: (output) => {
            const sentences = splitSentences(output);
            const overLong = sentences.filter((s) => s.split(/\s+/).filter(Boolean).length > 12);
            return {
              pass: sentences.length > 0 && overLong.length === 0,
              detail: `expected every sentence <=12 words given voice="...never more than 12 words per sentence"; over-long: ${JSON.stringify(overLong)}`,
            };
          },
        },
      },
    ];

    // A live model round-trip (either backend) routinely exceeds vitest's
    // default 10s testTimeout (vitest.config.ts), so every case here gets an
    // explicit, generous per-test timeout matching liveCompleteViaClaudeCli's
    // own execFileSync timeout.
    const LIVE_TEST_TIMEOUT_MS = 60_000;

    for (const testCase of CASES) {
      it(`(${testCase.clientId}) generated copy contains none of the client's banned words`, async () => {
        memory.saveFact('how_to_act', 'voice', testCase.voice, false, `client:${testCase.clientId}`);
        memory.saveFact(
          'how_to_act',
          'banned_words',
          testCase.bannedWords,
          false,
          `client:${testCase.clientId}`
        );

        const { composeLaneRules } = await import('../../src/agent/lane-context');
        const context = clientContext(testCase.clientId);
        const system = composeLaneRules('brand', context);

        const session = memory.createSession(`live-${testCase.clientId}-banned`, 'general', null);
        setCurrentSessionId(session.id);
        memory.setSessionContext(session.id, context);

        const output = await liveComplete(system, testCase.prompt);
        expect(output.length).toBeGreaterThan(0);

        const { scanForBannedTone } = await import('../../src/agent/write-guards');
        const scan = scanForBannedTone(output, context);
        expect(
          scan.hits,
          `live output contained a banned word: ${JSON.stringify(scan.hits)}\noutput: ${output}`
        ).toEqual([]);
      }, LIVE_TEST_TIMEOUT_MS);

      it(`(${testCase.clientId}) generated copy matches the client's configured voice: ${testCase.voiceCheck.description}`, async () => {
        memory.saveFact('how_to_act', 'voice', testCase.voice, false, `client:${testCase.clientId}`);
        memory.saveFact(
          'how_to_act',
          'banned_words',
          testCase.bannedWords,
          false,
          `client:${testCase.clientId}`
        );

        const { composeLaneRules } = await import('../../src/agent/lane-context');
        const context = clientContext(testCase.clientId);
        const system = composeLaneRules('brand', context);

        const session = memory.createSession(`live-${testCase.clientId}-voice`, 'general', null);
        setCurrentSessionId(session.id);
        memory.setSessionContext(session.id, context);

        const output = await liveComplete(system, testCase.prompt);
        expect(output.length).toBeGreaterThan(0);

        const result = testCase.voiceCheck.check(output);
        expect(result.pass, result.detail).toBe(true);
      }, LIVE_TEST_TIMEOUT_MS);
    }
  }
);

describe.skipIf(canRunLive)(
  'LIVE eval suite gating (runs in the normal suite so the skip path itself is verified)',
  () => {
    it('is skipped cleanly when RUN_LIVE_EVALS is unset, or the selected backend is unavailable — this assertion only runs to prove the OUTER describe.skipIf worked', () => {
      // If we got here, the live-eval describe block above was skipped (not
      // run, not failed) because canRunLive is false — exactly the "skip
      // cleanly when unconfigured" contract, now for EITHER backend. This
      // inverse describe.skipIf guarantees at least one assertion always runs
      // in a normal (unconfigured) `npm test`, so the gating logic itself has
      // coverage even though the live calls never fire.
      expect(canRunLive).toBe(false);
    });
  }
);
