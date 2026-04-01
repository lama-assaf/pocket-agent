import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { AgentManager } from '../../agent';
import { SettingsManager } from '../../settings';
import { SYSTEM_GUIDELINES } from '../../config/system-guidelines';
import { loadWorkflowCommands, loadWorkflowCommandsFromDir } from '../../config/commands-loader';
import { createiOSChannel, destroyiOSChannel } from '../../channels/ios';
import type { ConnectedDevice, ClientChatMessage } from '../../channels/ios/types';
import { transcribeAudio } from '../../utils/transcribe';
import { getWindow, getAllWindows } from '../windows';
import { getAvailableModels } from './settings-ipc';
import type { IPCDependencies } from './types';

/**
 * Wire up all the iOS channel handlers on the given channel instance.
 * This is shared between the initial boot wiring (in initializeAgent) and
 * the live toggle (ios:toggle IPC handler).
 */
export function wireIosChannelHandlers(deps: IPCDependencies): void {
  const { getIosChannel, getMemory, getTelegramBot, getScheduler, updateTrayMenu, WIN } = deps;
  const iosChannel = getIosChannel();
  if (!iosChannel) return;

  iosChannel.setMessageHandler(
    async (client: { device: ConnectedDevice }, message: ClientChatMessage) => {
      let messageText = message.text;
      if (message.audio?.data) {
        console.log(
          `[Main] iOS voice note received (${message.audio.duration}s, ${Math.round(message.audio.data.length / 1024)}KB base64)`
        );
        const audioBuffer = Buffer.from(message.audio.data, 'base64');
        const transcription = await transcribeAudio(audioBuffer, message.audio.format || 'm4a');
        if (transcription.success && transcription.text) {
          messageText = transcription.text;
          console.log(`[Main] Transcribed: "${messageText.substring(0, 80)}..."`);
        } else {
          console.warn('[Main] Voice transcription failed:', transcription.error);
          if (!message.text) {
            throw new Error(
              `Voice transcription failed: ${transcription.error || 'Unknown error'}. Please try again or type your message.`
            );
          }
        }
      }
      // Forward status events to desktop UI during iOS-initiated queries
      const iosSessionId = message.sessionId;
      const desktopStatusHandler = (status: { type: string; sessionId?: string }) => {
        if (status.sessionId && status.sessionId !== iosSessionId) return;
        if (getWindow(WIN.CHAT)) {
          getWindow(WIN.CHAT)?.webContents.send('agent:status', status);
        }
      };
      AgentManager.on('status', desktopStatusHandler);
      let result;
      try {
        result = await AgentManager.processMessage(messageText, 'ios', message.sessionId);
      } finally {
        AgentManager.off('status', desktopStatusHandler);
      }
      if (getWindow(WIN.CHAT) && result.response) {
        getWindow(WIN.CHAT)?.webContents.send('ios:message', {
          userMessage: messageText,
          response: result.response,
          sessionId: message.sessionId,
          deviceId: client.device.deviceId,
        });
      }
      const memory = getMemory();
      const telegramBot = getTelegramBot();
      const linkedChatId = memory?.getChatForSession(message.sessionId);
      if (telegramBot && linkedChatId) {
        telegramBot
          .syncToChat(messageText, result.response, linkedChatId, result.media)
          .catch(() => {});
      }
      const currentIosChannel = getIosChannel();
      if (result.response && currentIosChannel) {
        currentIosChannel
          .sendPushNotifications('Pocket Agent', result.response, {
            sessionId: message.sessionId,
            type: 'response',
          })
          .catch(() => {});
      }
      return {
        response: result.response,
        tokensUsed: result.tokensUsed,
        media: result.media,
        planPending: result.planPending,
      };
    }
  );

  iosChannel.setSessionsHandler(() => {
    const memory = getMemory();
    const sessions = memory?.getSessions() || [];
    return sessions.map((s: { id: string; name: string; updated_at?: string }) => ({
      id: s.id,
      name: s.name,
      updatedAt: s.updated_at || new Date().toISOString(),
    }));
  });

  iosChannel.setHistoryHandler((sessionId, limit) => {
    const messages = AgentManager.getRecentMessages(limit, sessionId);
    return messages.map((m) => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp,
      metadata: m.metadata,
    }));
  });

  iosChannel.setStatusForwarder((sessionId, handler) => {
    const statusHandler = (status: Record<string, unknown>) => {
      if (status.sessionId && status.sessionId !== sessionId) return;
      handler({
        type: 'status',
        status: status.type as string,
        sessionId: (status.sessionId as string) || sessionId,
        message: status.message as string | undefined,
        toolName: status.toolName as string | undefined,
        toolInput: status.toolInput as string | undefined,
        partialText: status.partialText as string | undefined,
        partialReplace: status.partialReplace as boolean | undefined,
        agentCount: status.agentCount as number | undefined,
        teammateName: status.teammateName as string | undefined,
        taskSubject: status.taskSubject as string | undefined,
        queuePosition: status.queuePosition as number | undefined,
        queuedMessage: status.queuedMessage as string | undefined,
        blockedReason: status.blockedReason as string | undefined,
        isPocketCli: status.isPocketCli as boolean | undefined,
        backgroundTaskId: status.backgroundTaskId as string | undefined,
        backgroundTaskDescription: status.backgroundTaskDescription as string | undefined,
        backgroundTaskCount: status.backgroundTaskCount as number | undefined,
      });
    };
    AgentManager.on('status', statusHandler);
    return () => AgentManager.off('status', statusHandler);
  });

  iosChannel.setModelsHandler(() => {
    return { models: getAvailableModels(), activeModelId: AgentManager.getModel() };
  });

  iosChannel.setModelSwitchHandler((modelId: string) => {
    AgentManager.setModel(modelId);
  });

  iosChannel.setStopHandler((sessionId: string) => {
    return AgentManager.stopQuery(sessionId);
  });

  iosChannel.setClearHandler((sessionId: string) => {
    AgentManager.clearQueue(sessionId);
    AgentManager.clearConversation(sessionId);
    updateTrayMenu();
    getWindow(WIN.CHAT)?.webContents.send('session:cleared', sessionId);
    console.log(`[Main] Fresh start from iOS (session: ${sessionId})`);
  });

  iosChannel.setFactsHandler(() => AgentManager.getAllFacts());
  iosChannel.setFactsDeleteHandler((id) => {
    getMemory()?.deleteFact(id);
    return true;
  });
  iosChannel.setDailyLogsHandler((days) => getMemory()?.getDailyLogsSince(days || 3) || []);
  iosChannel.setSoulHandler(() => getMemory()?.getAllSoulAspects() || []);
  iosChannel.setSoulDeleteHandler((id) => {
    getMemory()?.deleteSoulAspectById(id);
    return true;
  });

  iosChannel.setCustomizeGetHandler(() => ({
    agentName: SettingsManager.get('personalize.agentName') || 'Frankie',
    description: SettingsManager.get('personalize.description') || '',
    personality: SettingsManager.get('personalize.personality') || '',
    goals: SettingsManager.get('personalize.goals') || '',
    struggles: SettingsManager.get('personalize.struggles') || '',
    funFacts: SettingsManager.get('personalize.funFacts') || '',
    systemGuidelines: SYSTEM_GUIDELINES,
    profile: {
      name: SettingsManager.get('profile.name') || '',
      occupation: SettingsManager.get('profile.occupation') || '',
      location: SettingsManager.get('profile.location') || '',
      timezone: SettingsManager.get('profile.timezone') || '',
      birthday: SettingsManager.get('profile.birthday') || '',
    },
  }));

  iosChannel.setCustomizeSaveHandler((data) => {
    if (data.agentName !== undefined) SettingsManager.set('personalize.agentName', data.agentName);
    if (data.description !== undefined)
      SettingsManager.set('personalize.description', data.description);
    if (data.personality !== undefined)
      SettingsManager.set('personalize.personality', data.personality);
    if (data.goals !== undefined) SettingsManager.set('personalize.goals', data.goals);
    if (data.struggles !== undefined) SettingsManager.set('personalize.struggles', data.struggles);
    if (data.funFacts !== undefined) SettingsManager.set('personalize.funFacts', data.funFacts);
    if (data.profile) {
      if (data.profile.name !== undefined) SettingsManager.set('profile.name', data.profile.name);
      if (data.profile.occupation !== undefined)
        SettingsManager.set('profile.occupation', data.profile.occupation);
      if (data.profile.location !== undefined)
        SettingsManager.set('profile.location', data.profile.location);
      if (data.profile.timezone !== undefined)
        SettingsManager.set('profile.timezone', data.profile.timezone);
      if (data.profile.birthday !== undefined)
        SettingsManager.set('profile.birthday', data.profile.birthday);
    }
  });

  iosChannel.setRoutinesListHandler(() => getScheduler()?.getAllJobs() || []);
  iosChannel.setRoutinesCreateHandler(async (name, schedule, prompt, channel, sessionId) => {
    return (await getScheduler()?.createJob(name, schedule, prompt, channel, sessionId)) || false;
  });
  iosChannel.setRoutinesDeleteHandler((name) => getScheduler()?.deleteJob(name) || false);
  iosChannel.setRoutinesToggleHandler(
    (name, enabled) => getScheduler()?.setJobEnabled(name, enabled) || false
  );
  iosChannel.setRoutinesRunHandler(async (name) => {
    try {
      await getScheduler()?.runJobNow(name);
      return { success: true };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });

  iosChannel.setAppInfoHandler(() => {
    return { version: app.getVersion(), name: 'Pocket Agent' };
  });

  iosChannel.setSkinHandler((skinId: string) => {
    SettingsManager.set('ui.skin', skinId);
    for (const win of getAllWindows()) {
      win.webContents.send('skin:changed', skinId);
    }
  });

  iosChannel.setModeGetHandler((sessionId: string) => {
    const memory = getMemory();
    const mode = memory?.getSessionMode(sessionId) || 'coder';
    const msgCount = memory?.getSessionMessageCount(sessionId) || 0;
    return { mode, locked: msgCount > 0 };
  });

  iosChannel.setModeSwitchHandler((sessionId: string, mode: string) => {
    const memory = getMemory();
    if (mode !== 'general' && mode !== 'coder') {
      const current = memory?.getSessionMode(sessionId) || 'coder';
      return { mode: current, locked: true, error: 'Invalid mode' };
    }
    const msgCount = memory?.getSessionMessageCount(sessionId) || 0;
    if (msgCount > 0) {
      const current = memory?.getSessionMode(sessionId) || 'coder';
      return {
        mode: current,
        locked: true,
        error: 'Cannot change mode after messages have been sent',
      };
    }
    memory?.setSessionMode(sessionId, mode as 'general' | 'coder');
    AgentManager.setMode(mode);
    SettingsManager.set('agent.mode', mode);
    if (getWindow(WIN.CHAT)) {
      getWindow(WIN.CHAT)?.webContents.send('agent:modeChanged', mode);
    }
    return { mode, locked: false };
  });

  iosChannel.setWorkflowsHandler((sessionId: string) => {
    const memory = getMemory();
    const sessionMode = memory?.getSessionMode(sessionId) || 'coder';
    const sessionWorkDir = memory?.getSessionWorkingDirectory(sessionId);
    if (sessionMode === 'coder' && sessionWorkDir) {
      const sessionCommandsDir = path.join(sessionWorkDir, '.claude', 'commands');
      if (fs.existsSync(sessionCommandsDir)) {
        return loadWorkflowCommandsFromDir(sessionCommandsDir).map((c) => ({
          name: c.name,
          description: c.description,
          content: c.content,
        }));
      }
    }
    return loadWorkflowCommands().map((c) => ({
      name: c.name,
      description: c.description,
      content: c.content,
    }));
  });

  iosChannel.setChatInfoHandler(() => ({
    username: SettingsManager.get('chat.username') || '',
    adminKey: SettingsManager.get('chat.adminKey') || '',
  }));
}

