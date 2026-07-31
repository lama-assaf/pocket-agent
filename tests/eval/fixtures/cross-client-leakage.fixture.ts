/**
 * STAGE C — recorded-style golden-path fixtures for the highest-risk
 * scenario (cross-client / personal data leakage).
 *
 * Choice of fixture strategy: HAND-AUTHORED, not live-recorded. This
 * codebase has no existing infra for capturing real model API calls into
 * replayable cassettes (no VCR-style HTTP recorder, no stored transcripts
 * anywhere in tests/), and building one purely to produce 2-3 golden-path
 * fixtures would be a disproportionate one-off investment — a real record/
 * replay harness is only worth its upkeep cost if MANY tests will use it.
 * Hand-authoring instead gets the actual value a "golden path" fixture is
 * for here: a REALISTIC, multi-turn, frozen transcript (more turns, more
 * natural pacing, more simultaneous facts in flight than the terser
 * scripted-conversation unit tests in scripted-conversations.eval.test.ts)
 * that stays fixed over time so a regression shows up as a diff against a
 * known-good shape, without needing a live LLM or recorded network traffic.
 *
 * Each fixture is data only (a list of per-session recorded turns) — the
 * actual replay + assertions live in
 * tests/eval/golden-path-cross-client.eval.test.ts, using the SAME
 * `runScriptedConversation`/`scriptedPolicy` harness as every other eval.
 */
import type { PolicyAction } from '../harness';
import type { SessionContext } from '../../../src/memory/sessions';
import { personalContext, clientContext, worldContext } from '../setup';

export interface FixtureTurn {
  /** Human label for the assertion output / failure messages. */
  label: string;
  sessionName: string;
  context: SessionContext;
  userMessage: string;
  steps: PolicyAction[];
}

export interface Fixture {
  name: string;
  description: string;
  turns: FixtureTurn[];
}

// Reuse the same context builders every scripted-conversation eval uses
// (tests/eval/setup.ts), instead of a second, fixture-local definition.
const personal = personalContext();
const client = clientContext;
const world = worldContext();

/**
 * Golden path 1: two competing brands' confidential positioning is entered
 * across several turns each (a realistic onboarding conversation, not a
 * single remember() call), then each brand asks a broad discovery question
 * ("what do we know so far") that would surface EVERYTHING in scope if
 * isolation were broken \u2014 the strongest possible leak detector, since it
 * doesn't rely on guessing which single fact might leak.
 */
export const TWO_COMPETING_BRANDS_FIXTURE: Fixture = {
  name: 'two-competing-brands-onboarding',
  description:
    "Recorded-style onboarding for two competing skincare brands in the same agency workspace, each sharing confidential positioning across several turns, then each asking a broad 'what do we know' discovery question that would surface any leak.",
  turns: [
    {
      label: 'Brand Aurora: confidential pricing strategy',
      sessionName: 'aurora-onboarding-1',
      context: client('aurora'),
      userMessage: "We're premium-only \u2014 our floor price is $85, and we never discount below that, even in sales.",
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'positioning', subject: 'price_floor', content: 'Never discount below $85, premium-only positioning' },
        },
        { type: 'respond', text: "Got it \u2014 premium-only, $85 floor, no exceptions." },
      ],
    },
    {
      label: 'Brand Aurora: competitive intel',
      sessionName: 'aurora-onboarding-2',
      context: client('aurora'),
      userMessage: "Our real target is to take share from Lumen Skincare specifically \u2014 don't mention that publicly though.",
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'positioning', subject: 'competitive_target', content: 'Target: take share from Lumen Skincare (internal only)', sensitive: true },
        },
        { type: 'respond', text: "Noted \u2014 kept internal." },
      ],
    },
    {
      label: 'Brand Lumen: confidential pricing strategy (the rival)',
      sessionName: 'lumen-onboarding-1',
      context: client('lumen'),
      userMessage: "We're the accessible option \u2014 everything under $30, and we run a sale almost every month.",
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'positioning', subject: 'price_floor', content: 'Accessible pricing, under $30, frequent sales' },
        },
        { type: 'respond', text: "Got it \u2014 accessible, under $30, frequent promotions." },
      ],
    },
    {
      label: 'Brand Lumen: broad discovery question (the leak test)',
      sessionName: 'lumen-discovery',
      context: client('lumen'),
      userMessage: 'Before we brief the new copywriter \u2014 remind me everything we know about our positioning so far.',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: { category: 'positioning' } },
        { type: 'respond', text: 'Summarizing what we have on file for Lumen.' },
      ],
    },
    {
      label: 'Brand Aurora: broad discovery question (the leak test)',
      sessionName: 'aurora-discovery',
      context: client('aurora'),
      userMessage: 'Before we brief the new copywriter \u2014 remind me everything we know about our positioning so far.',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: { category: 'positioning' } },
        { type: 'respond', text: 'Summarizing what we have on file for Aurora.' },
      ],
    },
  ],
};

