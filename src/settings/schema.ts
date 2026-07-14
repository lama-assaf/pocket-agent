/**
 * Settings Schema - Static setting definitions
 *
 * Defines all available settings, their defaults, types, and categories.
 */

import { getDefaultModelFor } from '../agent/model-catalog';

export interface Setting {
  key: string;
  value: string;
  encrypted: boolean;
  category: string;
  updated_at: string;
}

export interface SettingDefinition {
  key: string;
  defaultValue: string;
  encrypted: boolean;
  category: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'boolean' | 'password' | 'array' | 'textarea';
  validation?: (value: string) => boolean;
}

// Default settings schema
export const SETTINGS_SCHEMA: SettingDefinition[] = [
  // Auth settings
  {
    key: 'auth.method',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Authentication Method',
    description: 'How you authenticate with Claude (api_key or oauth)',
    type: 'string',
  },
  {
    key: 'auth.oauthToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OAuth Token',
    description: 'OAuth access token for Claude subscription',
    type: 'password',
  },
  {
    key: 'auth.refreshToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'Refresh Token',
    description: 'OAuth refresh token',
    type: 'password',
  },
  {
    key: 'auth.tokenExpiresAt',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Token Expiry',
    description: 'When the OAuth token expires',
    type: 'string',
  },

  // API Keys
  {
    key: 'anthropic.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Anthropic API Key',
    description: 'Your Anthropic API key for Claude',
    type: 'password',
  },
  {
    key: 'openai.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'OpenAI API Key',
    description: 'Your OpenAI API key for embeddings and image generation',
    type: 'password',
  },
  {
    key: 'openai.auth.method',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'OpenAI Auth Method',
    type: 'string',
  },
  {
    key: 'openai.accessToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OpenAI Access Token',
    type: 'password',
  },
  {
    key: 'openai.refreshToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OpenAI Refresh Token',
    type: 'password',
  },
  {
    key: 'openai.tokenExpiresAt',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OpenAI Token Expiry',
    type: 'string',
  },
  {
    key: 'openai.accountId',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'OpenAI Account ID',
    type: 'string',
  },
  {
    key: 'moonshot.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Moonshot/Kimi API Key',
    description: 'Your Moonshot API key for Kimi models',
    type: 'password',
  },
  {
    key: 'kimi.auth.method',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Kimi Auth Method',
    type: 'string',
  },
  {
    key: 'kimi.accessToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'Kimi Access Token',
    type: 'password',
  },
  {
    key: 'kimi.refreshToken',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'Kimi Refresh Token',
    type: 'password',
  },
  {
    key: 'kimi.tokenExpiresAt',
    defaultValue: '',
    encrypted: true,
    category: 'auth',
    label: 'Kimi Token Expiry',
    type: 'string',
  },
  {
    key: 'kimi.baseUrl',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Kimi Coding Base URL',
    type: 'string',
  },
  {
    key: 'kimi.deviceId',
    defaultValue: '',
    encrypted: false,
    category: 'auth',
    label: 'Kimi Device ID',
    type: 'string',
  },
  {
    key: 'glm.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Z.AI GLM API Key',
    description: 'Your Z.AI API key for GLM models',
    type: 'password',
  },
  {
    key: 'xiaomi.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'Xiaomi API Key',
    description: 'Your Xiaomi API key for MiMo models',
    type: 'password',
  },
  {
    key: 'minimax.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'MiniMax API Key',
    description: 'Your MiniMax API key',
    type: 'password',
  },
  {
    key: 'deepseek.apiKey',
    defaultValue: '',
    encrypted: true,
    category: 'api_keys',
    label: 'DeepSeek API Key',
    description: 'Your DeepSeek API key for V4 models',
    type: 'password',
  },

  // MCP servers (marketplace-sourced, Atelier/Salon catalogs)
  {
    key: 'mcp.marketplace.config',
    defaultValue: '{}',
    encrypted: true,
    category: 'mcp',
    label: 'Marketplace MCP Servers',
    description:
      'Enabled state and credentials for marketplace-sourced MCP servers (Atelier/Salon catalogs). One JSON blob, stored encrypted; never written to synced pack files.',
    type: 'string',
  },

  // LinkedIn (Community Management API — org post analytics via 3-legged OAuth2)
  {
    key: 'linkedin.clientId',
    defaultValue: '',
    encrypted: false,
    category: 'linkedin',
    label: 'LinkedIn Client ID',
    description: 'Client ID from your LinkedIn Developer app (developer.linkedin.com/apps).',
    type: 'string',
  },
  {
    key: 'linkedin.clientSecret',
    defaultValue: '',
    encrypted: true,
    category: 'linkedin',
    label: 'LinkedIn Client Secret',
    description: 'Client Secret from the same LinkedIn Developer app.',
    type: 'password',
  },
  {
    key: 'linkedin.accessToken',
    defaultValue: '',
    encrypted: true,
    category: 'linkedin',
    label: 'LinkedIn Access Token',
    description: 'OAuth2 access token from the member (org admin) who authorized the app.',
    type: 'password',
  },
  {
    key: 'linkedin.refreshToken',
    defaultValue: '',
    encrypted: true,
    category: 'linkedin',
    label: 'LinkedIn Refresh Token',
    description:
      'OAuth2 refresh token, when LinkedIn issues one (requires refresh-token-eligible access — see LinkedIn docs). May be absent; a missing refresh token means re-authorizing once the access token expires.',
    type: 'password',
  },
  {
    key: 'linkedin.tokenExpiresAt',
    defaultValue: '',
    encrypted: false,
    category: 'linkedin',
    label: 'LinkedIn Token Expiry',
    description: 'When the current LinkedIn access token expires (ms since epoch).',
    type: 'string',
  },

  // Scoped-memory sync (world + client brains over git)
  {
    key: 'github.token',
    defaultValue: '',
    encrypted: true,
    category: 'sync',
    label: 'GitHub Token',
    description:
      'Personal access token used to pull/push world + client memory repos (private, read-write). Stored encrypted, never synced to any repo.',
    type: 'password',
  },
  {
    key: 'sync.world.repoUrl',
    defaultValue: '',
    encrypted: false,
    category: 'sync',
    label: 'World Repo URL',
    description: 'Git URL for the shared agency (World) memory repo.',
    type: 'string',
  },
  {
    key: 'sync.world.mode',
    defaultValue: 'manual',
    encrypted: false,
    category: 'sync',
    label: 'World Sync Mode',
    description:
      'World is change-controlled canon: pull on startup, but publish only via a manual Publish (manual), or allow background push (live).',
    type: 'string',
  },

  // Agent settings
  {
    key: 'agent.model',
    defaultValue: getDefaultModelFor('anthropic'),
    encrypted: false,
    category: 'agent',
    label: 'Default Model',
    description: 'Claude model to use for conversations',
    type: 'string',
  },
  {
    key: 'agent.mode',
    defaultValue: 'coder',
    encrypted: false,
    category: 'agent',
    label: 'Agent Mode',
    description: 'General (fast chat) or Coder (full coding tools)',
    type: 'string',
  },
  {
    key: 'agent.thinkingLevel',
    defaultValue: 'none',
    encrypted: false,
    category: 'agent',
    label: 'Thinking Level',
    description: 'How much reasoning to show (none, minimal, normal, extended)',
    type: 'string',
  },

  // Memory settings
  {
    key: 'memory.autoConsolidation',
    defaultValue: 'true',
    encrypted: false,
    category: 'memory',
    label: 'Sleep-Time Consolidation',
    description: 'Nightly background job that merges/dedups facts and evolves soul aspects',
    type: 'boolean',
  },
  {
    key: 'memory.proactiveResurfacing',
    defaultValue: 'true',
    encrypted: false,
    category: 'memory',
    label: 'Proactive Memory Resurfacing',
    description: 'Occasionally volunteer a relevant past memory (max once per day)',
    type: 'boolean',
  },

  // Operator-pack tone guard (Atelier/Salon anti-AI-tone port — write-guards.ts)
  {
    key: 'features.operatorPacks',
    defaultValue: 'true',
    encrypted: false,
    category: 'features',
    label: 'Operator Pack Rules',
    description:
      'Enable marketplace lane rules and the anti-AI-tone/banned-words guard on writes',
    type: 'boolean',
  },
  {
    key: 'features.toneHardBlock',
    defaultValue: '',
    encrypted: false,
    category: 'features',
    label: 'Tone Guard Hard Block',
    description:
      "Block writes on a tone-guard hit instead of warning. Leave blank for the default " +
      '(blocks in lane modes — design/product/brand/social — warns elsewhere); set to ' +
      "'false' to opt OUT of blocking everywhere, or 'true' to opt IN to blocking everywhere.",
    type: 'string',
  },

  // Content workflow (roadmap item 6) — per-brand draft/approve/post pipeline
  {
    key: 'content.dryRun',
    defaultValue: 'true',
    encrypted: false,
    category: 'content',
    label: 'Content Posting Dry Run',
    description:
      'When on (default), posting an approved draft logs what WOULD be sent instead of calling ' +
      'a real MCP posting tool. Turn off only once posting credentials are verified working.',
    type: 'boolean',
  },

  // Pulse (proactive check-ins) settings
  {
    key: 'pulse.enabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'pulse',
    label: 'Proactive Check-ins',
    description: 'Let the agent message you first when something genuinely needs attention',
    type: 'boolean',
  },
  {
    key: 'pulse.maxPerDay',
    defaultValue: '2',
    encrypted: false,
    category: 'pulse',
    label: 'Max Check-ins Per Day',
    description: 'Global cap on proactive check-ins across all sessions',
    type: 'number',
  },
  {
    key: 'pulse.quietHoursStart',
    defaultValue: '22',
    encrypted: false,
    category: 'pulse',
    label: 'Quiet Hours Start',
    description: 'Local hour (0-23) after which no check-ins are sent',
    type: 'number',
  },
  {
    key: 'pulse.quietHoursEnd',
    defaultValue: '8',
    encrypted: false,
    category: 'pulse',
    label: 'Quiet Hours End',
    description: 'Local hour (0-23) before which no check-ins are sent',
    type: 'number',
  },
  {
    key: 'pulse.dailyBrief',
    defaultValue: 'false',
    encrypted: false,
    category: 'pulse',
    label: 'Daily Brief',
    description: "Morning summary of today's calendar, due tasks, and loose ends (opt-in)",
    type: 'boolean',
  },
  {
    key: 'pulse.briefHour',
    defaultValue: '8',
    encrypted: false,
    category: 'pulse',
    label: 'Daily Brief Hour',
    description: 'Local hour (0-23) at/after which the daily brief is sent',
    type: 'number',
  },

  // Telegram settings
  {
    key: 'telegram.botToken',
    defaultValue: '',
    encrypted: true,
    category: 'telegram',
    label: 'Bot Token',
    description: 'Telegram bot token from @BotFather',
    type: 'password',
  },
  {
    key: 'telegram.allowedUserIds',
    defaultValue: '[]',
    encrypted: false,
    category: 'telegram',
    label: 'Allowed User IDs',
    description: 'Comma-separated list of Telegram user IDs',
    type: 'array',
  },
  {
    key: 'telegram.enabled',
    defaultValue: 'false',
    encrypted: false,
    category: 'telegram',
    label: 'Enable Telegram',
    description: 'Enable Telegram bot integration',
    type: 'boolean',
  },
  {
    key: 'telegram.defaultChatId',
    defaultValue: '',
    encrypted: false,
    category: 'telegram',
    label: 'Default Chat ID',
    description: 'Default chat ID for notifications',
    type: 'string',
  },

  // Browser settings
  {
    key: 'browser.enabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'browser',
    label: 'Enable Browser',
    description: 'Enable browser automation tools',
    type: 'boolean',
  },
  {
    key: 'browser.cdpUrl',
    defaultValue: 'http://localhost:9222',
    encrypted: false,
    category: 'browser',
    label: 'CDP URL',
    description: 'Chrome DevTools Protocol URL',
    type: 'string',
  },
  {
    key: 'browser.useMyBrowser',
    defaultValue: 'false',
    encrypted: false,
    category: 'browser',
    label: 'Use My Browser',
    description: 'Always use your browser instead of headless mode',
    type: 'boolean',
  },

  // Scheduler settings
  {
    key: 'scheduler.enabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'scheduler',
    label: 'Enable Scheduler',
    description: 'Enable cron job scheduler',
    type: 'boolean',
  },

  // Notification settings
  {
    key: 'notifications.soundEnabled',
    defaultValue: 'true',
    encrypted: false,
    category: 'notifications',
    label: 'Response Sound',
    description: 'Play a sound when responses complete',
    type: 'boolean',
  },

  // Window state settings
  {
    key: 'window.chatBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Chat Window Bounds',
    description: 'Saved position and size of chat window (JSON)',
    type: 'string',
  },
  {
    key: 'window.cronBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Cron Window Bounds',
    description: 'Saved position and size of cron window (JSON)',
    type: 'string',
  },
  {
    key: 'window.settingsBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Settings Window Bounds',
    description: 'Saved position and size of settings window (JSON)',
    type: 'string',
  },
  {
    key: 'window.customizeBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Customize Window Bounds',
    description: 'Saved position and size of customize window (JSON)',
    type: 'string',
  },
  {
    key: 'window.factsBounds',
    defaultValue: '',
    encrypted: false,
    category: 'window',
    label: 'Facts Window Bounds',
    description: 'Saved position and size of facts window (JSON)',
    type: 'string',
  },
  // Appearance settings
  {
    key: 'ui.skin',
    defaultValue: 'dracula',
    encrypted: false,
    category: 'appearance',
    label: 'UI Skin',
    description:
      'Visual theme for the app (dracula, cream, light, dawn, midnight, nord, mocha, rosepine, gruvbox, solarized, onedark)',
    type: 'string',
  },

  // Chat settings
  {
    key: 'chat.username',
    defaultValue: '',
    encrypted: false,
    category: 'chat',
    label: 'Chat Username',
    description: 'Your username for global chat',
    type: 'string',
  },
  {
    key: 'chat.adminKey',
    defaultValue: '',
    encrypted: true,
    category: 'chat',
    label: 'Admin Key',
    description: 'Admin authentication key (leave blank if not admin)',
    type: 'string',
  },

  // Personalize settings (General mode identity + personality)
  {
    key: 'personalize.agentName',
    defaultValue: 'Frankie',
    encrypted: false,
    category: 'personalize',
    label: 'Agent Name',
    description: "Your agent's name",
    type: 'string',
  },
  {
    key: 'personalize.description',
    defaultValue:
      'You are a personal AI assistant who lives inside Pocket Agent. You help with whatever the user needs, remember everything, and keep things fun along the way.',
    encrypted: false,
    category: 'personalize',
    label: 'Agent Description',
    description: 'A brief description of who the agent is',
    type: 'textarea',
  },
  {
    key: 'personalize.personality',
    defaultValue: `## Vibe

Talk like texting a close friend. Chill, casual, real.

- Lowercase always (except proper nouns, acronyms, or emphasis)
- Skip periods at end of messages
- Emojis sparingly
- Direct and concise - no fluff, no corporate speak
- Joke around, be a little sarcastic, keep it fun
- If something's unclear, ask instead of guessing
- Reference past convos naturally

## Don't

- Don't be cringe or try too hard
- Don't over-explain or hedge
- Don't be fake positive
- Don't start every message the same way`,
    encrypted: false,
    category: 'personalize',
    label: 'Personality',
    description: 'How the agent acts and communicates',
    type: 'textarea',
  },
  {
    key: 'personalize.goals',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Goals',
    description: "What you're working toward",
    type: 'textarea',
  },
  {
    key: 'personalize.struggles',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Struggles',
    description: "What you're dealing with",
    type: 'textarea',
  },
  {
    key: 'personalize.funFacts',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Fun Facts',
    description: 'Interests, hobbies, people in your life',
    type: 'textarea',
  },
  {
    key: 'personalize._migrated',
    defaultValue: '',
    encrypted: false,
    category: 'personalize',
    label: 'Migration Flag',
    description: 'Internal flag for identity.md migration',
    type: 'string',
  },

  // Onboarding settings
  {
    key: 'onboarding.completed',
    defaultValue: '',
    encrypted: false,
    category: 'onboarding',
    label: 'Onboarding Completed',
    description: 'Whether the onboarding wizard has been completed',
    type: 'boolean',
  },

  // User Profile settings
  {
    key: 'profile.name',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Your Name',
    description: 'Your name for the agent to use',
    type: 'string',
  },
  {
    key: 'profile.location',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Location',
    description: 'Your city/region for context',
    type: 'string',
  },
  {
    key: 'profile.timezone',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Timezone',
    description: 'Your timezone (e.g., America/New_York)',
    type: 'string',
  },
  {
    key: 'profile.occupation',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Occupation',
    description: 'Your job or role',
    type: 'string',
  },
  {
    key: 'profile.birthday',
    defaultValue: '',
    encrypted: false,
    category: 'profile',
    label: 'Birthday',
    description: 'Your birthday (e.g., March 15)',
    type: 'string',
  },
];
