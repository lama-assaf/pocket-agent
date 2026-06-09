import { ipcMain } from 'electron';
import { AgentManager } from '../../agent';
import type { IPCDependencies } from './types';

export function registerFactsIPC(deps: IPCDependencies): void {
  const { getMemory } = deps;

  // Facts
  ipcMain.handle('facts:list', async () => {
    return AgentManager.getAllFacts();
  });

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
  ipcMain.handle('facts:memoryUsage', async () => {
    const memory = getMemory();
    if (!memory) return { usedChars: 0, budgetChars: 3000, pct: 0 };
    return memory.getFactsMemoryUsage();
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
