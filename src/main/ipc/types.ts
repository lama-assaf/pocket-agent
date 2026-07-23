import type { MemoryManager } from '../../memory';
import type { CronScheduler } from '../../scheduler';
import type { TelegramBot } from '../../channels/telegram';

/**
 * Dependency container passed to each IPC module.
 *
 * Uses getter functions because the underlying globals are mutable
 * and may be null initially (e.g. before agent initialization).
 */
export interface IPCDependencies {
  getMemory: () => MemoryManager | null;
  getScheduler: () => CronScheduler | null;
  getTelegramBot: () => TelegramBot | null;
  setTelegramBot: (bot: TelegramBot | null) => void;

  // Helper functions
  updateTrayMenu: () => void;
  initializeAgent: () => Promise<void>;
  restartAgent: () => Promise<void>;
  /**
   * True when a debounced live-sync auto-push is queued (not yet fired) for
   * a client id's repo dir. Backed by the module-level DebouncedPusher in
   * src/main/index.ts; used by sync:status (settings-ipc.ts) to surface a
   * "changes pending" indicator in the Brain panel's sync bar.
   */
  isLiveSyncPushPending: (clientId: string) => boolean;
  openChatWindow: () => void;
  openSettingsWindow: (tab?: string) => void;
  openCronWindow: () => void;
  openCustomizeWindow: () => void;
  openFactsWindow: () => void;
  openDailyLogsWindow: () => void;
  openSoulWindow: () => void;

  /** Window ID constants */
  WIN: {
    readonly CHAT: string;
    readonly CRON: string;
    readonly SETTINGS: string;
    readonly CUSTOMIZE: string;
    readonly FACTS: string;
    readonly DAILY_LOGS: string;
    readonly SOUL: string;
  };
}
