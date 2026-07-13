import { ipcMain } from 'electron';
import { AgentManager } from '../../agent';
import { USER_SCOPE, WORLD_SCOPE } from '../../memory/scope';
import type { IPCDependencies } from './types';

// Server-side-enforced safe default when a caller omits `scope` (F4): personal
// (user+world) rather than every memory space unfiltered. Closes the leak where
// an IPC call with no scope argument (e.g. the legacy "My Brain" window) could
// read every client's shared facts. Existing scoped callers (Brain panel) are
// unaffected — they always pass an explicit scope.
const SAFE_DEFAULT_SCOPES = [USER_SCOPE, WORLD_SCOPE];

export function registerFactsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // Facts. `scope` filters to a single memory space (Brain space view): 'user'
  // (personal), 'world', 'client:<id>', or 'project:<key>'. Missing scope never
  // falls through to an unfiltered dump of every space — it defaults to the
  // safe personal bundle instead (see SAFE_DEFAULT_SCOPES above).
  ipcMain.handle('facts:list', async (_, scope?: string) => {
    const all = AgentManager.getAllFacts();
    if (!scope) return all.filter((f) => SAFE_DEFAULT_SCOPES.includes(f.scope ?? 'user'));
    return all.filter((f) => (f.scope ?? 'user') === scope);
  });

  // In-app fact authoring. The caller passes the target `scope` (the Memory
  // Workbench is always scoped to the active client/project), defaulting to the
  // personal `user` scope so a create can never silently leak across brands.
  ipcMain.handle(
    'facts:create',
    async (
      _,
      input: {
        category: string;
        subject: string;
        content: string;
        sensitive?: boolean;
        scope?: string;
      }
    ) => {
      const memory = getMemory();
      if (!memory) return { success: false, error: 'Memory not initialized' };
      const { category, subject, content, sensitive, scope } = input;
      if (!category || !content) {
        return { success: false, error: 'Missing required fields: category, content' };
      }
      const id = memory.saveFact(category, subject ?? '', content, sensitive, scope ?? 'user');
      return { success: true, fact: memory.getFact(id) };
    }
  );

  ipcMain.handle('facts:search', async (_, query: string) => {
    const memory = getMemory();
    if (memory && query && query.trim().length > 0) {
      // Prefer semantic recall when embeddings are available; fall back to LIKE.
      const embedding = await memory.embedQuery(query);
      if (embedding) {
        const matches = memory.semanticSearchFacts(embedding, 12);
        if (matches.length > 0) {
          return matches.map((f) => ({
            id: f.id,
            category: f.category,
            subject: f.subject,
            content: f.content,
          }));
        }
      }
    }
    return AgentManager.searchFacts(query);
  });

  ipcMain.handle('facts:categories', async () => {
    return getMemory()?.getFactCategories() || [];
  });

  ipcMain.handle('facts:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteFact(id);
    return { success };
  });

  ipcMain.handle(
    'facts:update',
    async (_, id: number, fields: { category?: string; subject?: string; content?: string }) => {
      const memory = getMemory();
      if (!memory) return { success: false };
      return { success: memory.updateFact(id, fields) };
    }
  );

  ipcMain.handle('facts:setSensitive', async (_, id: number, sensitive: boolean) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    return { success: memory.setFactSensitive(id, sensitive) };
  });

  // Soul (Self-Knowledge)
  ipcMain.handle('soul:list', async () => {
    const memory = getMemory();
    if (!memory) return [];
    return memory.getAllSoulAspects();
  });

  ipcMain.handle('soul:get', async (_, aspect: string) => {
    const memory = getMemory();
    if (!memory) return null;
    return memory.getSoulAspect(aspect);
  });

  ipcMain.handle('soul:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteSoulAspectById(id);
    return { success };
  });

  ipcMain.handle(
    'soul:update',
    async (_, id: number, fields: { aspect?: string; content?: string }) => {
      const memory = getMemory();
      if (!memory) return { success: false };
      return { success: memory.updateSoulAspect(id, fields) };
    }
  );

  // Export everything the agent remembers (JSON or Markdown)
  ipcMain.handle('memory:export', async (_, format: 'json' | 'markdown' = 'json') => {
    const memory = getMemory();
    if (!memory) return null;
    return format === 'markdown' ? memory.exportMemoryMarkdown() : memory.exportMemory();
  });

  // Memory usage stats
  ipcMain.handle('facts:memoryUsage', async (_, scope?: string) => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 3000, pct: 0 };
    return memory.getFactsMemoryUsage(scope);
  });

  ipcMain.handle('soul:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 1500, pct: 0 };
    return memory.getSoulMemoryUsage();
  });

  ipcMain.handle('dailyLogs:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 2000, pct: 0 };
    return memory.getDailyLogsMemoryUsage();
  });

  // Daily Logs
  ipcMain.handle('dailyLogs:list', async () => {
    return AgentManager.getDailyLogsSince(3);
  });

  ipcMain.handle('dailyLogs:delete', async (_, id: number) => {
    const memory = getMemory();
    if (!memory) return { success: false };
    const success = memory.deleteDailyLog(id);
    return { success };
  });
}
