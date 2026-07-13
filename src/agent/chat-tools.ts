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
import { AtelierMemoryBridge } from '../memory/atelier-bridge';
import { skillsForLane } from '../marketplace/registry';
import type { LaneId } from '../marketplace/types';
import { resolveNearestScope } from '../memory/scope';
import { getStreamConfig } from './chat-providers';
import { validateBashCommand, validateWritePath } from './safety';
import { scanForBannedTone } from './write-guards';
import { SettingsManager } from '../settings';

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
