// src/main/ipc/marketplace-ipc.ts
// Browse + local-override + scoped-enablement surface for the marketplace
// agent registry (Atelier/Salon pack agents). No IPCDependencies needed — the
// marketplace module has no electron dependency of its own, and
// override/enablement resolution goes through src/agent/agent-overrides.ts
// and src/agent/enablement.ts, which read the memory manager singleton
// (src/tools/memory-tools.ts) directly — so this registers unconditionally,
// same as before.
import { ipcMain } from 'electron';
import { allAgentsGrouped } from '../../marketplace/registry';
import { applyAgentOverride, type AgentOverrideFields } from '../../marketplace/overrides';
import {
  resolveAgentOverride,
  getAgentOverrideAtScope,
  setAgentOverride,
  clearAgentOverride,
} from '../../agent/agent-overrides';
import {
  resolveAgentEnablement,
  getAgentEnablementAtScope,
  setAgentEnablement,
  clearAgentEnablement,
} from '../../agent/enablement';
import type { SessionContext } from '../../memory/sessions';
import type { PackAgent } from '../../marketplace/types';

// Not a real session — the Agents panel has no "current chat" while browsing,
// so this is used only to build the `chat:<id>` link of the visible-scope
// chain (resolveVisibleScopes always includes it). No fact ever carries this
// scope, so it's a harmless no-op slot, not a real identity.
const MARKETPLACE_UI_SESSION_ID = 'ipc:marketplace-ui';

export interface MarketplaceAgentSummary {
  packId: string;
  packName: string;
  lane: string;
  name: string;
  description: string;
  tools: string[];
  model?: string;
  /** True when an override is active for this agent in the given context (nearest-scope-wins). */
  hasOverride: boolean;
  /** Effective enabled state for the given context (nearest-scope-wins; default true). */
  enabled: boolean;
  /** Scope the enablement decision came from, or 'default' when nothing overrides the implicit agency-wide enable. */
  enablementScope: string;
}

export interface MarketplaceAgentDetail extends MarketplaceAgentSummary {
  /** Effective prompt — the override's prompt when set, otherwise the marketplace default. */
  prompt: string;
  /** Marketplace default prompt, always shown as the read-only reference. */
  basePrompt: string;
  /** Scope the active override was found at, when one exists. */
  overrideScope?: string;
}

function toSummary(
  found: ReturnType<typeof allAgentsGrouped>[number],
  effective: PackAgent,
  hasOverride: boolean,
  enablement: { enabled: boolean; scope: string }
): MarketplaceAgentSummary {
  const { packId, packName, lane, agent } = found;
  return {
    packId,
    packName,
    lane,
    name: agent.name,
    description: agent.description,
    tools: effective.tools,
    model: effective.model,
    hasOverride,
    enabled: enablement.enabled,
    enablementScope: enablement.scope,
  };
}

export function registerMarketplaceIPC(): void {
  ipcMain.handle(
    'marketplace:listAgents',
    async (_, context?: SessionContext): Promise<MarketplaceAgentSummary[]> => {
      return allAgentsGrouped().map((found) => {
        const resolved = resolveAgentOverride(
          context,
          found.packId,
          found.agent.name,
          MARKETPLACE_UI_SESSION_ID
        );
        const effective = applyAgentOverride(found.agent, resolved?.fields ?? null);
        const enablement = resolveAgentEnablement(
          context,
          found.packId,
          found.agent.name,
          MARKETPLACE_UI_SESSION_ID
        );
        return toSummary(found, effective, resolved !== null, enablement);
      });
    }
  );

  ipcMain.handle(
    'marketplace:getAgent',
    async (
      _,
      packId: string,
      name: string,
      context?: SessionContext
    ): Promise<MarketplaceAgentDetail | null> => {
      const found = allAgentsGrouped().find((g) => g.packId === packId && g.agent.name === name);
      if (!found) return null;
      const resolved = resolveAgentOverride(context, packId, name, MARKETPLACE_UI_SESSION_ID);
      const effective = applyAgentOverride(found.agent, resolved?.fields ?? null);
      const enablement = resolveAgentEnablement(context, packId, name, MARKETPLACE_UI_SESSION_ID);
      return {
        ...toSummary(found, effective, resolved !== null, enablement),
        prompt: effective.prompt,
        basePrompt: found.agent.prompt,
        overrideScope: resolved?.scope,
      };
    }
  );

  // ── Local overrides (get/set/clear), scoped to the active workspace ──

  ipcMain.handle(
    'marketplace:getAgentOverride',
    async (_, packId: string, name: string, context: SessionContext) => {
      return getAgentOverrideAtScope(context, packId, name);
    }
  );

  ipcMain.handle(
    'marketplace:setAgentOverride',
    async (
      _,
      packId: string,
      name: string,
      fields: AgentOverrideFields,
      context: SessionContext
    ) => {
      return setAgentOverride(context, packId, name, fields);
    }
  );

  ipcMain.handle(
    'marketplace:clearAgentOverride',
    async (_, packId: string, name: string, context: SessionContext) => {
      return clearAgentOverride(context, packId, name);
    }
  );

  // ── Scoped enable/disable (get/set/clear), scoped to the active workspace ──

  ipcMain.handle(
    'marketplace:getAgentEnablement',
    async (_, packId: string, name: string, context: SessionContext) => {
      return getAgentEnablementAtScope(context, packId, name);
    }
  );

  ipcMain.handle(
    'marketplace:setAgentEnablement',
    async (_, packId: string, name: string, enabled: boolean, context: SessionContext) => {
      return setAgentEnablement(context, packId, name, enabled);
    }
  );

  ipcMain.handle(
    'marketplace:clearAgentEnablement',
    async (_, packId: string, name: string, context: SessionContext) => {
      return clearAgentEnablement(context, packId, name);
    }
  );
}
