/**
 * Chat mode tool adapter
 *
 * Converts existing tool definitions to @kenkaiiii/gg-agent AgentTool format
 * and adds web_fetch / shell_command / subagent capabilities.
 * Web search is enabled via webSearch flag on AgentOptions (not a tool).
 */

import { z } from 'zod';
import type { AgentTool, ToolContext } from '@kenkaiiii/gg-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createTools as createCoderTools } from '@kenkaiiii/ggcoder';
import { getCustomTools, ToolsConfig } from '../tools';
import { wrapToolHandler } from '../tools/diagnostics';
import { createSubAgentTool } from '../tools/subagent';
import { getMemoryManager } from '../tools/memory-tools';
import { getCurrentSessionId } from '../tools/session-context';
import { AtelierMemoryBridge } from '../memory/atelier-bridge';
import { skillsForLane } from '../marketplace/registry';
import type { LaneId } from '../marketplace/types';
import { resolveNearestScope } from '../memory/scope';
import type { SessionContext } from '../memory/sessions';
import { getStreamConfig } from './chat-providers';
import { validateBashCommand, validateWritePath } from './safety';
import { scanForBannedTone } from './write-guards';
import { SettingsManager } from '../settings';
import { appendAuditLog, digestContent } from '../utils/audit-log';
import { jsonSchemaToZod } from './schema-utils';
import { getMcpBridgedTools } from './mcp-bridge';

const execAsync = promisify(exec);
const IS_WINDOWS = process.platform === 'win32';
const HOME_DIR = process.env.HOME || process.env.USERPROFILE || '';

/**
 * Decide whether a tone-guard hit should block the write, given the current
 * `features.toneHardBlock` setting and whether a marketplace lane is active.
 *
 * Tri-state setting (roadmap item 7):
 *   - 'false' — never block (global opt-out), any mode.
 *   - 'true'  — always block (global opt-in), any mode.
 *   - unset   — mode-dependent default: lane modes (design/product/brand/
 *               social) block by default; other prose modes (general/writer/
 *               researcher/therapist) stay warn-only, matching prior behavior.
 * This makes the existing flag able to opt OUT of blocking in lanes (instead
 * of the old opt-IN-only semantics) while keeping non-lane modes unchanged
 * unless the operator explicitly opts in globally.
 */
function shouldHardBlockTone(lane: LaneId | undefined): boolean {
  const setting = SettingsManager.get('features.toneHardBlock');
  if (setting === 'false') return false;
  if (setting === 'true') return true;
  return Boolean(lane);
}

/**
 * Best-effort content digest for an audit-log entry: the `content` field when
 * the tool's input carries one (write), else the whole args payload (edit,
 * whose input is a list of old_text/new_text pairs, not one `content`
 * string). Either way this only ever produces a short hash — see
 * digestContent() in utils/audit-log.ts.
 */
function auditDigestForArgs(args: unknown): string {
  const content = (args as { content?: unknown })?.content;
  if (typeof content === 'string') return digestContent(content);
  try {
    return digestContent(JSON.stringify(args));
  } catch {
    return digestContent('');
  }
}

/**
 * Record one write-audit-log entry (roadmap item 8) for a successful write.
 * Resolves the active session's scope via the same memory-manager lookup the
 * tone guard uses. Runs for every write/edit tool, lane or not, coder or not
 * — the audit log is unconditional (unlike the tone guard, which coder mode
 * is exempt from). appendAuditLog() never throws, so this can't break a write.
 */
function logAuditWrite(toolName: string, filePath: unknown, args: unknown): void {
  if (typeof filePath !== 'string' || filePath.length === 0) return;
  const memory = getMemoryManager();
  const context = memory ? memory.getSessionContext(getCurrentSessionId()) : undefined;
  appendAuditLog({
    sessionId: getCurrentSessionId(),
    scope: context ? resolveNearestScope(context) : null,
    tool: toolName.toLowerCase() === 'edit' ? 'edit' : 'write',
    target: filePath,
    digest: auditDigestForArgs(args),
  });
}

