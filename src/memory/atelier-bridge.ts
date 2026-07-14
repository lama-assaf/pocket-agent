import fs from 'fs';
import path from 'path';
import type { MemoryManager } from './index';
import type { MemoryTemplate } from '../marketplace/types';
import type { SessionContext } from './sessions';
import type { ScopeRoot } from '../clients/types';
import { scopeRootsForSelection } from '../clients/registry';

const CATEGORY = 'atelier-memory';

interface MemoryLike {
  saveFact(
    category: string,
    subject: string,
    content: string,
    sensitive?: boolean,
    scope?: string
  ): number;
  getFactsByCategory(category: string): { id: number; subject: string; scope?: string }[];
  deleteFact(id: number): boolean;
}

export class AtelierMemoryBridge {
  constructor(private memory: MemoryLike | MemoryManager) {}

  private memDir(projectDir: string): string {
    return path.join(projectDir, '.atelier', 'memory');
  }

  private listMemoryFiles(memoryRoot: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs);
        else if (e.name.endsWith('.md')) out.push(abs);
      }
    };
    walk(memoryRoot);
    return out;
  }

  /**
   * Mirror a `.atelier/memory` tree into SQLite facts under CATEGORY, tagged with
   * `scope`. Idempotent: existing rows for this scope+category are cleared first.
   * `subjectPrefix` disambiguates multiple dirs sharing one scope (legacy 'user').
   */
  private mirrorMemoryDir(memoryRoot: string, scope: string, subjectPrefix = ''): number {
    const mem = this.memory as MemoryLike;
    // delete existing mirror rows for this scope (+ prefix) — idempotent re-sync
    for (const f of mem.getFactsByCategory(CATEGORY)) {
      const inScope = (f.scope ?? 'user') === scope;
      const matchesPrefix = subjectPrefix ? f.subject.startsWith(subjectPrefix) : true;
      if (inScope && matchesPrefix) mem.deleteFact(f.id);
    }

    const files = this.listMemoryFiles(memoryRoot);
    for (const abs of files) {
      const rel = path.relative(memoryRoot, abs);
      const content = fs.readFileSync(abs, 'utf-8').trim();
      // saveFact triggers async embedding; scope isolates this brand's memory.
      if (content) mem.saveFact(CATEGORY, `${subjectPrefix}${rel}`, content, false, scope);
    }
    return files.length;
  }

  /**
   * Legacy per-project sync (user scope, projectDir-prefixed subjects). Kept for
   * the fire-and-forget write hook that mirrors edits made outside memory_init.
   */
  async syncProject(projectDir: string): Promise<{ files: number; chunks: number }> {
    const files = this.mirrorMemoryDir(this.memDir(projectDir), 'user', `${projectDir}::`);
    return { files, chunks: files };
  }

  /**
   * Mirror a single scope root (world / client / project) into SQLite under its
   * own scope, so recall in that context surfaces the brand's files.
   */
  async syncScopeRoot(root: ScopeRoot): Promise<{ files: number }> {
    const files = this.mirrorMemoryDir(root.memoryDir, root.scope);
    return { files };
  }

  /**
   * Sync every on-disk root implied by the session's selected context (world,
   * active client, active project), each tagged with its matching scope. This is
   * how a shared brain becomes visible in the selected space without leaking
   * into any other.
   */
  async syncSelection(
    context: SessionContext,
    projectRoot?: ScopeRoot | null
  ): Promise<{ roots: number; files: number }> {
    const roots = scopeRootsForSelection(context, projectRoot ?? null);
    let files = 0;
    for (const root of roots) {
      const res = await this.syncScopeRoot(root);
      files += res.files;
    }
    return { roots: roots.length, files };
  }

  async onMemoryFileWritten(absPath: string, projectDir: string): Promise<void> {
    if (!absPath.includes(path.join('.atelier', 'memory'))) return;
    await this.syncProject(projectDir);
  }

  async seed(projectDir: string, templates: MemoryTemplate[]): Promise<string[]> {
    const created: string[] = [];
    for (const t of templates) {
      const abs = path.join(this.memDir(projectDir), t.relativePath);
      if (fs.existsSync(abs)) continue;
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, t.content, 'utf-8');
      created.push(t.relativePath);
    }
    return created;
  }
}
