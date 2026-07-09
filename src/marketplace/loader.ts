import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { PackSource, LoadedPack, PackAgent, RuleFile, MemoryTemplate, Skill } from './types';
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

export function readPack(source: PackSource): LoadedPack {
  const dir = path.join(getPluginsRoot(), source.id); // <userData>/plugins/<id> (or seed in tests)
  return {
    id: source.id,
    agents: loadAgents(path.join(dir, 'agents')),
    skills: loadSkills(path.join(dir, 'skills')),
    commands: loadCommands(path.join(dir, 'commands')),
    rules: loadRules(path.join(dir, 'rules')),
    memoryTemplates: loadMemoryTemplates(path.join(dir, 'memory')),
  };
}

export function loadAllPacks(sources: PackSource[]): LoadedPack[] {
  return sources.map(readPack);
}
