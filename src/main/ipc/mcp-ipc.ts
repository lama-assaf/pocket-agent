// src/main/ipc/mcp-ipc.ts
// Browse + enable/credential surface for MCP servers: first-party (native to
// this app) merged with marketplace catalogs (Atelier/Salon, see
// src/marketplace/mcp-status.ts), plus per-scope enable/disable
// (src/agent/enablement.ts) layered on top for the active workspace context.
// No IPCDependencies needed — SettingsManager, the marketplace registry, and
// the memory-manager singleton are all accessed via their own modules, so
// this registers unconditionally, same as marketplace-ipc.ts.
import { ipcMain } from 'electron';
import { SettingsManager } from '../../settings';
import { allMcpCatalogs } from '../../marketplace/registry';
import { buildMCPServers, getDefaultToolsConfig } from '../../tools';
import { MCP_MARKETPLACE_CONFIG_KEY } from '../../agent/mcp-marketplace';
import {
  resolveMcpEnablement,
  getMcpEnablementAtScope,
  setMcpEnablement,
  clearMcpEnablement,
} from '../../agent/enablement';
import {
  buildMcpServerStatusList,
  parseMcpMarketplaceConfig,
  serializeMcpMarketplaceConfig,
  marketplaceEntryId,
  type McpServerStatus,
  type McpMarketplaceConfig,
  type FirstPartyServerDescriptor,
} from '../../marketplace/mcp-status';
import type { SessionContext } from '../../memory/sessions';

// Not a real session — the Settings MCP list has no "current chat" while
// browsing, so this is used only to build the `chat:<id>` link of the
// visible-scope chain (resolveVisibleScopes always includes it). No fact
// ever carries this scope, so it's a harmless no-op slot, not a real identity.
const MCP_UI_SESSION_ID = 'ipc:mcp-ui';

function loadConfig(): McpMarketplaceConfig {
  return parseMcpMarketplaceConfig(SettingsManager.get(MCP_MARKETPLACE_CONFIG_KEY));
}

function saveConfig(config: McpMarketplaceConfig): void {
  SettingsManager.set(MCP_MARKETPLACE_CONFIG_KEY, serializeMcpMarketplaceConfig(config), true);
}

/**
 * First-party server descriptors for the unified list — derived from
 * `buildMCPServers`'s live output. Empty by default: the only native entry
 * (`computer`, computer-use) has no settings toggle today and defaults off,
 * so this legitimately returns [] until that changes — not fabricated data.
 */
function listFirstPartyServers(): FirstPartyServerDescriptor[] {
  const servers = buildMCPServers(getDefaultToolsConfig());
  return Object.keys(servers).map((id) => ({
    id,
    name: id,
    description: 'Built-in Pocket Agent server',
    kind: 'stdio' as const,
  }));
}

/** Find a marketplace catalog entry by its stable `<packId>:<entryId>` id. */
function findMarketplaceEntry(id: string) {
  return allMcpCatalogs().find((m) => marketplaceEntryId(m.packId, m.entry.id) === id);
}

export function registerMcpIPC(): void {
  ipcMain.handle(
    'mcp:listServers',
    async (_, context?: SessionContext): Promise<McpServerStatus[]> => {
      return buildMcpServerStatusList({
        firstParty: listFirstPartyServers(),
        marketplace: allMcpCatalogs(),
        config: loadConfig(),
        resolveScope: (packId, entryId) =>
          resolveMcpEnablement(context, packId, entryId, MCP_UI_SESSION_ID),
      });
    }
  );

  ipcMain.handle(
    'mcp:setServerEnabled',
    async (
      _,
      id: string,
      enabled: boolean,
      confirmed?: boolean
    ): Promise<{ success: boolean; error?: string; riskNote?: string }> => {
      if (id.startsWith('first-party:')) {
        return { success: false, error: 'Built-in servers cannot be toggled' };
      }
      const found = findMarketplaceEntry(id);
      if (!found) return { success: false, error: 'Unknown server' };

      // Server-side enforcement of the risk-confirm gate, not just the UI
      // dialog: enabling a risk-flagged entry without an explicit confirm is
      // rejected outright.
      if (enabled && found.entry.riskNote && confirmed !== true) {
        return { success: false, error: 'Confirmation required', riskNote: found.entry.riskNote };
      }

      const config = loadConfig();
      const existing = config[id] ?? { enabled: false, env: {} };
      config[id] = { ...existing, enabled };
      saveConfig(config);
      return { success: true };
    }
  );

  ipcMain.handle(
    'mcp:setServerEnv',
    async (_, id: string, env: Record<string, string>): Promise<{ success: boolean; error?: string }> => {
      if (id.startsWith('first-party:')) {
        return { success: false, error: 'Built-in servers have no configurable credentials' };
      }
      const found = findMarketplaceEntry(id);
      if (!found) return { success: false, error: 'Unknown server' };

      const config = loadConfig();
      const existing = config[id] ?? { enabled: false, env: {} };
      // Only overwrite keys with a non-empty submitted value — secrets are
      // never sent back to the renderer, so a blank field is the only way to
      // signal "leave this credential unchanged" rather than "clear it".
      const mergedEnv = { ...existing.env };
      for (const [k, v] of Object.entries(env)) {
        if (v) mergedEnv[k] = v;
      }
      config[id] = { ...existing, env: mergedEnv };
      saveConfig(config);
      return { success: true };
    }
  );

  // ── Scoped enable/disable (get/set/clear), scoped to the active workspace ──
  // Layered on top of the settings-level enabled/configured gate above — a
  // client/project can disable a server the agency has enabled and configured.

  ipcMain.handle(
    'mcp:getServerScopeEnablement',
    async (_, id: string, context: SessionContext) => {
      const found = findMarketplaceEntry(id);
      if (!found) return null;
      return getMcpEnablementAtScope(context, found.packId, found.entry.id);
    }
  );

  ipcMain.handle(
    'mcp:setServerScopeEnablement',
    async (_, id: string, enabled: boolean, context: SessionContext) => {
      const found = findMarketplaceEntry(id);
      if (!found) return { success: false, error: 'Unknown server' };
      return setMcpEnablement(context, found.packId, found.entry.id, enabled);
    }
  );

  ipcMain.handle(
    'mcp:clearServerScopeEnablement',
    async (_, id: string, context: SessionContext) => {
      const found = findMarketplaceEntry(id);
      if (!found) return { success: false, scope: '' };
      return clearMcpEnablement(context, found.packId, found.entry.id);
    }
  );
}