/**
 * Wrap a write/edit AgentTool so its execute() runs validateWritePath before
 * delegating to the underlying tool. Blocks writes to dangerous paths (e.g.
 * /etc, ~/.ssh, /System) and returns a string explaining the block.
 *
 * When `scanTone` is true (every mode reachable via getChatAgentTools — i.e.
 * every prose-producing mode: general/design/product/brand/social/researcher/
 * writer/therapist), it also runs the packs' anti-AI-tone / banned-words guard
 * (ported from Atelier/Salon, see write-guards.ts) against the content being
 * written. Coder mode is exempt (never passes `scanTone`) since scanning code
 * for prose-tone patterns would false-positive. Blocking policy is decided by
 * `shouldHardBlockTone` above; disable scanning entirely with
 * `features.operatorPacks='false'`.
 *
 * Every successful write (any mode) also gets a write-audit-log entry via
 * logAuditWrite() — this is the single centralized choke point every
 * write/edit AgentTool passes through, so no tool can bypass the audit log.
 */
function wrapWithWritePathSafety(
  tool: AgentTool,
  lane?: LaneId,
  scanTone: boolean = false
): AgentTool {
  const originalExecute = tool.execute.bind(tool);
  return {
    ...tool,
    execute: async (args: unknown, context: ToolContext) => {
      const filePath = (args as { file_path?: unknown })?.file_path;
      if (typeof filePath === 'string' && filePath.length > 0) {
        const safety = validateWritePath(filePath);
        if (!safety.allowed) {
          return `Write blocked by safety filter: ${safety.reason}`;
        }
      }

      const content = (args as { content?: unknown })?.content;
      let toneWarning: string | null = null;
      if (
        scanTone &&
        typeof content === 'string' &&
        SettingsManager.get('features.operatorPacks') !== 'false'
      ) {
        // Merge the active brand's guardrails (world + client) into the tone scan.
        const memory = getMemoryManager();
        const scanContext = memory ? memory.getSessionContext(getCurrentSessionId()) : undefined;
        const { warning } = scanForBannedTone(content, scanContext);
        if (warning) {
          if (shouldHardBlockTone(lane)) {
            return `Write blocked by tone guard: ${warning}`;
          }
          toneWarning = warning; // non-blocking: warn + still write
        }
      }

      const result = await originalExecute(args as never, context);
      notifyAtelierMemoryWrite(filePath);
      logAuditWrite(tool.name, filePath, args);
      return toneWarning ? `${toneWarning}\n\n${result}` : result;
    },
  } as AgentTool;
}

/**
 * Hook 3: post-write mirror sync.
 * Fire-and-forget re-sync of the .atelier/memory tree into SQLite
 * whenever a write/edit lands inside it (memory_init also does this,
 * but this keeps the mirror fresh for edits made outside memory_init).
 */
function notifyAtelierMemoryWrite(filePath: unknown): void {
  if (typeof filePath !== 'string' || !filePath.includes('.atelier/memory')) return;
  const memory = getMemoryManager();
  if (!memory) return;
  const projectDir = filePath.split('.atelier')[0];
  // Fire-and-forget: a mirror-sync failure must never surface as an unhandled
  // rejection (this runs 24/7). Swallow-and-log; the canonical file tree is unaffected.
  void new AtelierMemoryBridge(memory)
    .onMemoryFileWritten(filePath, projectDir)
    .catch((e) => console.error('[atelier-memory] mirror sync failed', e));
}

const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'Write', 'Edit']);

/**
 * Build a self-contained `skill` tool for the given lane. ggcoder's
 * createSkillTool/formatSkillsForPrompt aren't exported from
 * '@kenkaiiii/ggcoder' (blocked by the package's `exports` field), so we
 * build our own on-demand skill loader from the marketplace registry, which
 * already holds each skill's full content.
 */
function buildLaneSkillTool(lane: LaneId): AgentTool {
  const skills = skillsForLane(lane);
  const names = skills.map((s) => s.name);
  const parameters = z.object({
    skill: z.string().describe(`Skill name to load. One of: ${names.join(', ')}`),
  });
  return {
    name: 'skill',
    description: `Load a lane skill's full workflow by name when a request matches it. Available: ${names.join(', ')}.`,
    parameters,
    execute: async (input: unknown, _context: ToolContext) => {
      const { skill } = input as z.infer<typeof parameters>;
      const found = skills.find((s) => s.name === skill);
      return found ? found.content : `Unknown skill "${skill}". Available: ${names.join(', ')}`;
    },
  };
}

