import { ipcMain } from 'electron';
import { AgentManager } from '../../agent';
import { resolveAndPersistModel } from '../../agent/resolve-model';
import { SUPPORTED_MODELS } from '../../agent/model-catalog';
import type { ProviderType } from '../../agent/providers';
import { SettingsManager, SETTINGS_SCHEMA } from '../../settings';
import { THEMES } from '../../settings/themes';
import { createTelegramBot } from '../../channels/telegram';
import { getWindow, getAllWindows } from '../windows';
import { setupBirthdayCronJobs } from '../birthday';
import type { IPCDependencies } from './types';

/**
 * Get available models based on configured API keys.
 * Single source of truth for the model list.
 */
export function getAvailableModels(): Array<{ id: string; name: string; provider: string }> {
  const hasAnthropic =
    (SettingsManager.get('auth.method') === 'oauth' && !!SettingsManager.get('auth.oauthToken')) ||
    !!SettingsManager.get('anthropic.apiKey');
  const hasOpenAI =
    !!SettingsManager.get('openai.apiKey') || SettingsManager.get('openai.auth.method') === 'oauth';
  const hasMoonshot =
    !!SettingsManager.get('moonshot.apiKey') || SettingsManager.get('kimi.auth.method') === 'oauth';

  // Which providers have credentials configured right now. The model list is
  // built from the gg-core registry (via SUPPORTED_MODELS) and filtered to
  // these, so names/ids always track the canonical catalog.
  const providerConfigured: Record<ProviderType, boolean> = {
    anthropic: hasAnthropic,
    openai: hasOpenAI,
    moonshot: hasMoonshot,
    glm: !!SettingsManager.get('glm.apiKey'),
    xiaomi: !!SettingsManager.get('xiaomi.apiKey'),
    minimax: !!SettingsManager.get('minimax.apiKey'),
    deepseek: !!SettingsManager.get('deepseek.apiKey'),
  };

  return SUPPORTED_MODELS.filter((m) => providerConfigured[m.provider as ProviderType]).map(
    (m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
    })
  );
}

/**
 * Settings keys that affect which LLM provider is in use. Whenever any of
 * these change we re-resolve `agent.model` and restart the agent so the
 * picker, chat-engine, and provider routing all stay in sync. Without
 * this, adding a Kimi key (for example) when the default model is
 * `claude-opus-4-7` leaves the agent trying to call Anthropic with no key
 * and surfaces a confusing "No API key configured" error.
 */
const PROVIDER_CREDENTIAL_KEYS = new Set([
  'anthropic.apiKey',
  'openai.apiKey',
  'moonshot.apiKey',
  'glm.apiKey',
  'xiaomi.apiKey',
  'minimax.apiKey',
  'deepseek.apiKey',
  'auth.method',
  'auth.oauthToken',
  'openai.auth.method',
  'kimi.auth.method',
  'kimi.accessToken',
]);

