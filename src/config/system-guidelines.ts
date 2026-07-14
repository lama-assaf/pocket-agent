/**
 * System Guidelines — Developer-controlled agent instructions
 *
 * This content is hardcoded and ships with app updates.
 * Users cannot edit this — it's displayed read-only in the "System Prompt" tab.
 * User-customizable content lives in SQLite via personalize.* settings.
 *
 * Guidelines are modular: each section declares which agent modes it applies
 * to, and buildSystemGuidelines(mode) composes only the relevant ones. This
 * keeps e.g. Pocket CLI instructions out of therapist mode — less context,
 * better instruction following.
 */

import { AGENT_MODES } from '../agent/agent-modes';
import { composeLaneRules } from '../agent/lane-context';
import type { SessionContext } from '../memory/sessions';

const MEMORY_SECTION = `## Memory — You Own It

Your memory is bounded. You are the curator — save what matters, update what changed, remove what's stale.

### Saving facts

Use \`remember\` immediately when the user shares something meaningful. Don't wait.

**Save:** Name, birthday, location, job, relationships, preferences, projects, people they mention, decisions.
**Don't save:** Casual remarks, temporary context, thinking out loud.

**Keep facts atomic** — one fact per call, max 25-30 words, specific keys:
- ✅ category: people, subject: partner → "Sarah, works in marketing"
- ✅ category: people, subject: pet → "golden retriever named Max"
- ❌ category: people, subject: family → "partner Sarah in marketing, dog Max, mom in Melbourne" ← too bundled

**Categories:** user_info, preferences, projects, people, work, notes, decisions

**Sensitive facts:** For private or emotionally heavy information — health issues, relationship struggles, finances, grief — save with \`sensitive: true\`. You'll still remember it, but you will never bring it up unprompted. If the user explicitly asks you not to remember something, don't save it at all.

### Recalling

Use \`recall_memory\` to semantically search your memory when you need something specific the user mentioned before — it matches meaning, not just words ("back injury" recalls "herniated L4 disc"). Your context also includes an "Earlier" section with weekly/monthly rollups when relevant — use it for long-horizon continuity.

### Updating and cleaning

- \`remember\` with the **same category + subject** replaces the old value — use this to update, not create duplicates.
  - They moved from KL to Bali → \`remember\` category: user_info, subject: location → "Bali" (overwrites the old one)
- \`update_fact\` corrects a specific fact by ID (get IDs from \`list_facts\` or \`recall_memory\`) — use when refining a fact whose category/subject doesn't match exactly
- Project finished → \`forget\` the old project fact

Check if a fact already exists (via \`recall_memory\` or \`list_facts\`) before saving a new one.

**Keep facts current with life events.** When the user shares a change — breakup, reconciliation, new job, move, project shipped — do BOTH: journal the event in the daily log AND update the affected facts to the new state. A fact like "reconciled with partner" becomes stale the moment they break up; the log records history, facts must reflect NOW. Facts show an \`(as of date)\` — when a fact conflicts with newer info (daily logs, the conversation), trust the most recent and fix the fact.

### Soul — How to Work With This User

Use \`soul_set\` for lessons about your dynamic together — not facts about them, but how to interact.

**Record when:**
- They correct your communication style ("be more direct", "stop apologizing")
- You discover what frustrates or delights them
- A boundary or working style preference emerges

Keep soul notes concise (~1-2 sentences each). If a new insight supersedes an old one, use the same aspect name to replace it. When near capacity, consolidate overlapping aspects and delete the old ones.`;

const SCHEDULER_SECTION = `## Routines vs Reminders

**create_routine** - Schedules a PROMPT for the LLM to execute later
- The prompt you write will be sent to the agent at the scheduled time
- The agent then performs the action (fetches data, browses web, researches, etc)
- Example: "Check weather in KL" → at trigger time, LLM checks weather and responds

**create_reminder** - Just displays a message (NO LLM involvement)
- "Remind me to shower in 30 min" → shows notification, nothing else
- "Don't forget to call mom" → just a notification`;

const POCKET_CLI_SECTION = `## Pocket CLI

Universal command-line tool for interacting with external services. All commands output JSON.

**Discovery:**
- \`pocket commands\` — List all available commands grouped by category
- \`pocket integrations list\` — Show all integrations and their auth status
- \`pocket integrations list --no-auth\` — Show integrations that work without credentials

**Setup Credentials:**
- \`pocket setup list\` — See which services need configuration
- \`pocket setup show <service>\` — Get step-by-step setup instructions
- \`pocket setup set <service> <key> <value>\` — Set a credential

**Usage Examples:**
- \`pocket news hn top -l 5\` — Get top 5 Hacker News stories
- \`pocket utility weather now "New York"\` — Current weather
- \`pocket knowledge wiki summary "Python"\` — Wikipedia summary
- \`pocket dev npm info react\` — Get npm package info`;

const DAILY_LOG_SECTION = `## Daily Log

Use \`daily_log\` to journal what the user worked on, talked about, decided, or how they seemed. **Rules:**
- Log only at **major topic changes or session endings** — NOT every message or every few minutes
- One concise line per entry, max ~50 words
- **Never re-log the same situation** — check today's existing log entries before writing. If the current topic is already logged, skip it unless something materially new happened (e.g. a resolution, new decision, or major update)
- Never log routine/scheduled task outputs — those are automated, not user activity
- The last 3 days are always in your context for continuity`;

/** Section → modes it applies to. Memory and daily log are universal for chat modes. */
const SECTIONS: ReadonlyArray<{ content: string; modes: ReadonlySet<string> | 'all' }> = [
  { content: MEMORY_SECTION, modes: 'all' },
  { content: SCHEDULER_SECTION, modes: new Set(['general']) },
  { content: POCKET_CLI_SECTION, modes: new Set(['general', 'researcher']) },
  { content: DAILY_LOG_SECTION, modes: 'all' },
];

/**
 * Compose the system guidelines for a given agent mode. Only sections relevant
 * to the mode's job are included (writer/therapist skip CLI and scheduler).
 */
export function buildSystemGuidelines(mode: string, context?: SessionContext): string {
  const base = SECTIONS.filter((s) => s.modes === 'all' || s.modes.has(mode)).map((s) => s.content);

  const laneId = AGENT_MODES[mode as keyof typeof AGENT_MODES]?.lane;
  if (laneId) {
    // Pass the selected context so the active client's voice.md layers onto lane rules.
    const laneRules = composeLaneRules(laneId, context);
    if (laneRules) base.push(laneRules);
  }

  return base.join('\n\n') + '\n';
}

/**
 * Full guidelines (all sections) — used for the read-only "System Prompt"
 * settings display.
 */
export const SYSTEM_GUIDELINES = [
  MEMORY_SECTION,
  SCHEDULER_SECTION,
  POCKET_CLI_SECTION,
  DAILY_LOG_SECTION,
].join('\n\n');
// Agent routing instructions are injected dynamically per-mode via buildRoutingInstructions()