/**
 * Build the AgentTool array for Chat mode.
 * Wraps each handler with diagnostics and returns AgentTool[] compatible with @kenkaiiii/gg-agent.
 *
 * `sessionContext` (the session's selected memory scope) gates which
 * marketplace MCP servers get bridged in (roadmap item 5): omitted, no MCP
 * tools are added — see mcp-bridge.ts's resolveSessionMcpServers doc for why
 * that's the conservative default. `sessionId` is required whenever a
 * context is supplied (scope enablement resolution needs it for the
 * chat-scope link); defaults to the async-local current session id.
 */
export async function getChatAgentTools(
  config: ToolsConfig,
  cwd: string,
  lane?: LaneId,
  sessionContext?: SessionContext,
  sessionId: string = getCurrentSessionId()
): Promise<AgentTool[]> {
  const customTools = getCustomTools(config);
  const tools: AgentTool[] = [];

  for (const tool of customTools) {
    const wrapped = wrapToolHandler(tool.name, tool.handler);
    const inputSchema = tool.input_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    const parameters = jsonSchemaToZod(inputSchema.properties || {}, inputSchema.required || []);

    tools.push({
      name: tool.name,
      description: tool.description,
      parameters,
      execute: async (args: unknown, _context: ToolContext) => {
        return await wrapped(args as Record<string, unknown>);
      },
    });
  }

  // Add file tools (read, write, edit) from gg-coder. getChatAgentTools is
  // never called for coder mode (see chat-engine.ts) — every mode reachable
  // here produces prose, so the tone guard is always on (scanTone: true).
  const { tools: coderNativeTools } = createCoderTools(cwd);
  const fileToolNames = new Set(['read', 'write', 'edit']);
  for (const t of coderNativeTools) {
    if (fileToolNames.has(t.name)) {
      tools.push(WRITE_TOOL_NAMES.has(t.name) ? wrapWithWritePathSafety(t, lane, true) : t);
    }
  }

  // Add web_fetch tool
  tools.push(buildWebFetchTool());

  // Add shell_command tool
  tools.push(buildShellCommandTool());

  // Add per-lane skill tool (loads full skill content on demand)
  if (lane && skillsForLane(lane).length) {
    tools.push(buildLaneSkillTool(lane));
  }

  // Bridge in marketplace MCP servers gated for this session's context (roadmap
  // item 5). Lazily spawns/connects each allowed server; a server that fails
  // to connect just contributes no tools (crash isolation lives in
  // src/mcp/manager.ts) rather than failing this whole build.
  const mcpTools = await getMcpBridgedTools(sessionContext, sessionId);
  tools.push(...mcpTools);

  // Add sub-agent tool (receives parent tools so it can select a subset)
  tools.push(createSubAgentTool(tools, getStreamConfig, lane));

  return tools;
}

/**
 * Build the AgentTool array for Coder mode.
 * Uses gg-coder native tools (read, write, edit, bash, etc.) merged with MCP tools.
 *
 * Same MCP-bridging contract as getChatAgentTools — see that doc. Coder mode
 * is exempt from the anti-AI-tone guard but NOT from the MCP bridge: a
 * scheduling/CMS MCP server is just as useful to call from coder mode.
 */
