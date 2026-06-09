/**
 * Agent mode registry — defines all available agent personas.
 *
 * Each mode specifies its engine, system prompt, tool access, and UI metadata.
 * The `switch_agent` tool and options builder both reference this registry.
 */

// ── Types ──

export type AgentModeId = 'general' | 'coder' | 'researcher' | 'writer' | 'therapist';

export interface AgentMode {
  id: AgentModeId;
  name: string;
  icon: string;
  engine: 'chat';
  systemPrompt: string;
  /**
   * Intended tool surface for this mode. NOTE: not currently enforced — actual
   * tools come from getChatAgentTools()/getCoderAgentTools() in chat-engine.ts.
   * Keep names in sync with src/tools/ definitions before wiring this up.
   */
  allowedTools: string[];
  mcpServers?: string[];
  description: string;
  /** LLM-facing description of when to hand off to this mode */
  handoffDescription: string;
  /** Which modes this agent can hand off to */
  canHandoffTo: AgentModeId[];
  /** Whether this mode produces technical artifacts (tool calls, file contents, etc.) */
  technicalMode: boolean;
}

/** Context passed to on_handoff callbacks */
export interface HandoffContext {
  sessionId: string;
  fromMode: AgentModeId;
  toMode: AgentModeId;
  reason: string;
  timestamp: Date;
}

export type OnHandoffCallback = (context: HandoffContext) => void | Promise<void>;

// ── Shared tool lists ──

/** Tools available in chat-engine modes (general, researcher, etc.) */
const CHAT_CORE_TOOLS = ['web_fetch', 'shell_command', 'subagent', 'read', 'write', 'edit'];

/** gg-coder native tools (read, write, edit, bash, etc.) */
const CODER_NATIVE_TOOLS = [
  'read',
  'write',
  'edit',
  'bash',
  'find',
  'grep',
  'ls',
  'web_fetch',
  'subagent',
  'tasks',
  'task_output',
  'task_stop',
  'skill',
  'enter_plan',
  'exit_plan',
];

const BROWSER_TOOLS = ['mcp__pocket-agent__browser'];
const NOTIFY_TOOLS = ['mcp__pocket-agent__notify'];
const PROJECT_TOOLS = [
  'mcp__pocket-agent__set_project',
  'mcp__pocket-agent__get_project',
  'mcp__pocket-agent__clear_project',
];
const MEMORY_TOOLS = [
  'mcp__pocket-agent__remember',
  'mcp__pocket-agent__forget',
  'mcp__pocket-agent__list_facts',
  'mcp__pocket-agent__update_fact',
  'mcp__pocket-agent__recall_memory',
  'mcp__pocket-agent__daily_log',
];
const SOUL_TOOLS = [
  'mcp__pocket-agent__soul_set',
  'mcp__pocket-agent__soul_get',
  'mcp__pocket-agent__soul_list',
  'mcp__pocket-agent__soul_delete',
];
const SCHEDULER_TOOLS = [
  'mcp__pocket-agent__create_routine',
  'mcp__pocket-agent__create_reminder',
  'mcp__pocket-agent__list_routines',
  'mcp__pocket-agent__delete_routine',
];
const GREP_TOOLS = ['mcp__grep__searchGitHub'];
const SWITCH_TOOL = ['mcp__pocket-agent__switch_agent'];

// ── System prompts ──

const GENERAL_PROMPT = `## General Mode

You are the user's personal assistant — their day-to-day companion for scheduling, reminders, quick lookups, task management, and conversation. You have shell access, browser, web search, and all external services.

**How you operate:**
- Companion, not search engine — conversational, references past conversations, picks up threads ("how did the demo go?")
- Do it, don't describe it — handle requests end-to-end. "Book it", not "here's how to book it"
- One answer, not three options — when asked for a recommendation, commit. Offer alternatives only when the choice genuinely depends on something you don't know
- Match the moment — quick question gets a quick answer; don't pad short replies into paragraphs
- Proactive, not pushy — suggest a reminder when they mention a commitment; don't manufacture busywork
- Deep coding, research, drafting, or emotional support → switch to the appropriate agent`;

const CODER_PROMPT = ''; // Coder uses gg-coder's buildSystemPrompt() — see chat-engine.ts

const RESEARCHER_PROMPT = `## Researcher Mode

You are in deep research mode. Unlike quick lookups, your job is thorough investigation: multiple independent sources, cross-verification, and structured findings.

**How you operate:**
- Verify before presenting — a claim from one source is a lead, not a finding. Cross-reference before stating it as fact
- Use every tool aggressively: web search for discovery, browser for deep reading of primary sources, shell and Pocket CLI for data extraction
- Structure output: lead with the answer → evidence with sources → what you couldn't verify. Never bury the conclusion
- Label confidence explicitly: established fact / expert consensus / single source / speculation
- When sources conflict, present both sides with their provenance — never silently pick one
- Note publication dates — a 2023 claim about a fast-moving topic may already be stale
- If the request falls outside research, switch back to the appropriate agent`;

const WRITER_PROMPT = `## Writer Mode

You are in focused writing mode. You draft, edit, and refine content in the user's voice. You deliberately have no web search or browser — you write from what you know, using memory and soul context for the user's style and preferences.

**How you operate:**
- Clarify audience, tone, and purpose before drafting — one question if it changes the draft, otherwise just write
- Write in THEIR voice, not yours — check soul memory for how they communicate. No generic AI cadence, no "delve", no "furthermore", no bullet-pointed essays
- Produce complete drafts, not outlines (unless asked). A half-finished draft they can react to beats a perfect plan
- Every sentence earns its place — cut filler, prefer concrete over abstract, strong verbs over adverbs
- When editing existing text, preserve the author's voice; change the minimum needed and say what you changed and why
- If the request falls outside writing, switch back to the appropriate agent`;

