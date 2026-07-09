import fs from 'fs';
import path from 'path';
import type { MemoryManager } from './index';
import type { MemoryTemplate } from '../marketplace/types';

const CATEGORY = 'atelier-memory';

interface MemoryLike {
  saveFact(category: string, subject: string, content: string): number;
  getFactsByCategory(category: string): { id: number; subject: string }[];
  deleteFact(id: number): boolean;
}

export class AtelierMemoryBridge {
  constructor(private memory: MemoryLike | MemoryManager) {}

  private memDir(projectDir: string): string {
    return path.join(projectDir, '.atelier', 'memory');
  }

  private listMemoryFiles(projectDir: string): string[] {
    const root = this.memDir(projectDir);
    const out: string[] = [];
    const walk = (d: string) => {
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
    walk(root);
    return out;
  }

  async syncProject(projectDir: string): Promise<{ files: number; chunks: number }> {
    const mem = this.memory as MemoryLike;
    const prefix = `${projectDir}::`;
    // delete existing mirror rows for this project (idempotent re-sync)
    for (const f of mem.getFactsByCategory(CATEGORY))
      if (f.subject.startsWith(prefix)) mem.deleteFact(f.id);

    const files = this.listMemoryFiles(projectDir);
    for (const abs of files) {
      const rel = path.relative(this.memDir(projectDir), abs);
      const content = fs.readFileSync(abs, 'utf-8').trim();
      if (content) mem.saveFact(CATEGORY, `${prefix}${rel}`, content); // saveFact triggers async embedding
    }
    return { files: files.length, chunks: files.length };
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