export function registerIosIPC(deps: IPCDependencies): void {
  const { getIosChannel, setIosChannel } = deps;

  ipcMain.handle('ios:pairing-code', async (_, regenerate?: boolean) => {
    const iosChannel = getIosChannel();
    if (!iosChannel) return { error: 'iOS channel not enabled' };
    if (regenerate) {
      iosChannel.regeneratePairingCode();
    }
    return {
      code: iosChannel.getPairingCode(),
      instanceId: iosChannel.getInstanceId(),
      mode: iosChannel.getMode(),
    };
  });

  ipcMain.handle('ios:devices', async () => {
    const iosChannel = getIosChannel();
    if (!iosChannel) return [];
    return iosChannel.getConnectedDevices();
  });

  ipcMain.handle('ios:info', async () => {
    const iosChannel = getIosChannel();
    if (!iosChannel) return { enabled: false };
    return {
      enabled: true,
      instanceId: iosChannel.getInstanceId(),
      mode: iosChannel.getMode(),
      relayUrl: iosChannel.getRelayUrl(),
    };
  });

  ipcMain.handle('ios:toggle', async (_, enabled: boolean) => {
    try {
      if (enabled && !getIosChannel()) {
        const newChannel = createiOSChannel();
        if (newChannel) {
          setIosChannel(newChannel);
          wireIosChannelHandlers(deps);
          await newChannel.start();
          console.log(`[Main] iOS channel started (${newChannel.getMode()} mode)`);
        }
      } else if (!enabled && getIosChannel()) {
        const iosChannel = getIosChannel();
        await iosChannel?.stop();
        destroyiOSChannel();
        setIosChannel(null);
        console.log('[Main] iOS channel stopped');
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] iOS toggle error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });
}
