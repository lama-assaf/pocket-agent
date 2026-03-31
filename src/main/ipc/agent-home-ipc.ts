import { ipcMain } from 'electron';
import { AgentManager, type AgentStatus } from '../../agent';
import { createAgentHomeChannel, destroyAgentHomeChannel } from '../../channels/agent-home';
import type { AgentSession } from '@kenkaiiii/agent-home-sdk';
import type { IncomingMessage, ResponseStream } from '@kenkaiiii/agent-home-sdk';
import type { IPCDependencies } from './types';

function pushSessionsToRelay(deps: IPCDependencies): void {
  const channel = deps.getAgentHomeChannel();
  const memory = deps.getMemory();
  if (!channel || !memory) return;

  const sessions = memory.getSessions();
  const agentSessions: AgentSession[] = sessions.map((s) => ({
    id: s.id,
    title: s.name,
    updatedAt: new Date(s.updated_at).getTime(),
  }));
  channel.updateSessions(agentSessions);
}

export function wireAgentHomeChannelHandlers(deps: IPCDependencies): void {
  const { getAgentHomeChannel, getMemory } = deps;
  const channel = getAgentHomeChannel();
  if (!channel) return;

  // Push sessions to relay on connect
  channel.onConnect(() => {
    pushSessionsToRelay(deps);
  });

  // Clean up sessions when deleted from the iOS app
  channel.onSessionDelete((sessionId: string) => {
    const memory = getMemory();
    if (memory) {
      try {
        memory.deleteSession(sessionId);
        console.log(`[AgentHome] Deleted session from DB: ${sessionId}`);
      } catch (err) {
        console.error(`[AgentHome] Failed to delete session ${sessionId}:`, err);
      }
    }
  });

  channel.setMessageHandler(async (message: IncomingMessage, stream: ResponseStream) => {
    try {
      const memory = getMemory();
      let sessionId: string;
      let isNewSession = false;

      if (message.sessionId) {
        // Existing session — route to it and update timestamp
        sessionId = message.sessionId;
        if (memory) memory.ensureSession(sessionId, 'general');
      } else {
        // New chat from Agent Home — create a unique session
        sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        isNewSession = true;
        const title =
          message.content.length > 50 ? message.content.slice(0, 50) + '...' : message.content;
        if (memory) memory.ensureSession(sessionId, 'general');
        // Rename the auto-created session to use the message as title
        if (memory) {
          try {
            memory.renameSession(sessionId, title);
          } catch {
            // renameSession may fail if name collides; session still usable
          }
        }
      }

      console.log(
        `[AgentHome] Message received (session: ${sessionId}, new: ${isNewSession}): "${message.content.substring(0, 80)}..."`
      );

      // Push sessions so Agent Home sees the new/updated session immediately
      pushSessionsToRelay(deps);

      // Stream tokens to Agent Home as the agent composes
      const streamSessionOpts = isNewSession ? { sessionId } : undefined;
      const statusListener = (status: AgentStatus) => {
        if (
          status.sessionId === sessionId &&
          status.type === 'partial_text' &&
          status.partialText
        ) {
          stream.token(status.partialText, streamSessionOpts);
        }
      };
      AgentManager.on('status', statusListener);

      try {
        const result = await AgentManager.processMessage(message.content, 'agent-home', sessionId);
        const responseText = result.response || 'No response generated.';

        if (isNewSession) {
          stream.end(responseText, { sessionId });
        } else {
          stream.end(responseText);
        }
      } finally {
        AgentManager.off('status', statusListener);
      }

      // Push updated sessions after processing (updated_at may have changed)
      pushSessionsToRelay(deps);
    } catch (error) {
      console.error('[AgentHome] Message handling error:', error);
      stream.error(error instanceof Error ? error.message : 'Unknown error');
    }
  });
}

export function registerAgentHomeIPC(deps: IPCDependencies): void {
  const { getAgentHomeChannel, setAgentHomeChannel } = deps;

  ipcMain.handle('agentHome:toggle', async (_, enabled: boolean) => {
    try {
      if (enabled && !getAgentHomeChannel()) {
        const newChannel = createAgentHomeChannel();
        if (newChannel) {
          setAgentHomeChannel(newChannel);
          wireAgentHomeChannelHandlers(deps);
          await newChannel.start();
          console.log('[Main] Agent Home channel started');
        }
      } else if (!enabled && getAgentHomeChannel()) {
        const channel = getAgentHomeChannel();
        await channel?.stop();
        destroyAgentHomeChannel();
        setAgentHomeChannel(null);
        console.log('[Main] Agent Home channel stopped');
      }
      return { success: true };
    } catch (error) {
      console.error('[Main] Agent Home toggle error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle('agentHome:status', async () => {
    const channel = getAgentHomeChannel();
    if (!channel) return { connected: false, agentName: '' };
    return channel.getStatus();
  });
}
