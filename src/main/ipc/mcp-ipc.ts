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
  isFullyConfigured,
  resolveMcpServer,
  resolveReauthCommand,
  type McpServerStatus,
  type McpMarketplaceConfig,
  type FirstPartyServerDescriptor,
} from '../../marketplace/mcp-status';
import { getMcpServerManager } from '../../mcp/manager';
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
      const manager = getMcpServerManager();
      return buildMcpServerStatusList({
        firstParty: listFirstPartyServers(),
        marketplace: allMcpCatalogs(),
        config: loadConfig(),
        resolveScope: (packId, entryId) =>
          resolveMcpEnablement(context, packId, entryId, MCP_UI_SESSION_ID),
        resolveRuntime: (id) => ({ status: manager.getStatus(id), error: manager.getLastError(id) }),
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
    async (
      _,
      id: string,
      env: Record<string, string>
    ): Promise<{ success: boolean; error?: string; autoEnabled?: boolean }> => {
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

      // Auto-enable on the save that completes every required credential —
      // fixes the exact reported bug: a user fills in every credential field
      // and clicks "Save credentials", reasonably expecting that to mean
      // "this server is now set up", but enabled/env used to be two fully
      // independent flags with no UI nudge connecting them. The row stayed on
      // "Disabled" (indistinguishable from "never touched") until a SEPARATE
      // toggle click, which is easy to miss since it sits in the row header,
      // not next to the Save button in the credentials form below it.
      // Never auto-enables a risk-flagged entry — that still requires the
      // explicit confirm-dialog opt-in via mcp:setServerEnabled, preserving
      // the safety-critical gate mcp:setServerEnabled enforces server-side.
      const becameFullyConfigured = isFullyConfigured(found.entry, mergedEnv);
      const autoEnabled = becameFullyConfigured && !existing.enabled && !found.entry.riskNote;

      config[id] = { ...existing, env: mergedEnv, enabled: existing.enabled || autoEnabled };
      saveConfig(config);
      return { success: true, autoEnabled };
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

  // ── Reauthenticate (force a fresh OAuth login) ──
  // Only meaningful for a marketplace entry that declares a `reauth`
  // command (McpCatalogEntry.reauth, e.g. xurl's `auth clear --all`) —
  // see src/marketplace/mcp-status.ts's `reauthenticable` flag, which is
  // what gates the Settings UI's "Reauthenticate" button in the first
  // place. No session context needed: like setServerEnabled/setServerEnv,
  // this is a global (not per-scope) settings-level action.
  ipcMain.handle(
    'mcp:reauthenticateServer',
    async (
      _,
      id: string
    ): Promise<{ success: boolean; cleared: boolean; message: string }> => {
      if (id.startsWith('first-party:')) {
        return { success: false, cleared: false, message: 'Built-in servers do not use OAuth' };
      }
      const found = findMarketplaceEntry(id);
      if (!found) return { success: false, cleared: false, message: 'Unknown server' };

      const config = loadConfig();
      const stored = config[id];
      const reauthCmd = resolveReauthCommand(found.entry, stored?.env ?? {});
      if (!reauthCmd) {
        return {
          success: false,
          cleared: false,
          message: 'This server does not support reauthentication',
        };
      }

      // Only attempt the immediate respawn (which kicks off a fresh OAuth
      // login right away) if the server is actually enabled + fully
      // configured — otherwise there's nothing valid to spawn, and the
      // manager method already handles a missing respawnSpec by reporting
      // just the clear step succeeded.
      const resolvedSpec =
        stored?.enabled && isFullyConfigured(found.entry, stored.env)
          ? resolveMcpServer(found.entry, stored.env)
          : null;

      const manager = getMcpServerManager();
      return manager.reauthenticateServer(id, reauthCmd, resolvedSpec ?? undefined);
    }
  );
}