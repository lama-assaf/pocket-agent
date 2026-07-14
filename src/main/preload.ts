import { contextBridge, ipcRenderer } from 'electron';

// Expose API to renderer process — organized by domain
contextBridge.exposeInMainWorld('pocketAgent', {
  // ─── Agent ───────────────────────────────────────────────────────────
  agent: {
    send: (
      message: string,
      sessionId?: string,
      images?: Array<{ type: 'base64'; mediaType: string; data: string }>
    ) => ipcRenderer.invoke('agent:send', message, sessionId, images),
    stop: (sessionId?: string) => ipcRenderer.invoke('agent:stop', sessionId),
    setMode: (mode: string) => ipcRenderer.invoke('agent:setMode', mode),
    getMode: () => ipcRenderer.invoke('agent:getMode'),
    getSessionMode: (sessionId: string) => ipcRenderer.invoke('agent:getSessionMode', sessionId),
    setSessionMode: (sessionId: string, mode: string) =>
      ipcRenderer.invoke('agent:setSessionMode', sessionId, mode),
    onModeChanged: (callback: (mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, mode: string) => callback(mode);
      ipcRenderer.on('agent:modeChanged', listener);
      return () => ipcRenderer.removeListener('agent:modeChanged', listener);
    },
    onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string, mode: string) =>
        callback(sessionId, mode);
      ipcRenderer.on('agent:sessionModeChanged', listener);
      return () => ipcRenderer.removeListener('agent:sessionModeChanged', listener);
    },
    onStatus: (
      callback: (status: {
        type: string;
        toolName?: string;
        toolInput?: string;
        message?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { type: string; toolName?: string; toolInput?: string; message?: string }
      ) => callback(status);
      ipcRenderer.on('agent:status', listener);
      return () => ipcRenderer.removeListener('agent:status', listener);
    },
    getHistory: (limit?: number, sessionId?: string) =>
      ipcRenderer.invoke('agent:history', limit, sessionId),
    getStats: (sessionId?: string) => ipcRenderer.invoke('agent:stats', sessionId),
    clearConversation: (sessionId?: string) => ipcRenderer.invoke('agent:clear', sessionId),
    readMedia: (filePath: string) => ipcRenderer.invoke('agent:readMedia', filePath),
    restart: () => ipcRenderer.invoke('agent:restart'),
  },

  // ─── Attachments ─────────────────────────────────────────────────────
  attachments: {
    save: (name: string, dataUrl: string) => ipcRenderer.invoke('attachment:save', name, dataUrl),
    extractText: (filePath: string) => ipcRenderer.invoke('attachment:extract-text', filePath),
  },

  // ─── Sessions ────────────────────────────────────────────────────────
  clients: {
    list: () => ipcRenderer.invoke('clients:list'),
    create: (input: {
      id: string;
      name: string;
      syncMode?: 'live' | 'manual';
      repoUrl?: string | null;
    }) => ipcRenderer.invoke('clients:create', input),
    getSetupString: (id: string) => ipcRenderer.invoke('clients:getSetupString', id),
    previewSetupString: (raw: string) => ipcRenderer.invoke('clients:previewSetupString', raw),
    join: (raw: string) => ipcRenderer.invoke('clients:join', raw),
  },
  projects: {
    list: (clientId: string) => ipcRenderer.invoke('projects:list', clientId),
    create: (input: {
      id: string;
      clientId: string;
      name: string;
      workingDirectory?: string | null;
    }) => ipcRenderer.invoke('projects:create', input),
    update: (id: string, fields: { name?: string; workingDirectory?: string | null }) =>
      ipcRenderer.invoke('projects:update', id, fields),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
  },
  sync: {
    pull: (scope: string) => ipcRenderer.invoke('sync:pull', scope),
    pullAll: () => ipcRenderer.invoke('sync:pullAll'),
    publish: (scope: string, message?: string) =>
      ipcRenderer.invoke('sync:publish', scope, message),
    status: (scope: string) => ipcRenderer.invoke('sync:status', scope),
    setClientMode: (id: string, mode: 'live' | 'manual') =>
      ipcRenderer.invoke('sync:setClientMode', id, mode),
  },
  sessions: {
    list: () => ipcRenderer.invoke('sessions:list'),
    create: (name: string) => ipcRenderer.invoke('sessions:create', name),
    rename: (id: string, name: string) => ipcRenderer.invoke('sessions:rename', id, name),
    delete: (id: string) => ipcRenderer.invoke('sessions:delete', id),
    setPulseEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('sessions:setPulseEnabled', id, enabled),
    getContext: (id: string) => ipcRenderer.invoke('sessions:getContext', id),
    setContext: (
      id: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('sessions:setContext', id, context),
    onChanged: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('sessions:changed', listener);
      return () => ipcRenderer.removeListener('sessions:changed', listener);
    },
    onCleared: (callback: (sessionId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, sessionId: string) =>
        callback(sessionId);
      ipcRenderer.on('session:cleared', listener);
      return () => ipcRenderer.removeListener('session:cleared', listener);
    },
  },

  // ─── Facts ───────────────────────────────────────────────────────────
  facts: {
    list: (scope?: string) => ipcRenderer.invoke('facts:list', scope),
    search: (query: string) => ipcRenderer.invoke('facts:search', query),
    getCategories: () => ipcRenderer.invoke('facts:categories'),
    create: (input: {
      category: string;
      subject: string;
      content: string;
      sensitive?: boolean;
      scope?: string;
    }) => ipcRenderer.invoke('facts:create', input),
    delete: (id: number) => ipcRenderer.invoke('facts:delete', id),
    update: (id: number, fields: { category?: string; subject?: string; content?: string }) =>
      ipcRenderer.invoke('facts:update', id, fields),
    setSensitive: (id: number, sensitive: boolean) =>
      ipcRenderer.invoke('facts:setSensitive', id, sensitive),
    memoryUsage: (scope?: string) => ipcRenderer.invoke('facts:memoryUsage', scope),
    export: (format: 'json' | 'markdown' = 'json') => ipcRenderer.invoke('memory:export', format),
  },

  // ─── Soul (Self-Knowledge) ──────────────────────────────────────────
  soul: {
    listAspects: () => ipcRenderer.invoke('soul:list'),
    getAspect: (aspect: string) => ipcRenderer.invoke('soul:get', aspect),
    deleteAspect: (id: number) => ipcRenderer.invoke('soul:delete', id),
    update: (id: number, fields: { aspect?: string; content?: string }) =>
      ipcRenderer.invoke('soul:update', id, fields),
    memoryUsage: () => ipcRenderer.invoke('soul:memoryUsage'),
  },

  // ─── Daily Logs ──────────────────────────────────────────────────────
  dailyLogs: {
    list: () => ipcRenderer.invoke('dailyLogs:list'),
    delete: (id: number) => ipcRenderer.invoke('dailyLogs:delete', id),
    memoryUsage: () => ipcRenderer.invoke('dailyLogs:memoryUsage'),
  },

  // ─── Write-Audit Log (roadmap item 8) ──────────────────────────────────
  auditLog: {
    list: (limit?: number) => ipcRenderer.invoke('auditLog:list', limit),
  },

  // ─── App (Windows, Navigation, Info) ─────────────────────────────────
  app: {
    openFacts: () => ipcRenderer.invoke('app:openFacts'),
    openDailyLogs: () => ipcRenderer.invoke('app:openDailyLogs'),
    openSoul: () => ipcRenderer.invoke('app:openSoul'),
    openCustomize: () => ipcRenderer.invoke('app:openCustomize'),
    openRoutines: () => ipcRenderer.invoke('app:openRoutines'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    openPath: (filePath: string) => ipcRenderer.invoke('app:openPath', filePath),
    openImage: (src: string) => ipcRenderer.invoke('app:openImage', src),
    openSettings: (tab?: string) => ipcRenderer.invoke('app:openSettings', tab),
    openChat: () => ipcRenderer.invoke('app:openChat'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => process.platform,
    onNavigateTab: (callback: (tab: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tab: string) => callback(tab);
      ipcRenderer.on('navigate-tab', listener);
      return () => ipcRenderer.removeListener('navigate-tab', listener);
    },
    onOpenSettings: (callback: (tab?: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tab?: string) => callback(tab);
      ipcRenderer.on('open-settings', listener);
      return () => ipcRenderer.removeListener('open-settings', listener);
    },
  },

  // ─── Customize ───────────────────────────────────────────────────────
  customize: {
    getSystemPrompt: () => ipcRenderer.invoke('customize:getSystemPrompt'),
    getAgentModes: () => ipcRenderer.invoke('customize:getAgentModes'),
  },

  // ─── Marketplace (Atelier/Salon pack agents) ──────────────────────────
  marketplace: {
    listAgents: (context?: {
      contextType: 'personal' | 'world' | 'client' | 'project';
      clientId?: string | null;
      projectKey?: string | null;
    }) => ipcRenderer.invoke('marketplace:listAgents', context),
    getAgent: (
      packId: string,
      name: string,
      context?: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:getAgent', packId, name, context),
    getAgentOverride: (
      packId: string,
      name: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:getAgentOverride', packId, name, context),
    setAgentOverride: (
      packId: string,
      name: string,
      fields: { prompt?: string; tools?: string[]; model?: string },
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:setAgentOverride', packId, name, fields, context),
    clearAgentOverride: (
      packId: string,
      name: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:clearAgentOverride', packId, name, context),
    getAgentEnablement: (
      packId: string,
      name: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:getAgentEnablement', packId, name, context),
    setAgentEnablement: (
      packId: string,
      name: string,
      enabled: boolean,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:setAgentEnablement', packId, name, enabled, context),
    clearAgentEnablement: (
      packId: string,
      name: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('marketplace:clearAgentEnablement', packId, name, context),
  },

  // ─── MCP Servers (first-party + marketplace-sourced) ───────────────
  mcp: {
    listServers: (context?: {
      contextType: 'personal' | 'world' | 'client' | 'project';
      clientId?: string | null;
      projectKey?: string | null;
    }) => ipcRenderer.invoke('mcp:listServers', context),
    setServerEnabled: (id: string, enabled: boolean, confirmed?: boolean) =>
      ipcRenderer.invoke('mcp:setServerEnabled', id, enabled, confirmed),
    setServerEnv: (id: string, env: Record<string, string>) =>
      ipcRenderer.invoke('mcp:setServerEnv', id, env),
    getServerScopeEnablement: (
      id: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('mcp:getServerScopeEnablement', id, context),
    setServerScopeEnablement: (
      id: string,
      enabled: boolean,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('mcp:setServerScopeEnablement', id, enabled, context),
    clearServerScopeEnablement: (
      id: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('mcp:clearServerScopeEnablement', id, context),
    reauthenticateServer: (id: string) => ipcRenderer.invoke('mcp:reauthenticateServer', id),
  },

  // ─── Content Workflow (roadmap item 6) ────────────────────────
  content: {
    list: (
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      },
      status?: string
    ) => ipcRenderer.invoke('content:list', context, status),
    get: (id: number) => ipcRenderer.invoke('content:get', id),
    history: (
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      },
      draftId?: number
    ) => ipcRenderer.invoke('content:history', context, draftId),
    create: (
      input: { channel: string; title?: string; body: string },
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('content:create', input, context),
    approve: (id: number) => ipcRenderer.invoke('content:approve', id),
    reject: (id: number) => ipcRenderer.invoke('content:reject', id),
    postNow: (
      id: number,
      context?: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('content:postNow', id, context),
    schedule: (id: number, scheduledFor: string) =>
      ipcRenderer.invoke('content:schedule', id, scheduledFor),
    delete: (id: number) => ipcRenderer.invoke('content:delete', id),
    update: (id: number, fields: { channel?: string; title?: string; body?: string }) =>
      ipcRenderer.invoke('content:update', id, fields),
  },

  // ─── Campaigns / Plans (roadmap item 10) ──────────────────
  campaigns: {
    list: (
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      },
      status?: string
    ) => ipcRenderer.invoke('campaigns:list', context, status),
    get: (id: number) => ipcRenderer.invoke('campaigns:get', id),
    create: (
      input: { name: string; brief?: string },
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('campaigns:create', input, context),
    update: (id: number, fields: { name?: string; brief?: string; status?: string }) =>
      ipcRenderer.invoke('campaigns:update', id, fields),
    delete: (id: number) => ipcRenderer.invoke('campaigns:delete', id),
    addDeliverable: (input: {
      campaignId: number;
      title: string;
      description?: string;
      lane?: string | null;
      assignedSpecialist?: string | null;
      dependsOn?: number | null;
    }) => ipcRenderer.invoke('campaigns:addDeliverable', input),
    setDeliverableStatus: (id: number, status: string, resultRef?: string) =>
      ipcRenderer.invoke('campaigns:setDeliverableStatus', id, status, resultRef),
    deleteDeliverable: (id: number) => ipcRenderer.invoke('campaigns:deleteDeliverable', id),
    nudgePrompt: (campaignId: number) => ipcRenderer.invoke('campaigns:nudgePrompt', campaignId),
    analytics: (campaignId: number) => ipcRenderer.invoke('campaigns:analytics', campaignId),
  },

  // ─── Analytics (X/LinkedIn/etc. post performance) ───
  analytics: {
    list: (
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      },
      channel?: string
    ) => ipcRenderer.invoke('analytics:list', context, channel),
    history: (scope: string, channel: string, externalRef: string) =>
      ipcRenderer.invoke('analytics:history', scope, channel, externalRef),
    summary: (
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      },
      channel?: string
    ) => ipcRenderer.invoke('analytics:summary', context, channel),
    record: (
      input: {
        channel: string;
        externalRef: string;
        contentPostId?: number | null;
        title?: string;
        impressions?: number;
        likes?: number;
        comments?: number;
        shares?: number;
        clicks?: number;
        videoViews?: number;
        source?: 'manual' | 'mcp';
        rawJson?: string | null;
        capturedAt?: string;
      },
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('analytics:record', input, context),
    delete: (id: number) => ipcRenderer.invoke('analytics:delete', id),
  },

  // ─── LinkedIn (Community Management API — org post analytics) ───
  linkedin: {
    startOAuth: () => ipcRenderer.invoke('linkedin:startOAuth'),
    cancelOAuth: () => ipcRenderer.invoke('linkedin:cancelOAuth'),
    isOAuthPending: () => ipcRenderer.invoke('linkedin:isOAuthPending'),
    logout: () => ipcRenderer.invoke('linkedin:logout'),
    getAuthStatus: () => ipcRenderer.invoke('linkedin:getAuthStatus'),
    getRedirectUri: () => ipcRenderer.invoke('linkedin:getRedirectUri'),
    getOrgUrn: (context: {
      contextType: 'personal' | 'world' | 'client' | 'project';
      clientId?: string | null;
      projectKey?: string | null;
    }) => ipcRenderer.invoke('linkedin:getOrgUrn', context),
    setOrgUrn: (
      orgUrn: string,
      context: {
        contextType: 'personal' | 'world' | 'client' | 'project';
        clientId?: string | null;
        projectKey?: string | null;
      }
    ) => ipcRenderer.invoke('linkedin:setOrgUrn', orgUrn, context),
    syncNow: (context: {
      contextType: 'personal' | 'world' | 'client' | 'project';
      clientId?: string | null;
      projectKey?: string | null;
    }) => ipcRenderer.invoke('linkedin:syncNow', context),
  },

  // ─── Location & Timezone ───────────────────────────
  location: {
    lookup: (query: string) => ipcRenderer.invoke('location:lookup', query),
    getTimezones: () => ipcRenderer.invoke('timezone:list'),
  },

  // ─── Cron / Routines ────────────────────────────────────────────────
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    create: (name: string, schedule: string, prompt: string, channel: string, sessionId: string) =>
      ipcRenderer.invoke('cron:create', name, schedule, prompt, channel, sessionId),
    delete: (name: string) => ipcRenderer.invoke('cron:delete', name),
    toggle: (name: string, enabled: boolean) => ipcRenderer.invoke('cron:toggle', name, enabled),
    run: (name: string) => ipcRenderer.invoke('cron:run', name),
    getHistory: (limit?: number) => ipcRenderer.invoke('cron:history', limit),
  },

  // ─── Settings ────────────────────────────────────────────────────────
  settings: {
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('settings:delete', key),
    getSchema: (category?: string) => ipcRenderer.invoke('settings:schema', category),
    isFirstRun: () => ipcRenderer.invoke('settings:isFirstRun'),
    resetOnboarding: () => ipcRenderer.invoke('settings:resetOnboarding'),
    initializeKeychain: () => ipcRenderer.invoke('settings:initializeKeychain'),
    getAvailableModels: () => ipcRenderer.invoke('settings:getAvailableModels'),
  },

  // ─── Validation ──────────────────────────────────────────────────────
  validate: {
    anthropicKey: (key: string) => ipcRenderer.invoke('settings:validateAnthropic', key),
    openAIKey: (key: string) => ipcRenderer.invoke('settings:validateOpenAI', key),
    moonshotKey: (key: string) => ipcRenderer.invoke('settings:validateMoonshot', key),
    glmKey: (key: string) => ipcRenderer.invoke('settings:validateGlm', key),
    xiaomiKey: (key: string) => ipcRenderer.invoke('settings:validateXiaomi', key),
    minimaxKey: (key: string) => ipcRenderer.invoke('settings:validateMiniMax', key),
    deepseekKey: (key: string) => ipcRenderer.invoke('settings:validateDeepSeek', key),
    telegramToken: (token: string) => ipcRenderer.invoke('settings:validateTelegram', token),
    storedKey: (provider: string) => ipcRenderer.invoke('settings:validateStoredKey', provider),
  },

  // ─── Auth (OAuth) ───────────────────────────────────────────────────
  auth: {
    startOAuth: () => ipcRenderer.invoke('auth:startOAuth'),
    completeOAuth: (code: string) => ipcRenderer.invoke('auth:completeOAuth', code),
    cancelOAuth: () => ipcRenderer.invoke('auth:cancelOAuth'),
    isOAuthPending: () => ipcRenderer.invoke('auth:isOAuthPending'),
    validateOAuth: () => ipcRenderer.invoke('auth:validateOAuth'),
    onExpired: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('auth:expired', listener);
      return () => ipcRenderer.removeListener('auth:expired', listener);
    },
  },

  // ─── OpenAI OAuth ──────────────────────────────────────────────────
  openaiAuth: {
    startOAuth: () => ipcRenderer.invoke('openai:startOAuth'),
    completeOAuth: () => ipcRenderer.invoke('openai:completeOAuth'),
    validateOAuth: () => ipcRenderer.invoke('openai:validateOAuth'),
    logoutOAuth: () => ipcRenderer.invoke('openai:logoutOAuth'),
  },

  // ─── Kimi (Moonshot) OAuth ──────────────────────────────────────────
  kimiAuth: {
    startOAuth: () => ipcRenderer.invoke('kimi:startOAuth'),
    isOAuthPending: () => ipcRenderer.invoke('kimi:isOAuthPending'),
    cancelOAuth: () => ipcRenderer.invoke('kimi:cancelOAuth'),
    validateOAuth: () => ipcRenderer.invoke('kimi:validateOAuth'),
    logoutOAuth: () => ipcRenderer.invoke('kimi:logoutOAuth'),
  },

  // ─── Themes ──────────────────────────────────────────────────────────
  themes: {
    list: () => ipcRenderer.invoke('settings:getThemes'),
    getSkin: () => ipcRenderer.invoke('settings:getSkin'),
    onSkinChanged: (callback: (skinId: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, skinId: string) => callback(skinId);
      ipcRenderer.on('skin:changed', listener);
      return () => ipcRenderer.removeListener('skin:changed', listener);
    },
  },

  // ─── Chat Events ────────────────────────────────────────────────────
  chat: {
    onUsernameChanged: (callback: (username: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, username: string) => callback(username);
      ipcRenderer.on('chat:usernameChanged', listener);
      return () => ipcRenderer.removeListener('chat:usernameChanged', listener);
    },
  },

  // ─── Commands (Workflows) ───────────────────────────────────────────
  commands: {
    list: (sessionId?: string) => ipcRenderer.invoke('commands:list', sessionId),
  },

  // ─── Updater ─────────────────────────────────────────────────────────
  updater: {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    download: () => ipcRenderer.invoke('updater:downloadUpdate'),
    install: () => ipcRenderer.invoke('updater:installUpdate'),
    getStatus: () => ipcRenderer.invoke('updater:getStatus'),
    onStatus: (
      callback: (status: {
        status: string;
        info?: unknown;
        progress?: { percent: number };
        error?: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: { status: string; info?: unknown; progress?: { percent: number }; error?: string }
      ) => callback(status);
      ipcRenderer.on('updater:status', listener);
      return () => ipcRenderer.removeListener('updater:status', listener);
    },
  },

  // ─── Browser Control ────────────────────────────────────────────────
  browser: {
    detectInstalled: () => ipcRenderer.invoke('browser:detectInstalled'),
    launch: (browserId: string, port?: number) =>
      ipcRenderer.invoke('browser:launch', browserId, port),
    testConnection: (cdpUrl?: string) => ipcRenderer.invoke('browser:testConnection', cdpUrl),
  },

  // ─── Shell ───────────────────────────────────────────────────────────
  shell: {
    runCommand: (command: string) => ipcRenderer.invoke('shell:runCommand', command),
  },

  // ─── Permissions (macOS) ─────────────────────────────────────────────
  permissions: {
    isMacOS: () => ipcRenderer.invoke('permissions:isMacOS'),
    check: (types: string[]) => ipcRenderer.invoke('permissions:checkStatus', types),
    openSettings: (type: string) => ipcRenderer.invoke('permissions:openSettings', type),
  },

  // ─── External Events ────────────────────────────────────────────────
  events: {
    onSchedulerMessage: (
      callback: (data: {
        jobName: string;
        prompt: string;
        response: string;
        sessionId: string;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { jobName: string; prompt: string; response: string; sessionId: string }
      ) => callback(data);
      ipcRenderer.on('scheduler:message', listener);
      return () => ipcRenderer.removeListener('scheduler:message', listener);
    },
    onCronTesting: (
      callback: (data: { name: string; sessionId: string }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: { name: string; sessionId: string }
      ) => callback(data);
      ipcRenderer.on('cron:testing', listener);
      return () => ipcRenderer.removeListener('cron:testing', listener);
    },
    onTelegramMessage: (
      callback: (data: {
        userMessage: string;
        response: string;
        chatId: number;
        sessionId: string;
        hasAttachment?: boolean;
        attachmentType?: 'photo' | 'voice' | 'audio';
        wasCompacted?: boolean;
        media?: Array<{ type: string; filePath: string; mimeType: string }>;
      }) => void
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: {
          userMessage: string;
          response: string;
          chatId: number;
          sessionId: string;
          hasAttachment?: boolean;
          attachmentType?: 'photo' | 'voice' | 'audio';
          wasCompacted?: boolean;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }
      ) => callback(data);
      ipcRenderer.on('telegram:message', listener);
      return () => ipcRenderer.removeListener('telegram:message', listener);
    },
    onModelChanged: (callback: (model: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, model: string) => callback(model);
      ipcRenderer.on('model:changed', listener);
      return () => ipcRenderer.removeListener('model:changed', listener);
    },
  },
});

// Session type
interface Session {
  id: string;
  name: string;
  mode?: 'general' | 'coder';
  working_directory?: string | null;
  created_at: string;
  updated_at: string;
  telegram_linked?: boolean;
  telegram_group_name?: string | null;
  context_type?: 'personal' | 'world' | 'client' | 'project';
  client_id?: string | null;
  project_key?: string | null;
}

// Selected memory context (scoped memory)
interface SessionContext {
  contextType: 'personal' | 'world' | 'client' | 'project';
  clientId: string | null;
  projectKey: string | null;
}

// Client (brand) record
interface Client {
  id: string;
  name: string;
  sync_mode: 'live' | 'manual';
  repo_url: string | null;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

// Project (sub-scope under a client) record
interface Project {
  id: string;
  client_id: string;
  name: string;
  working_directory: string | null;
  created_at: string;
  updated_at: string;
}

// Type declarations for renderer
declare global {
  interface Window {
    pocketAgent: {
      agent: {
        send: (
          message: string,
          sessionId?: string,
          images?: Array<{ type: 'base64'; mediaType: string; data: string }>
        ) => Promise<{
          success: boolean;
          response?: string;
          error?: string;
          tokensUsed?: number;
          suggestedPrompt?: string;
          media?: Array<{ type: string; filePath: string; mimeType: string }>;
        }>;
        stop: (sessionId?: string) => Promise<{ success: boolean }>;
        setMode: (mode: string) => Promise<{ success: boolean; error?: string }>;
        getMode: () => Promise<string>;
        getSessionMode: (sessionId: string) => Promise<string>;
        setSessionMode: (
          sessionId: string,
          mode: string
        ) => Promise<{ success: boolean; error?: string }>;
        onModeChanged: (callback: (mode: string) => void) => () => void;
        onSessionModeChanged: (callback: (sessionId: string, mode: string) => void) => () => void;
        onStatus: (
          callback: (status: {
            type: string;
            toolName?: string;
            toolInput?: string;
            message?: string;
          }) => void
        ) => () => void;
        getHistory: (
          limit?: number,
          sessionId?: string
        ) => Promise<
          Array<{
            role: string;
            content: string;
            timestamp: string;
            metadata?: { source?: string; jobName?: string };
          }>
        >;
        getStats: (sessionId?: string) => Promise<{
          messageCount: number;
          factCount: number;
          estimatedTokens: number;
          sessionCount?: number;
          contextTokens?: number;
          contextWindow?: number;
        } | null>;
        clearConversation: (sessionId?: string) => Promise<{ success: boolean }>;
        readMedia: (filePath: string) => Promise<string | null>;
        restart: () => Promise<{ success: boolean }>;
      };

      attachments: {
        save: (name: string, dataUrl: string) => Promise<string>;
        extractText: (filePath: string) => Promise<string>;
      };

      sessions: {
        list: () => Promise<Session[]>;
        create: (name: string) => Promise<{ success: boolean; session?: Session; error?: string }>;
        rename: (id: string, name: string) => Promise<{ success: boolean; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean }>;
        setPulseEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean }>;
        getContext: (id: string) => Promise<SessionContext>;
        setContext: (
          id: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; error?: string }>;
        onChanged: (callback: () => void) => () => void;
        onCleared: (callback: (sessionId: string) => void) => () => void;
      };

      clients: {
        list: () => Promise<Client[]>;
        create: (input: {
          id: string;
          name: string;
          syncMode?: 'live' | 'manual';
          repoUrl?: string | null;
        }) => Promise<{ success: boolean; client?: Client; error?: string }>;
        getSetupString: (
          id: string
        ) => Promise<{ success: boolean; setupString?: string; error?: string }>;
        previewSetupString: (raw: string) => Promise<{
          ok: boolean;
          payload?: { id: string; name: string; repoUrl: string; syncMode?: 'live' | 'manual' };
          error?: string;
        }>;
        join: (raw: string) => Promise<{
          success: boolean;
          client?: Client;
          pulled?: boolean;
          pullError?: string;
          error?: string;
        }>;
      };

      projects: {
        list: (clientId: string) => Promise<Project[]>;
        create: (input: {
          id: string;
          clientId: string;
          name: string;
          workingDirectory?: string | null;
        }) => Promise<{ success: boolean; project?: Project; error?: string }>;
        update: (
          id: string,
          fields: { name?: string; workingDirectory?: string | null }
        ) => Promise<{ success: boolean; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean }>;
      };

      sync: {
        pull: (
          scope: string
        ) => Promise<{ ok: boolean; cloned?: boolean; merged?: boolean; error?: string }>;
        pullAll: () => Promise<
          Array<{ id: string; name: string; ok: boolean; cloned?: boolean; merged?: boolean; error?: string }>
        >;
        publish: (
          scope: string,
          message?: string
        ) => Promise<{ ok: boolean; committed?: boolean; pushed?: boolean; error?: string }>;
        status: (scope: string) => Promise<{
          configured: boolean;
          cloned: boolean;
          lastPulledAt?: string | null;
          lastPushedAt?: string | null;
          freshness?: 'unconfigured' | 'never_pulled' | 'fresh' | 'stale';
          msSincePull?: number | null;
        }>;
        setClientMode: (id: string, mode: 'live' | 'manual') => Promise<{ success: boolean }>;
      };

      facts: {
        list: (
          scope?: string
        ) => Promise<
          Array<{ id: number; category: string; subject: string; content: string; scope?: string }>
        >;
        search: (
          query: string
        ) => Promise<Array<{ category: string; subject: string; content: string }>>;
        getCategories: () => Promise<string[]>;
        create: (input: {
          category: string;
          subject: string;
          content: string;
          sensitive?: boolean;
          scope?: string;
        }) => Promise<{
          success: boolean;
          fact?: {
            id: number;
            category: string;
            subject: string;
            content: string;
            scope: string;
          } | null;
          error?: string;
        }>;
        delete: (id: number) => Promise<{ success: boolean }>;
        update: (
          id: number,
          fields: { category?: string; subject?: string; content?: string }
        ) => Promise<{ success: boolean }>;
        setSensitive: (id: number, sensitive: boolean) => Promise<{ success: boolean }>;
        memoryUsage: (
          scope?: string
        ) => Promise<{ usedChars: number; budgetChars: number; pct: number }>;
        export: (format?: 'json' | 'markdown') => Promise<unknown>;
      };

      soul: {
        listAspects: () => Promise<
          Array<{
            id: number;
            aspect: string;
            content: string;
            created_at: string;
            updated_at: string;
          }>
        >;
        getAspect: (aspect: string) => Promise<{
          id: number;
          aspect: string;
          content: string;
          created_at: string;
          updated_at: string;
        } | null>;
        deleteAspect: (id: number) => Promise<{ success: boolean }>;
        update: (
          id: number,
          fields: { aspect?: string; content?: string }
        ) => Promise<{ success: boolean }>;
        memoryUsage: () => Promise<{ usedChars: number; budgetChars: number; pct: number }>;
      };

      dailyLogs: {
        list: () => Promise<
          Array<{ id: number; date: string; content: string; updated_at: string }>
        >;
        delete: (id: number) => Promise<{ success: boolean }>;
        memoryUsage: () => Promise<{ usedChars: number; budgetChars: number; pct: number }>;
      };

      auditLog: {
        list: (limit?: number) => Promise<
          Array<{
            ts: string;
            sessionId: string;
            scope: string | null;
            tool: 'write' | 'edit' | 'saveFact' | 'updateFact';
            target: string;
            digest: string;
          }>
        >;
      };

      app: {
        openFacts: () => Promise<void>;
        openDailyLogs: () => Promise<void>;
        openSoul: () => Promise<void>;
        openCustomize: () => Promise<void>;
        openRoutines: () => Promise<void>;
        openExternal: (url: string) => Promise<void>;
        openPath: (filePath: string) => Promise<void>;
        openImage: (src: string) => Promise<void>;
        openSettings: (tab?: string) => Promise<void>;
        openChat: () => Promise<void>;
        getVersion: () => Promise<string>;
        getPlatform: () => string;
        onNavigateTab: (callback: (tab: string) => void) => () => void;
        onOpenSettings: (callback: (tab?: string) => void) => () => void;
      };

      customize: {
        getSystemPrompt: () => Promise<string>;
        getAgentModes: () => Promise<
          Array<{
            id: string;
            name: string;
            icon: string;
            systemPrompt: string;
            description: string;
          }>
        >;
      };

      marketplace: {
        listAgents: (context?: {
          contextType: 'personal' | 'world' | 'client' | 'project';
          clientId?: string | null;
          projectKey?: string | null;
        }) => Promise<
          Array<{
            packId: string;
            packName: string;
            lane: string;
            name: string;
            description: string;
            tools: string[];
            model?: string;
            hasOverride: boolean;
            enabled: boolean;
            enablementScope: string;
          }>
        >;
        getAgent: (
          packId: string,
          name: string,
          context?: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{
          packId: string;
          packName: string;
          lane: string;
          name: string;
          description: string;
          tools: string[];
          model?: string;
          hasOverride: boolean;
          enabled: boolean;
          enablementScope: string;
          prompt: string;
          basePrompt: string;
          overrideScope?: string;
        } | null>;
        getAgentOverride: (
          packId: string,
          name: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{
          scope: string;
          fields: { prompt?: string; tools?: string[]; model?: string };
        } | null>;
        setAgentOverride: (
          packId: string,
          name: string,
          fields: { prompt?: string; tools?: string[]; model?: string },
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope?: string; error?: string }>;
        clearAgentOverride: (
          packId: string,
          name: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope: string }>;
        getAgentEnablement: (
          packId: string,
          name: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ scope: string; enabled: boolean } | null>;
        setAgentEnablement: (
          packId: string,
          name: string,
          enabled: boolean,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope?: string; error?: string }>;
        clearAgentEnablement: (
          packId: string,
          name: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope: string }>;
      };

      mcp: {
        listServers: (context?: {
          contextType: 'personal' | 'world' | 'client' | 'project';
          clientId?: string | null;
          projectKey?: string | null;
        }) => Promise<
          Array<{
            id: string;
            source: string;
            kind: 'stdio' | 'url';
            name: string;
            description?: string;
            requiredEnv: string[];
            configured: boolean;
            enabled: boolean;
            toggleable: boolean;
            riskNote?: string;
            scopeEnabled: boolean;
            scopeEnablementScope: string;
            runtimeStatus: 'not_started' | 'starting' | 'running' | 'failed';
            runtimeError?: string;
            reauthenticable: boolean;
          }>
        >;
        setServerEnabled: (
          id: string,
          enabled: boolean,
          confirmed?: boolean
        ) => Promise<{ success: boolean; error?: string; riskNote?: string }>;
        setServerEnv: (
          id: string,
          env: Record<string, string>
        ) => Promise<{ success: boolean; error?: string; autoEnabled?: boolean }>;
        getServerScopeEnablement: (
          id: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ scope: string; enabled: boolean } | null>;
        setServerScopeEnablement: (
          id: string,
          enabled: boolean,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope?: string; error?: string }>;
        clearServerScopeEnablement: (
          id: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; scope: string }>;
        reauthenticateServer: (
          id: string
        ) => Promise<{ success: boolean; cleared: boolean; message: string }>;
      };

      content: {
        list: (
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          },
          status?: string
        ) => Promise<
          Array<{
            id: number;
            scope: string;
            session_id: string | null;
            channel: string;
            title: string;
            body: string;
            status: string;
            scheduled_for: string | null;
            posted_at: string | null;
            external_ref: string | null;
            cron_job_id: number | null;
            created_at: string;
            updated_at: string;
          }>
        >;
        get: (id: number) => Promise<{
          id: number;
          scope: string;
          session_id: string | null;
          channel: string;
          title: string;
          body: string;
          status: string;
          scheduled_for: string | null;
          posted_at: string | null;
          external_ref: string | null;
          cron_job_id: number | null;
          created_at: string;
          updated_at: string;
        } | null>;
        history: (
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          },
          draftId?: number
        ) => Promise<
          Array<{
            id: number;
            draft_id: number;
            scope: string;
            channel: string;
            status: string;
            detail: string | null;
            external_ref: string | null;
            created_at: string;
          }>
        >;
        create: (
          input: { channel: string; title?: string; body: string },
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; id?: number; error?: string }>;
        approve: (id: number) => Promise<{ success: boolean; error?: string }>;
        reject: (id: number) => Promise<{ success: boolean; error?: string }>;
        postNow: (
          id: number,
          context?: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{
          success: boolean;
          status?: string;
          dryRun?: boolean;
          detail?: string;
          error?: string;
        }>;
        schedule: (
          id: number,
          scheduledFor: string
        ) => Promise<{ success: boolean; scheduledFor?: string; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean }>;
        update: (
          id: number,
          fields: { channel?: string; title?: string; body?: string }
        ) => Promise<{ success: boolean; error?: string }>;
      };

      campaigns: {
        list: (
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          },
          status?: string
        ) => Promise<
          Array<{
            id: number;
            scope: string;
            name: string;
            brief: string;
            status: string;
            created_at: string;
            updated_at: string;
          }>
        >;
        get: (id: number) => Promise<{
          campaign: {
            id: number;
            scope: string;
            name: string;
            brief: string;
            status: string;
            created_at: string;
            updated_at: string;
          };
          deliverables: Array<{
            id: number;
            campaign_id: number;
            lane: string | null;
            title: string;
            description: string;
            status: string;
            assigned_specialist: string | null;
            depends_on: number | null;
            result_ref: string | null;
            created_at: string;
            updated_at: string;
          }>;
        } | null>;
        create: (
          input: { name: string; brief?: string },
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; id?: number; error?: string }>;
        update: (
          id: number,
          fields: { name?: string; brief?: string; status?: string }
        ) => Promise<{ success: boolean }>;
        delete: (id: number) => Promise<{ success: boolean }>;
        addDeliverable: (input: {
          campaignId: number;
          title: string;
          description?: string;
          lane?: string | null;
          assignedSpecialist?: string | null;
          dependsOn?: number | null;
        }) => Promise<{ success: boolean; id?: number; error?: string }>;
        setDeliverableStatus: (
          id: number,
          status: string,
          resultRef?: string
        ) => Promise<{ success: boolean; error?: string }>;
        deleteDeliverable: (id: number) => Promise<{ success: boolean }>;
        nudgePrompt: (
          campaignId: number
        ) => Promise<{ success: boolean; prompt?: string; error?: string }>;
        analytics: (campaignId: number) => Promise<{
          summary: {
            totalPosts: number;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            clicks: number;
            videoViews: number;
            engagementRate: number;
            byChannel: Record<
              string,
              {
                posts: number;
                impressions: number;
                likes: number;
                comments: number;
                shares: number;
                clicks: number;
                videoViews: number;
                engagementRate: number;
              }
            >;
            topPosts: Array<{
              id: number;
              scope: string;
              channel: string;
              external_ref: string;
              title: string;
              impressions: number;
              likes: number;
              comments: number;
              shares: number;
              clicks: number;
              video_views: number;
              captured_at: string;
            }>;
          };
          posts: Array<{
            id: number;
            scope: string;
            channel: string;
            external_ref: string;
            content_post_id: number | null;
            title: string;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            clicks: number;
            video_views: number;
            source: 'manual' | 'mcp';
            raw_json: string | null;
            captured_at: string;
            created_at: string;
          }>;
        }>;
      };

      analytics: {
        list: (
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          },
          channel?: string
        ) => Promise<
          Array<{
            id: number;
            scope: string;
            channel: string;
            external_ref: string;
            content_post_id: number | null;
            title: string;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            clicks: number;
            video_views: number;
            source: 'manual' | 'mcp';
            raw_json: string | null;
            captured_at: string;
            created_at: string;
          }>
        >;
        history: (
          scope: string,
          channel: string,
          externalRef: string
        ) => Promise<
          Array<{
            id: number;
            scope: string;
            channel: string;
            external_ref: string;
            content_post_id: number | null;
            title: string;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            clicks: number;
            video_views: number;
            source: 'manual' | 'mcp';
            raw_json: string | null;
            captured_at: string;
            created_at: string;
          }>
        >;
        summary: (
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          },
          channel?: string
        ) => Promise<{
          totalPosts: number;
          impressions: number;
          likes: number;
          comments: number;
          shares: number;
          clicks: number;
          videoViews: number;
          engagementRate: number;
          byChannel: Record<
            string,
            {
              posts: number;
              impressions: number;
              likes: number;
              comments: number;
              shares: number;
              clicks: number;
              videoViews: number;
              engagementRate: number;
            }
          >;
          topPosts: Array<{
            id: number;
            scope: string;
            channel: string;
            external_ref: string;
            title: string;
            impressions: number;
            likes: number;
            comments: number;
            shares: number;
            clicks: number;
            video_views: number;
            captured_at: string;
          }>;
        }>;
        record: (
          input: {
            channel: string;
            externalRef: string;
            contentPostId?: number | null;
            title?: string;
            impressions?: number;
            likes?: number;
            comments?: number;
            shares?: number;
            clicks?: number;
            videoViews?: number;
            source?: 'manual' | 'mcp';
            rawJson?: string | null;
            capturedAt?: string;
          },
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; id?: number; error?: string }>;
        delete: (id: number) => Promise<{ success: boolean }>;
      };

      linkedin: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        cancelOAuth: () => Promise<{ success: boolean }>;
        isOAuthPending: () => Promise<boolean>;
        logout: () => Promise<{ success: boolean }>;
        getAuthStatus: () => Promise<{ hasAppCredentials: boolean; connected: boolean }>;
        getRedirectUri: () => Promise<string>;
        getOrgUrn: (context: {
          contextType: 'personal' | 'world' | 'client' | 'project';
          clientId?: string | null;
          projectKey?: string | null;
        }) => Promise<string | null>;
        setOrgUrn: (
          orgUrn: string,
          context: {
            contextType: 'personal' | 'world' | 'client' | 'project';
            clientId?: string | null;
            projectKey?: string | null;
          }
        ) => Promise<{ success: boolean; error?: string }>;
        syncNow: (context: {
          contextType: 'personal' | 'world' | 'client' | 'project';
          clientId?: string | null;
          projectKey?: string | null;
        }) => Promise<{ ok: boolean; postsWritten: number; error?: string }>;
      };

      location: {
        lookup: (query: string) => Promise<
          Array<{
            city: string;
            country: string;
            province: string;
            timezone: string;
            display: string;
          }>
        >;
        getTimezones: () => Promise<string[]>;
      };

      cron: {
        list: () => Promise<
          Array<{
            id: number;
            name: string;
            schedule_type?: string;
            schedule: string | null;
            run_at?: string | null;
            interval_ms?: number | null;
            prompt: string;
            channel: string;
            enabled: boolean;
            session_id?: string | null;
            job_type?: 'routine' | 'reminder';
          }>
        >;
        create: (
          name: string,
          schedule: string,
          prompt: string,
          channel: string,
          sessionId: string
        ) => Promise<{ success: boolean }>;
        delete: (name: string) => Promise<{ success: boolean }>;
        toggle: (name: string, enabled: boolean) => Promise<{ success: boolean }>;
        run: (name: string) => Promise<{
          jobName: string;
          response: string;
          success: boolean;
          error?: string;
        } | null>;
        getHistory: (
          limit?: number
        ) => Promise<
          Array<{ jobName: string; response: string; success: boolean; timestamp: string }>
        >;
      };

      settings: {
        getAll: () => Promise<Record<string, string>>;
        get: (key: string) => Promise<string>;
        set: (key: string, value: string) => Promise<{ success: boolean }>;
        delete: (key: string) => Promise<{ success: boolean }>;
        getSchema: (category?: string) => Promise<
          Array<{
            key: string;
            defaultValue: string;
            encrypted: boolean;
            category: string;
            label: string;
            description?: string;
            type: string;
          }>
        >;
        isFirstRun: () => Promise<boolean>;
        resetOnboarding: () => Promise<{ success: boolean }>;
        initializeKeychain: () => Promise<{ available: boolean; error?: string }>;
        getAvailableModels: () => Promise<Array<{ id: string; name: string; provider: string }>>;
      };

      validate: {
        anthropicKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        openAIKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        moonshotKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        glmKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        deepseekKey: (key: string) => Promise<{ valid: boolean; error?: string }>;
        telegramToken: (
          token: string
        ) => Promise<{ valid: boolean; error?: string; botInfo?: unknown }>;
        storedKey: (provider: string) => Promise<{ valid: boolean; error?: string }>;
      };

      auth: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        completeOAuth: (code: string) => Promise<{ success: boolean; error?: string }>;
        cancelOAuth: () => Promise<{ success: boolean }>;
        isOAuthPending: () => Promise<boolean>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
        onExpired: (callback: () => void) => () => void;
      };

      openaiAuth: {
        startOAuth: () => Promise<{ success: boolean; error?: string }>;
        completeOAuth: () => Promise<{ success: boolean; error?: string }>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
        logoutOAuth: () => Promise<{ success: boolean }>;
      };

      kimiAuth: {
        startOAuth: () => Promise<{
          success: boolean;
          userCode?: string;
          verificationUri?: string;
          error?: string;
        }>;
        isOAuthPending: () => Promise<boolean>;
        cancelOAuth: () => Promise<{ success: boolean }>;
        validateOAuth: () => Promise<{ valid: boolean; error?: string }>;
        logoutOAuth: () => Promise<{ success: boolean }>;
      };

      themes: {
        list: () => Promise<
          Record<string, { id: string; name: string; palette: Record<string, string> | null }>
        >;
        getSkin: () => Promise<string>;
        onSkinChanged: (callback: (skinId: string) => void) => () => void;
      };

      chat: {
        onUsernameChanged: (callback: (username: string) => void) => () => void;
      };

      commands: {
        list: (
          sessionId?: string
        ) => Promise<
          Array<{ name: string; description: string; filename: string; content: string }>
        >;
      };

      updater: {
        checkForUpdates: () => Promise<{
          status: string;
          info?: { version: string };
          error?: string;
        }>;
        download: () => Promise<{ success: boolean; error?: string }>;
        install: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{
          status: string;
          info?: { version: string };
          progress?: { percent: number };
          error?: string;
        }>;
        onStatus: (
          callback: (status: {
            status: string;
            info?: { version: string };
            progress?: { percent: number };
            error?: string;
          }) => void
        ) => () => void;
      };

      browser: {
        detectInstalled: () => Promise<
          Array<{
            id: string;
            name: string;
            path: string;
            processName: string;
            installed: boolean;
          }>
        >;
        launch: (
          browserId: string,
          port?: number
        ) => Promise<{ success: boolean; error?: string; alreadyRunning?: boolean }>;
        testConnection: (
          cdpUrl?: string
        ) => Promise<{ connected: boolean; error?: string; browserInfo?: unknown }>;
      };

      shell: {
        runCommand: (command: string) => Promise<string>;
      };

      permissions: {
        isMacOS: () => Promise<boolean>;
        check: (types: string[]) => Promise<
          Array<{
            type: string;
            granted: boolean;
            canRequest: boolean;
            label: string;
            description: string;
            settingsUrl: string;
          }>
        >;
        openSettings: (type: string) => Promise<void>;
      };

      events: {
        onSchedulerMessage: (
          callback: (data: {
            jobName: string;
            prompt: string;
            response: string;
            sessionId: string;
          }) => void
        ) => () => void;
        onTelegramMessage: (
          callback: (data: {
            userMessage: string;
            response: string;
            chatId: number;
            sessionId: string;
            hasAttachment?: boolean;
            attachmentType?: 'photo' | 'voice' | 'audio';
            wasCompacted?: boolean;
            media?: Array<{ type: string; filePath: string; mimeType: string }>;
          }) => void
        ) => () => void;
        onModelChanged: (callback: (model: string) => void) => () => void;
      };
    };
  }
}