export async function getCoderAgentTools(
  config: ToolsConfig,
  cwd: string,
  sessionContext?: SessionContext,
  sessionId: string = getCurrentSessionId()
): Promise<AgentTool[]> {
  // Create gg-coder native tools
  const { tools: coderNativeTools } = createCoderTools(cwd);

  // Get MCP-wrapped tools (browser, notify, project, grep-github, switch_agent)
  const customTools = getCustomTools(config);
  const mcpTools: AgentTool[] = [];

  for (const tool of customTools) {
    const wrapped = wrapToolHandler(tool.name, tool.handler);
    const inputSchema = tool.input_schema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    const parameters = jsonSchemaToZod(inputSchema.properties || {}, inputSchema.required || []);

    mcpTools.push({
      name: tool.name,
      description: tool.description,
      parameters,
      execute: async (args: unknown, _context: ToolContext) => {
        return await wrapped(args as Record<string, unknown>);
      },
    });
  }

  // Merge: coder native tools (with write-path safety) + MCP tools. No lane,
  // scanTone left at its default (false) — coder mode is exempt from the tone
  // guard since scanning code for prose-tone patterns would false-positive.
  const safeCoderTools = coderNativeTools.map((t) =>
    WRITE_TOOL_NAMES.has(t.name) ? wrapWithWritePathSafety(t) : t
  );

  // Bridge in marketplace MCP servers gated for this session's context
  // (roadmap item 5) — same contract as getChatAgentTools.
  const bridgedMcpTools = await getMcpBridgedTools(sessionContext, sessionId);

  return [...safeCoderTools, ...mcpTools, ...bridgedMcpTools];
}

/**
 * Custom web_fetch AgentTool — fetches a URL and returns its text content.
 */
function buildWebFetchTool(): AgentTool {
  const parameters = z.object({
    url: z.string().describe('The URL to fetch'),
    max_length: z.number().describe('Maximum characters to return (default: 10000)').optional(),
  });

  return {
    name: 'web_fetch',
    description:
      'Fetch and read content from a URL. Returns the text content of the page with HTML tags stripped. Useful for reading articles, documentation, or any web page.',
    parameters,
    execute: async (input: unknown, _context: ToolContext) => {
      const { url, max_length } = input as z.infer<typeof parameters>;
      const maxLength = max_length || 10000;

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PocketAgent/1.0)',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }

        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();

        // If it's HTML, strip tags
        let content: string;
        if (contentType.includes('html')) {
          content = text
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        } else {
          content = text;
        }

        if (content.length > maxLength) {
          content = content.slice(0, maxLength) + '\n\n[Content truncated]';
        }

        return content;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return `Error fetching ${url}: ${msg}`;
      }
    },
  };
}

/**
 * Shell command AgentTool — runs a command in the system shell and returns output.
 */
function buildShellCommandTool(): AgentTool {
  const parameters = z.object({
    command: z.string().describe('The shell command to execute'),
    timeout_ms: z
      .number()
      .describe('Timeout in milliseconds (default: 30000, max: 120000)')
      .optional(),
  });

  return {
    name: 'shell_command',
    description:
      'Execute a shell command and return its output. Use this for file operations, git commands, running scripts, system tasks, and any CLI operations. Commands run in bash (macOS/Linux) or PowerShell (Windows).',
    parameters,
    execute: async (input: unknown, _context: ToolContext) => {
      const { command, timeout_ms } = input as z.infer<typeof parameters>;
      const timeoutMs = Math.min(timeout_ms || 30000, 120000);

      const shellOpts = IS_WINDOWS
        ? { shell: 'powershell.exe' as string, env: process.env, timeout: timeoutMs }
        : {
            shell: '/bin/bash' as string,
            env: {
              ...process.env,
              PATH: `${process.env.PATH}:/usr/local/bin:/opt/homebrew/bin:${HOME_DIR}/.local/bin`,
            },
            timeout: timeoutMs,
          };

      const safety = validateBashCommand(command);
      if (!safety.allowed) {
        return `Command blocked by safety filter: ${safety.reason}`;
      }

      try {
        const { stdout, stderr } = await execAsync(command, shellOpts);
        let result = stdout || '';
        if (stderr) {
          result += (result ? '\n' : '') + `[stderr]: ${stderr}`;
        }
        // Truncate very long output
        if (result.length > 50000) {
          result = result.slice(0, 50000) + '\n\n[Output truncated at 50000 chars]';
        }
        return result || '(no output)';
      } catch (error) {
        const err = error as Error & { stdout?: string; stderr?: string; code?: number };
        let msg = `Command failed (exit code ${err.code || 'unknown'})`;
        if (err.stderr) msg += `\n[stderr]: ${err.stderr}`;
        if (err.stdout) msg += `\n[stdout]: ${err.stdout}`;
        return msg;
      }
    },
  };
}