/**
 * Golden path 2: a personal health disclosure made in a private (personal)
 * conversation must never surface in ANY client's brain \u2014 contrasted with a
 * genuinely shared, agency-wide (world-scope) fact, which SHOULD appear
 * everywhere. Tests that isolation isn't accidentally "everything is
 * private" (which would be safe but wrong) \u2014 the world fact must still
 * reach both clients while the personal one reaches neither.
 */
export const PERSONAL_HEALTH_VS_SHARED_FACT_FIXTURE: Fixture = {
  name: 'personal-health-disclosure-vs-shared-agency-fact',
  description:
    "A user discloses a personal health matter in a private chat, and separately sets a genuinely agency-wide fact (a shared style guide rule) while in World context. The health disclosure must never reach any client; the agency-wide rule must reach every client.",
  turns: [
    {
      label: 'Personal: health disclosure',
      sessionName: 'personal-health-chat',
      context: personal,
      userMessage: "Just between us \u2014 I've been dealing with a lot of anxiety this month, it's been rough.",
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'health', subject: 'mental_health_note', content: 'Dealing with anxiety this month', sensitive: true },
        },
        { type: 'respond', text: "I'm sorry to hear that \u2014 I've made a private note, only visible to you personally." },
      ],
    },
    {
      label: 'World: a genuinely agency-wide style rule',
      sessionName: 'world-style-guide',
      context: world,
      userMessage: 'New agency-wide rule: never use the word "utilize" in any client copy, ever.',
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'style_rules', subject: 'banned_utilize', content: 'Never use "utilize" in any client copy' },
        },
        { type: 'respond', text: 'Added as an agency-wide style rule.' },
      ],
    },
    {
      label: "Client Aurora: checks what it can see",
      sessionName: 'aurora-checks-everything',
      context: client('aurora'),
      userMessage: 'What do you know about me and about our style rules?',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: {} },
        { type: 'respond', text: "Here's what's on file for Aurora." },
      ],
    },
    {
      label: "Client Lumen: checks what it can see",
      sessionName: 'lumen-checks-everything',
      context: client('lumen'),
      userMessage: 'What do you know about me and about our style rules?',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: {} },
        { type: 'respond', text: "Here's what's on file for Lumen." },
      ],
    },
  ],
};

/**
 * Golden path 3: an operator hops between three different contexts
 * back-to-back in one sitting (the realistic day-to-day agency workflow the
 * architecture audit flagged as the actual risk shape \u2014 not a single
 * isolated write, but rapid context-switching where a stale "current scope"
 * assumption would be the likely bug). Confirms isolation holds at every hop.
 */
export const RAPID_CONTEXT_SWITCHING_FIXTURE: Fixture = {
  name: 'rapid-context-switching-single-sitting',
  description:
    'An operator switches Client A -> Client B -> World -> Client A again within one sitting, writing and reading facts at each hop, confirming no cross-contamination from stale scope state.',
  turns: [
    {
      label: 'Client A: first hop, writes a fact',
      sessionName: 'switch-1-client-a',
      context: client('northwind'),
      userMessage: 'Our Q3 campaign theme is "Built for Winter".',
      steps: [
        {
          type: 'tool_call',
          name: 'remember',
          input: { category: 'campaigns', subject: 'q3_theme', content: 'Built for Winter' },
        },
        { type: 'respond', text: 'Noted the Q3 theme for Northwind.' },
      ],
    },
    {
      label: 'Client B: second hop, immediately after A \u2014 must see nothing of A',
      sessionName: 'switch-2-client-b',
      context: client('solstice'),
      userMessage: "What's our Q3 campaign theme?",
      steps: [
        { type: 'tool_call', name: 'list_facts', input: { category: 'campaigns' } },
        { type: 'respond', text: "We haven't set one yet for Solstice." },
      ],
    },
    {
      label: 'World: third hop \u2014 must see neither client\u2019s campaign fact',
      sessionName: 'switch-3-world',
      context: world,
      userMessage: 'Do any of our clients have a Q3 theme set yet?',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: { category: 'campaigns' } },
        { type: 'respond', text: 'Nothing agency-wide on that yet.' },
      ],
    },
    {
      label: 'Client A: fourth hop, back to A \u2014 must still see its OWN fact from the first hop',
      sessionName: 'switch-4-client-a-again',
      context: client('northwind'),
      userMessage: 'Remind me of our Q3 theme.',
      steps: [
        { type: 'tool_call', name: 'list_facts', input: { category: 'campaigns' } },
        { type: 'respond', text: 'Built for Winter.' },
      ],
    },
  ],
};

export const ALL_GOLDEN_PATH_FIXTURES: Fixture[] = [
  TWO_COMPETING_BRANDS_FIXTURE,
  PERSONAL_HEALTH_VS_SHARED_FACT_FIXTURE,
  RAPID_CONTEXT_SWITCHING_FIXTURE,
];