export function registerSettingsIPC(deps: IPCDependencies): void {
  const { getScheduler, setTelegramBot, getTelegramBot, WIN } = deps;

  // Keys that are encrypted but must be accessible from the renderer
  const RENDERER_ALLOWED_ENCRYPTED_KEYS = new Set(['chat.adminKey']);

  ipcMain.handle('marketplace:checkUpdates', async () => {
    const { PackSyncManager } = await import('../../marketplace/sync');
    const { PACK_SOURCES } = await import('../../marketplace/registry');
    return new PackSyncManager(PACK_SOURCES).checkAndUpdate();
  });

  ipcMain.handle('settings:getAll', async () => {
    return SettingsManager.getAllSafe();
  });

  ipcMain.handle('settings:getThemes', async () => {
    return THEMES;
  });

  ipcMain.handle('settings:getSkin', async () => {
    return SettingsManager.get('ui.skin') || 'default';
  });

  ipcMain.handle('settings:get', async (_, key: string) => {
    // Block encrypted settings from being sent to renderer (except explicitly allowed ones)
    const def = SETTINGS_SCHEMA.find((s) => s.key === key);
    if (def?.encrypted && !RENDERER_ALLOWED_ENCRYPTED_KEYS.has(key)) {
      const value = SettingsManager.get(key);
      return value ? '••••••••' : '';
    }
    return SettingsManager.get(key);
  });

  ipcMain.handle('settings:set', async (_, key: string, value: string) => {
    try {
      SettingsManager.set(key, value);

      // Auto-setup birthday cron jobs when birthday is set
      if (key === 'profile.birthday') {
        await setupBirthdayCronJobs(value, getScheduler());
      }

      // Broadcast skin change to all open windows
      if (key === 'ui.skin') {
        for (const win of getAllWindows()) {
          win.webContents.send('skin:changed', value);
        }
      }

      // Broadcast chat username change to chat window — no restart required
      if (key === 'chat.username' && getWindow(WIN.CHAT)) {
        getWindow(WIN.CHAT)?.webContents.send('chat:usernameChanged', value);
      }

      // Provider credential changed — re-resolve the active model and
      // restart the agent so the new key/model takes effect immediately.
      // Covers both "added a key" (agent may not be initialized yet) and
      // "removed a key" (model needs to swap to a still-available provider).
      if (PROVIDER_CREDENTIAL_KEYS.has(key)) {
        const previousModel = SettingsManager.get('agent.model');
        const resolvedModel = resolveAndPersistModel();
        const modelChanged = resolvedModel !== previousModel;
        // Restart even when the model didn't change — the underlying credential
        // (the API key value, OAuth token) may have rotated.
        try {
          await deps.restartAgent();
          console.log(
            `[Settings] Provider key changed (${key}) — agent restarted (model: ${resolvedModel}${modelChanged ? `, was: ${previousModel || 'unset'}` : ''})`
          );
        } catch (err) {
          console.error('[Settings] Failed to restart agent after key change:', err);
        }
        // Notify any open chat/settings windows so the model picker updates.
        if (modelChanged && getWindow(WIN.CHAT)) {
          getWindow(WIN.CHAT)?.webContents.send('model:changed', resolvedModel);
        }
        if (modelChanged && getWindow(WIN.SETTINGS)) {
          getWindow(WIN.SETTINGS)?.webContents.send('model:changed', resolvedModel);
        }
      }

      // Instant Telegram toggle — no restart required
      if (key === 'telegram.enabled') {
        const enabled = value === 'true' || value === '1';
        if (enabled) {
          const token = SettingsManager.get('telegram.botToken');
          if (!getTelegramBot() && token) {
            const bot = createTelegramBot();
            if (bot) {
              bot.setOnMessageCallback((data) => {
                if (getWindow(WIN.CHAT)) {
                  getWindow(WIN.CHAT)?.webContents.send('telegram:message', {
                    userMessage: data.userMessage,
                    response: data.response,
                    chatId: data.chatId,
                    sessionId: data.sessionId,
                    hasAttachment: data.hasAttachment,
                    attachmentType: data.attachmentType,
                    wasCompacted: data.wasCompacted,
                    media: data.media,
                  });
                }
              });
              bot.setOnSessionLinkCallback(() => {
                if (getWindow(WIN.CHAT)) {
                  getWindow(WIN.CHAT)?.webContents.send('sessions:changed');
                }
              });
              await bot.start();
              setTelegramBot(bot);
              const scheduler = getScheduler();
              if (scheduler) scheduler.setTelegramBot(bot);
              console.log('[Main] Telegram started (live toggle)');
            }
          }
        } else {
          const telegramBot = getTelegramBot();
          if (telegramBot) {
            await telegramBot.stop();
            setTelegramBot(null);
            const scheduler = getScheduler();
            if (scheduler) scheduler.setTelegramBot(null);
            console.log('[Main] Telegram stopped (live toggle)');
          }
        }
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('settings:delete', async (_, key: string) => {
    const success = SettingsManager.delete(key);
    return { success };
  });

  ipcMain.handle('settings:schema', async (_, category?: string) => {
    return SettingsManager.getSchema(category);
  });

  ipcMain.handle('settings:isFirstRun', async () => {
    return SettingsManager.isFirstRun();
  });

  ipcMain.handle('settings:resetOnboarding', async () => {
    SettingsManager.resetOnboarding();
    return { success: true };
  });

  ipcMain.handle('settings:initializeKeychain', async () => {
    return SettingsManager.initializeKeychain();
  });

  // Validation handlers
  ipcMain.handle('settings:validateAnthropic', async (_, key: string) => {
    return SettingsManager.validateAnthropicKey(key);
  });

  ipcMain.handle('settings:validateOpenAI', async (_, key: string) => {
    return SettingsManager.validateOpenAIKey(key);
  });

  ipcMain.handle('settings:validateTelegram', async (_, token: string) => {
    return SettingsManager.validateTelegramToken(token);
  });

  ipcMain.handle('settings:validateMoonshot', async (_, key: string) => {
    return SettingsManager.validateMoonshotKey(key);
  });

  ipcMain.handle('settings:validateGlm', async (_, key: string) => {
    return SettingsManager.validateGlmKey(key);
  });

  ipcMain.handle('settings:validateXiaomi', async (_, key: string) => {
    return SettingsManager.validateXiaomiKey(key);
  });

  ipcMain.handle('settings:validateMiniMax', async (_, key: string) => {
    return SettingsManager.validateMiniMaxKey(key);
  });

  ipcMain.handle('settings:validateDeepSeek', async (_, key: string) => {
    return SettingsManager.validateDeepSeekKey(key);
  });

  // Validate an already-stored key (reads real key from backend, never sent to renderer)
  ipcMain.handle('settings:validateStoredKey', async (_, provider: string) => {
    const keyMap: Record<string, string> = {
      anthropic: 'anthropic.apiKey',
      openai: 'openai.apiKey',
      moonshot: 'moonshot.apiKey',
      glm: 'glm.apiKey',
      xiaomi: 'xiaomi.apiKey',
      minimax: 'minimax.apiKey',
      deepseek: 'deepseek.apiKey',
      telegram: 'telegram.botToken',
    };
    const settingKey = keyMap[provider];
    if (!settingKey) return { valid: false, error: 'Unknown provider' };

    const storedKey = SettingsManager.get(settingKey);
    if (!storedKey) return { valid: false, error: 'No key saved — enter one first' };

    switch (provider) {
      case 'anthropic':
        return SettingsManager.validateAnthropicKey(storedKey);
      case 'openai':
        return SettingsManager.validateOpenAIKey(storedKey);
      case 'moonshot':
        return SettingsManager.validateMoonshotKey(storedKey);
      case 'glm':
        return SettingsManager.validateGlmKey(storedKey);
      case 'xiaomi':
        return SettingsManager.validateXiaomiKey(storedKey);
      case 'minimax':
        return SettingsManager.validateMiniMaxKey(storedKey);
      case 'deepseek':
        return SettingsManager.validateDeepSeekKey(storedKey);
      case 'telegram':
        return SettingsManager.validateTelegramToken(storedKey);
      default:
        return { valid: false, error: 'Unknown provider' };
    }
  });

  ipcMain.handle('settings:getAvailableModels', async () => {
    return getAvailableModels();
  });

  // Customize - System prompt (read-only, developer-controlled content only)
  ipcMain.handle('customize:getSystemPrompt', async () => {
    return AgentManager.getDeveloperPrompt() || '';
  });

  // Customize - Agent modes (read-only, for system prompt tab)
  ipcMain.handle('customize:getAgentModes', async () => {
    const { getAllModes } = await import('../../agent/agent-modes.js');
    return getAllModes().map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      systemPrompt: m.systemPrompt,
      description: m.description,
      lane: m.lane,
    }));
  });

  // Location and timezone lookup
  ipcMain.handle('location:lookup', async (_, query: string) => {
    if (!query || query.length < 2) return [];
    const cityTimezones = await import('city-timezones');
    const results = cityTimezones.lookupViaCity(query);
    return results
      .slice(0, 10)
      .map((r: { city: string; country: string; timezone: string; province?: string }) => ({
        city: r.city,
        country: r.country,
        province: r.province || '',
        timezone: r.timezone,
        display: r.province ? `${r.city}, ${r.province}, ${r.country}` : `${r.city}, ${r.country}`,
      }));
  });

  ipcMain.handle('timezone:list', async () => {
    try {
      const timezones = Intl.supportedValuesOf('timeZone');
      return timezones;
    } catch {
      return [
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Toronto',
        'America/Vancouver',
        'America/Mexico_City',
        'America/Sao_Paulo',
        'Europe/London',
        'Europe/Paris',
        'Europe/Berlin',
        'Europe/Rome',
        'Europe/Madrid',
        'Europe/Amsterdam',
        'Europe/Stockholm',
        'Europe/Moscow',
        'Asia/Tokyo',
        'Asia/Shanghai',
        'Asia/Hong_Kong',
        'Asia/Singapore',
        'Asia/Seoul',
        'Asia/Bangkok',
        'Asia/Jakarta',
        'Asia/Kolkata',
        'Asia/Dubai',
        'Asia/Jerusalem',
        'Australia/Sydney',
        'Australia/Melbourne',
        'Australia/Perth',
        'Pacific/Auckland',
        'Pacific/Honolulu',
        'Pacific/Fiji',
        'Africa/Cairo',
        'Africa/Johannesburg',
        'Africa/Lagos',
      ];
    }
  });
}
