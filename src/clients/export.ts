// src/clients/export.ts
// Publish loop: write a scope's editable `facts` back out to its on-disk brain
// (`.atelier/memory/*.md` + `guardrails/`) so an in-app edit can be committed and
// pushed via git. Facts are the live source of truth (see agent/how-to-act.ts);
// this exporter materializes them into the file layout the rest of the system —
// and other operators pulling the repo — already understand.
//
// Round-trip: pull mirrors files → facts (atelier-bridge, category
// 'atelier-memory'); this exports the in-app fact categories (how_to_act, lesson,
// knowledge, enabled-agents, enabled-mcp) → files. The mirror category is
// skipped so a pulled brain isn't re-exported into a second copy.

import fs from 'fs';
import path from 'path';
import { getWorldRoot, clientPaths } from './paths';

/** Minimal fact shape the exporter needs (decoupled from the full Fact row). */
export interface ExportableFact {
  category: string;
  subject: string;
  content: string;
  scope: string;
}

/** The mirror category written by atelier-bridge on pull — never re-exported. */
const MIRROR_CATEGORY = 'atelier-memory';

const VOICE_HEADER = '# Brand voice\n\n_Managed in-app via the Memory Workbench._\n';
const LESSONS_HEADER = '# Lessons\n\n_Append-only learnings. Managed in-app._\n';
const FACTS_HEADER = '# Facts\n\n_Brand knowledge. Managed in-app._\n';
const BANNED_HEADER = '# Banned words\n\n_Tone guardrails. Managed in-app._\n';
const ENABLED_AGENTS_HEADER =
  '# Enabled agents\n\n_Marketplace agent enablement overrides for this scope (Agents panel). Managed in-app._\n';
const ENABLED_MCP_HEADER =
  '# Enabled MCP servers\n\n_Marketplace MCP server enablement overrides for this scope (Settings > MCP Servers). Managed in-app._\n';

function factLine(subject: string, content: string): string {
  return subject ? `- **${subject}**: ${content}` : `- ${content}`;
}

/**
 * Build the rootDir-relative files for a scope's editable facts. Pure — no I/O —
 * so it is directly unit-testable. Buckets:
 *   how_to_act (voice/tone/instincts) → .atelier/memory/voice.md
 *   how_to_act (banned_words)         → guardrails/banned-words.md
 *   lesson                            → .atelier/memory/lessons.md (append-only)
 *   enabled-agents                    → .atelier/memory/enabled-agents.md
 *   enabled-mcp                       → .atelier/memory/enabled-mcp.md
 *   everything else (knowledge)       → .atelier/memory/facts.md
 * Returns a map of rootDir-relative path → file content. Empty buckets are omitted.
 */
export function buildScopeFiles(facts: ExportableFact[]): Record<string, string> {
  const voice: string[] = [];
  const banned: string[] = [];
  const lessons: string[] = [];
  const knowledge: string[] = [];
  const enabledAgents: string[] = [];
  const enabledMcp: string[] = [];

  // Stable ordering so repeated exports produce byte-identical files (clean diffs).
  const sorted = [...facts].sort(
    (a, b) => a.subject.localeCompare(b.subject) || a.content.localeCompare(b.content)
  );

  for (const f of sorted) {
    if (f.category === MIRROR_CATEGORY) continue;
    if (f.category === 'how_to_act') {
      if (f.subject === 'banned_words') {
        for (const raw of f.content.split(/[\n,]/)) {
          const w = raw
            .replace(/^[-*]\s*/, '')
            .replace(/`/g, '')
            .trim();
          if (w) banned.push(w);
        }
      } else {
        voice.push(factLine(f.subject, f.content));
      }
    } else if (f.category === 'lesson') {
      lessons.push(factLine(f.subject, f.content));
    } else if (f.category === 'enabled-agents') {
      enabledAgents.push(factLine(f.subject, f.content.trim().toLowerCase() === 'false' ? 'disabled' : 'enabled'));
    } else if (f.category === 'enabled-mcp') {
      enabledMcp.push(factLine(f.subject, f.content.trim().toLowerCase() === 'false' ? 'disabled' : 'enabled'));
    } else {
      knowledge.push(factLine(f.subject, f.content));
    }
  }

  const files: Record<string, string> = {};
  if (voice.length) files['.atelier/memory/voice.md'] = `${VOICE_HEADER}\n${voice.join('\n')}\n`;
  if (lessons.length)
    files['.atelier/memory/lessons.md'] = `${LESSONS_HEADER}\n${lessons.join('\n')}\n`;
  if (knowledge.length)
    files['.atelier/memory/facts.md'] = `${FACTS_HEADER}\n${knowledge.join('\n')}\n`;
  if (banned.length) {
    const uniq = [...new Set(banned)];
    files['guardrails/banned-words.md'] =
      `${BANNED_HEADER}\n${uniq.map((w) => `- ${w}`).join('\n')}\n`;
  }
  if (enabledAgents.length)
    files['.atelier/memory/enabled-agents.md'] =
      `${ENABLED_AGENTS_HEADER}\n${enabledAgents.join('\n')}\n`;
  if (enabledMcp.length)
    files['.atelier/memory/enabled-mcp.md'] = `${ENABLED_MCP_HEADER}\n${enabledMcp.join('\n')}\n`;
  return files;
}

/** Resolve the on-disk root for a memory scope, or null when it has no repo. */
export function rootDirForScope(scope: string): string | null {
  if (scope === 'world') return getWorldRoot();
  if (scope.startsWith('client:')) return clientPaths(scope.slice('client:'.length)).rootDir;
  // Projects share the parent client's repo — no standalone brain to export to.
  return null;
}

/** Memory-store surface the exporter needs (a subset of MemoryManager). */
export interface ExportMemory {
  getAllFacts(): ExportableFact[];
}

/**
 * Materialize a scope's editable facts into its on-disk brain. Writes only the
 * buckets that have content, creating parent dirs as needed. Returns the
 * rootDir-relative paths written. A no-op (empty list) for scopes without a repo.
 */
export function exportScopeToDisk(memory: ExportMemory, scope: string): string[] {
  const rootDir = rootDirForScope(scope);
  if (!rootDir) return [];
  const facts = memory.getAllFacts().filter((f) => (f.scope ?? 'user') === scope);
  const files = buildScopeFiles(facts);
  const written: string[] = [];
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf-8');
    written.push(rel);
  }
  return written;
}