const THERAPIST_PROMPT = `## Therapist Mode

You are in supportive listening mode. The user wants to talk through something — stress, decisions, feelings, relationships, life direction. You have their memory and soul context: you know their life, goals, struggles, and history. Use it — continuity is what makes you different from a stranger.

**How you operate:**
- Listen first. Reflect back what you hear before offering perspective
- Ask one thoughtful question at a time — help them think, don't interrogate or think for them
- Don't jump to solutions unless they explicitly ask for advice. Sitting with something IS the work
- Reference their life and past conversations when relevant — "this sounds like what you said about X last month" lands harder than generic insight
- Validate without formula — vary your language; no "that must be really hard" on repeat
- Be honest, not just agreeable. If they're avoiding something obvious, gently name it
- Save heavy disclosures (health, relationships, grief) as sensitive facts — remember them, never raise them unprompted
- You are not a clinician: never diagnose. If they mention self-harm or crisis, respond with care and gently point them to professional/crisis support
- If the conversation shifts to tasks, coding, or research, switch back to the appropriate agent`;

// ── Mode registry ──

export const AGENT_MODES: Record<AgentModeId, AgentMode> = {
  general: {
    id: 'general',
    name: 'General',
    icon: '🐾',
    engine: 'chat',
    systemPrompt: GENERAL_PROMPT,
    allowedTools: [
      ...CHAT_CORE_TOOLS,
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SOUL_TOOLS,
      ...SCHEDULER_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Personal assistant — remembers, schedules, browses, manages life',
    handoffDescription: 'General conversation, scheduling, reminders, task management',
    canHandoffTo: ['coder', 'researcher', 'writer', 'therapist'],
    technicalMode: false,
  },
  coder: {
    id: 'coder',
    name: 'Coder',
    icon: '🔧',
    engine: 'chat',
    systemPrompt: CODER_PROMPT,
    allowedTools: [...CODER_NATIVE_TOOLS, ...PROJECT_TOOLS, ...GREP_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent', 'grep'],
    description: 'Full coding agent with file access and GitHub search',
    handoffDescription: 'Code, file edits, debugging, programming tasks',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: true,
  },
  researcher: {
    id: 'researcher',
    name: 'Researcher',
    icon: '🔍',
    engine: 'chat',
    systemPrompt: RESEARCHER_PROMPT,
    allowedTools: [
      ...BROWSER_TOOLS,
      ...NOTIFY_TOOLS,
      ...PROJECT_TOOLS,
      ...MEMORY_TOOLS,
      ...SWITCH_TOOL,
    ],
    mcpServers: ['pocket-agent'],
    description: 'Deep research — web search, browsing, note-taking',
    handoffDescription: 'Deep multi-source research, fact-checking, investigation',
    canHandoffTo: ['general', 'coder', 'writer'],
    technicalMode: false,
  },
  writer: {
    id: 'writer',
    name: 'Writer',
    icon: '✍️',
    engine: 'chat',
    systemPrompt: WRITER_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Focused writing — no web search, no browser distractions',
    handoffDescription: 'Drafting, editing, content creation — no web distractions',
    canHandoffTo: ['general', 'researcher'],
    technicalMode: false,
  },
  therapist: {
    id: 'therapist',
    name: 'Therapist',
    icon: '💬',
    engine: 'chat',
    systemPrompt: THERAPIST_PROMPT,
    allowedTools: [...MEMORY_TOOLS, ...SOUL_TOOLS, ...NOTIFY_TOOLS, ...SWITCH_TOOL],
    mcpServers: ['pocket-agent'],
    description: 'Supportive listening — talk through stress, decisions, feelings',
    handoffDescription: 'Talk through feelings, stress, decisions, personal matters',
    canHandoffTo: ['general'],
    technicalMode: false,
  },
};

/** All valid mode IDs */
export const ALL_MODE_IDS: AgentModeId[] = Object.keys(AGENT_MODES) as AgentModeId[];

/** Check if a string is a valid mode ID */
export function isValidModeId(mode: string): mode is AgentModeId {
  return mode in AGENT_MODES;
}

/** Get the mode config, falling back to 'coder' for invalid IDs */
export function getModeConfig(mode: string): AgentMode {
  return AGENT_MODES[mode as AgentModeId] || AGENT_MODES.coder;
}

/** Get all modes as an array (for UI rendering) */
export function getAllModes(): AgentMode[] {
  return ALL_MODE_IDS.map((id) => AGENT_MODES[id]);
}

/** Build dynamic routing instructions for injection into system prompt */
export function buildRoutingInstructions(currentMode: AgentModeId): string {
  const config = AGENT_MODES[currentMode];
  const targets = config.canHandoffTo;

  if (targets.length === 0) return '';

  const targetList = targets
    .map((id) => `\`${id}\` — ${AGENT_MODES[id].handoffDescription}`)
    .join('; ');

  return `You can use \`switch_agent\` to hand off when the conversation shifts: ${targetList}. Transfers are seamless — do not announce or draw attention to them.`;
}
