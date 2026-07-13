import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type {
  PackSource,
  LoadedPack,
  PackAgent,
  RuleFile,
  MemoryTemplate,
  Skill,
  McpCatalogEntry,
} from './types';
import { getPluginsRoot } from './paths';

const FM_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

export function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
  meta: Record<string, string>;
  body: string;
} {
  const m = raw.match(FM_RE);
  if (!m) return { meta: {}, body: raw.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim();
  }
  return { name: meta.name, description: meta.description, meta, body: m[2].trim() };
}

function readMd(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function listFiles(dir: string, ext = '.md'): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(ext))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function parseToolsField(v?: string): string[] {
  if (!v) return [];
  // frontmatter tools look like: ["Read", "Grep", "Glob"]
  const inner = v.replace(/^\[|\]$/g, '');
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function loadAgents(dir: string): PackAgent[] {
  return listFiles(dir)
    .map((file) => {
      const { name, description, meta, body } = parseFrontmatter(readMd(file));
      return {
        name: name || path.basename(file, '.md'),
        description: description || '',
        tools: parseToolsField(meta.tools),
        model: meta.model,
        prompt: body,
        source: file,
      };
    })
    .filter((a) => a.prompt.length > 0);
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function loadSkills(dir: string): Skill[] {
  const out: Skill[] = [];
  for (const name of listDirs(dir)) {
    const file = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    const { name: fmName, description, body } = parseFrontmatter(readMd(file));
    out.push({ name: fmName || name, description: description || '', content: body, source: file });
  }
  return out;
}

function loadCommands(dir: string): LoadedPack['commands'] {
  return listFiles(dir).map((file) => {
    const { name, description, body } = parseFrontmatter(readMd(file));
    return {
      name: name || path.basename(file, '.md'),
      description: description || '',
      filename: path.basename(file),
      content: body,
    };
  });
}

function loadRules(dir: string): RuleFile[] {
  const out: RuleFile[] = [];
  for (const lane of listDirs(dir)) {
    const laneDir = path.join(dir, lane);
    if (!fs.statSync(laneDir).isDirectory()) continue;
    for (const file of listFiles(laneDir)) {
      const content = readMd(file);
      if (!content) continue;
      out.push({
        lane,
        filename: path.basename(file),
        content,
        hash: crypto.createHash('sha256').update(content).digest('hex'),
      });
    }
  }
  return out;
}

function loadMemoryTemplates(dir: string): MemoryTemplate[] {
  const out: MemoryTemplate[] = [];
  const listEntries = (d: string): fs.Dirent[] => {
    try {
      return fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return [];
    }
  };
  const walk = (d: string, base: string): void => {
    for (const e of listEntries(d)) {
      const abs = path.join(d, e.name);
      const rel = path.join(base, e.name);
      if (e.isDirectory()) walk(abs, rel);
      else if (e.name.endsWith('.md')) out.push({ relativePath: rel, content: readMd(abs) });
    }
  };
  walk(dir, '');
  return out;
}

// Flags a catalog entry's `_comment` as a risk/cost note worth surfacing separately
// (e.g. ToS violations, paid tiers) vs a plain informational description.
const RISK_RE = /\b(RISK|TOS|COST|violat|pay-per|paid plan|unofficial)/i;

/**
 * Parse a pack's mcp-configs/mcp-servers.json catalog. These are opt-in server
 * *templates* the pack authors curated (see mcp-configs/README.md in each repo) —
 * never auto-loaded or connected by us. Missing/malformed files degrade to [].
 */
export function loadMcpCatalog(dir: string): McpCatalogEntry[] {
  const file = path.join(dir, 'mcp-servers.json');
  const raw = readMd(file);
  if (!raw) return [];
  let parsed: { mcpServers?: Record<string, Record<string, unknown>> };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const servers = parsed.mcpServers;
  if (!servers || typeof servers !== 'object') return [];
  const out: McpCatalogEntry[] = [];
  for (const [id, entry] of Object.entries(servers)) {
    if (!entry || typeof entry !== 'object') continue;
    const comment = typeof entry._comment === 'string' ? entry._comment : undefined;
    const isUrl = typeof entry.type === 'string' && entry.type === 'url';
    const base: McpCatalogEntry = {
      id,
      kind: isUrl ? 'url' : 'stdio',
      description: comment,
      riskNote: comment && RISK_RE.test(comment) ? comment : undefined,
    };
    if (isUrl) {
      if (typeof entry.url === 'string') base.url = entry.url;
      if (entry.headers && typeof entry.headers === 'object') {
        base.headers = entry.headers as Record<string, string>;
      }
    } else {
      if (typeof entry.command === 'string') base.command = entry.command;
      if (Array.isArray(entry.args)) base.args = entry.args as string[];
      if (entry.env && typeof entry.env === 'object') {
        base.env = entry.env as Record<string, string>;
      }
    }
    out.push(base);
  }
  return out;
}

export function readPack(source: PackSource): LoadedPack {
  const dir = path.join(getPluginsRoot(), source.id); // <userData>/plugins/<id> (or seed in tests)
  return {
    id: source.id,
    agents: loadAgents(path.join(dir, 'agents')),
    skills: loadSkills(path.join(dir, 'skills')),
    commands: loadCommands(path.join(dir, 'commands')),
    rules: loadRules(path.join(dir, 'rules')),
    memoryTemplates: loadMemoryTemplates(path.join(dir, 'memory')),
    mcpCatalog: loadMcpCatalog(path.join(dir, 'mcp-configs')),
  };
}

export function loadAllPacks(sources: PackSource[]): LoadedPack[] {
  return sources.map(readPack);
}
