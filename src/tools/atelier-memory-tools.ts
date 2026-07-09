/**
 * Atelier memory-init tool
 *
 * Seeds this project's `.atelier/memory/` tree with any missing
 * operator-memory templates (instincts, lessons, glossary, voice,
 * campaigns) sourced from the marketplace packs, then re-syncs the
 * memory mirror in SQLite.
 */

import { AtelierMemoryBridge } from '../memory/atelier-bridge';
import { loadAllPacks } from '../marketplace/loader';
import { PACK_SOURCES } from '../marketplace/registry';
import { getMemoryManager } from './memory-tools';
import { getCurrentSessionId } from './session-context';

/**
 * Get all Atelier memory tools
 */
export function getAtelierMemoryTools() {
  return [
    {
      name: 'memory_init',
      description:
        "Seed this project's .atelier/memory/ tree with any missing operator-memory templates (instincts, lessons, glossary, voice, campaigns). Never overwrites existing files.",
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
      handler: async (): Promise<string> => {
        const memory = getMemoryManager();
        if (!memory) return 'Memory not available.';

        const sessionId = getCurrentSessionId();
        const projectDir = memory.getSessionWorkingDirectory(sessionId) || process.cwd();

        const bridge = new AtelierMemoryBridge(memory);
        const templates = loadAllPacks(PACK_SOURCES).flatMap((p) => p.memoryTemplates);
        const created = await bridge.seed(projectDir, templates);
        await bridge.syncProject(projectDir);

        return created.length
          ? `Seeded ${created.length} memory file(s): ${created.join(', ')}`
          : 'All operator-memory files already present.';
      },
    },
  ];
}
