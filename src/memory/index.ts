import Database from 'better-sqlite3';
import type { AgentModeId } from '../agent/agent-modes';
import {
  type Message,
  type SmartContextOptions,
  type SmartContext,
  type SummarizerFn,
  saveMessage as _saveMessage,
  getRecentMessages as _getRecentMessages,
  getMessageCount as _getMessageCount,
  getSmartContext as _getSmartContext,
} from './messages';
import {
  type DailyLog,
  getDailyLog as _getDailyLog,
  appendToDailyLog as _appendToDailyLog,
  getDailyLogsSince as _getDailyLogsSince,
  getDailyLogsContext as _getDailyLogsContext,
  getDailyLogsMemoryUsage as _getDailyLogsMemoryUsage,
  deleteDailyLog as _deleteDailyLog,
  pruneOldDailyLogs as _pruneOldDailyLogs,
  rollUpDailyLogs as _rollUpDailyLogs,
  getRollupsForContext as _getRollupsForContext,
  getDailyLogOnThisDay as _getDailyLogOnThisDay,
  getAllRollups as _getAllRollups,
} from './daily-logs';
import type { DailyLogRollup } from './daily-logs';
import { summarizeText } from './summarizer';
import { selectResurfaceCandidate as _selectResurfaceCandidate } from './resurfacing';
import type { ResurfaceCandidate } from './resurfacing';
import {
  exportMemory as _exportMemory,
  exportMemoryMarkdown as _exportMemoryMarkdown,
} from './export';
import {
  createSoulCache,
  setSoulAspect as _setSoulAspect,
  getSoulAspect as _getSoulAspect,
  getAllSoulAspects as _getAllSoulAspects,
  deleteSoulAspect as _deleteSoulAspect,
  deleteSoulAspectById as _deleteSoulAspectById,
  getSoulContext as _getSoulContext,
  getSoulMemoryUsage as _getSoulMemoryUsage,
  updateSoulAspect as _updateSoulAspect,
} from './soul';
import type { SoulCache, SoulAspect } from './soul';
import {
  type CronJob,
  saveCronJob as _saveCronJob,
  getCronJobs as _getCronJobs,
  setCronJobEnabled as _setCronJobEnabled,
  deleteCronJob as _deleteCronJob,
  setCronJobForContentPost as _setCronJobForContentPost,
} from './cron-jobs';
import {
  type TelegramChatSession,
  linkTelegramChat as _linkTelegramChat,
  unlinkTelegramChat as _unlinkTelegramChat,
  getSessionForChat as _getSessionForChat,
  getChatForSession as _getChatForSession,
  getAllTelegramChatSessions as _getAllTelegramChatSessions,
} from './telegram-sessions';
import {
  createFactsCache,
  saveFact as _saveFact,
  getFact as _getFact,
  getAllFacts as _getAllFacts,
  getFactsForContext as _getFactsForContext,
  getFactsMemoryUsage as _getFactsMemoryUsage,
  deleteFact as _deleteFact,
  deleteFactBySubject as _deleteFactBySubject,
  searchFacts as _searchFacts,
  getFactsByCategory as _getFactsByCategory,
  getFactCategories as _getFactCategories,
  decayFactImportance as _decayFactImportance,
  updateFact as _updateFact,
  setFactSensitive as _setFactSensitive,
  promoteFact as _promoteFact,
} from './facts';
import type { FactsCache, Fact } from './facts';
import { embedText } from './embeddings';
import {
  retrieveRelevantFacts as _retrieveRelevantFacts,
  retrieveRelevantSoul as _retrieveRelevantSoul,
  retrieveRelevantRollups as _retrieveRelevantRollups,
  semanticSearchFacts as _semanticSearchFacts,
  findNearDuplicateFacts as _findNearDuplicateFacts,
} from './semantic';
import {
  type PulseKind,
  type PulseEntry,
  recordPulse as _recordPulse,
  getRecentPulses as _getRecentPulses,
  countPulsesSince as _countPulsesSince,
  countSessionPulsesSince as _countSessionPulsesSince,
} from './pulse-log';
import {
  type Session,
  createSession as _createSession,
  ensureSession as _ensureSession,
  getSession as _getSession,
  getSessionByName as _getSessionByName,
  getSessions as _getSessions,
  getSessionWorkingDirectory as _getSessionWorkingDirectory,
  setSessionWorkingDirectory as _setSessionWorkingDirectory,
  renameSession as _renameSession,
  deleteSession as _deleteSession,
  touchSession as _touchSession,
  getSessionMessageCount as _getSessionMessageCount,
  getSessionMode as _getSessionMode,
  setSessionMode as _setSessionMode,
  getSdkSessionId as _getSdkSessionId,
  setSdkSessionId as _setSdkSessionId,
  clearSdkSessionId as _clearSdkSessionId,
  getPulseEnabledSessions as _getPulseEnabledSessions,
  setSessionPulseEnabled as _setSessionPulseEnabled,
  getSessionContext as _getSessionContext,
  setSessionContext as _setSessionContext,
} from './sessions';
import type { SessionContext } from './sessions';
import {
  type Client,
  type ClientSyncMode,
  getClients as _getClients,
  getClient as _getClient,
  createClient as _createClient,
  updateClient as _updateClient,
  deleteClient as _deleteClient,
  touchClientPulled as _touchClientPulled,
  touchClientPushed as _touchClientPushed,
} from './clients';
import {
  type Project,
  getProjects as _getProjects,
  getProject as _getProject,
  createProject as _createProject,
  updateProject as _updateProject,
  deleteProject as _deleteProject,
} from './projects';
import { appendAuditLog, digestContent } from '../utils/audit-log';
import { getCurrentSessionId } from '../tools/session-context';
import {
  type ContentDraft,
  type ContentDraftStatus,
  type ContentPost,
  type TransitionActor,
  type CreateContentDraftInput,
  type UpdateContentDraftFields,
  type SetStatusOptions,
  type RecordContentPostInput,
  createContentDraft as _createContentDraft,
  getContentDraft as _getContentDraft,
  getContentDraftsForScopes as _getContentDraftsForScopes,
  updateContentDraft as _updateContentDraft,
  setContentDraftStatus as _setContentDraftStatus,
  deleteContentDraft as _deleteContentDraft,
  recordContentPost as _recordContentPost,
  getContentPostsForDraft as _getContentPostsForDraft,
  getContentPostsForScopes as _getContentPostsForScopes,
} from './content-drafts';
import {
  type Campaign,
  type CampaignStatus,
  type CampaignDeliverable,
  type DeliverableStatus,
  type CreateCampaignInput,
  type UpdateCampaignFields,
  type AddDeliverableInput,
  type AddDeliverableResult,
  type SetDeliverableStatusResult,
  createCampaign as _createCampaign,
  getCampaign as _getCampaign,
  getCampaignsForScopes as _getCampaignsForScopes,
  updateCampaign as _updateCampaign,
  deleteCampaign as _deleteCampaign,
  addDeliverable as _addDeliverable,
  getDeliverable as _getDeliverable,
  getDeliverablesForCampaign as _getDeliverablesForCampaign,
  setDeliverableStatus as _setDeliverableStatus,
  linkDeliverableToContentDraft as _linkDeliverableToContentDraft,
  deleteDeliverable as _deleteDeliverable,
  getNextUnblockedDeliverable as _getNextUnblockedDeliverable,
} from './campaigns';
import {
  type PostAnalytics,
  type RecordPostAnalyticsInput,
  type AnalyticsSummary,
  recordPostAnalytics as _recordPostAnalytics,
  getPostAnalyticsForScopes as _getPostAnalyticsForScopes,
  getLatestPostAnalyticsForScopes as _getLatestPostAnalyticsForScopes,
  getPostAnalyticsHistory as _getPostAnalyticsHistory,
  deletePostAnalytics as _deletePostAnalytics,
  summarizeAnalytics as _summarizeAnalytics,
} from './analytics';

// Types
export type { Session, SessionContext, ContextType } from './sessions';
export type { Client, ClientSyncMode } from './clients';
export type { Project } from './projects';
export type { Message, SmartContextOptions, SmartContext, SummarizerFn } from './messages';
export type { Fact } from './facts';
export type { CronJob } from './cron-jobs';
export type { DailyLog, DailyLogRollup } from './daily-logs';
export type { TelegramChatSession } from './telegram-sessions';
export type { SoulAspect } from './soul';
export type { ResurfaceCandidate } from './resurfacing';
export type { PulseKind, PulseEntry } from './pulse-log';
export type {
  ContentDraft,
  ContentDraftStatus,
  ContentPost,
  ContentPostStatus,
  TransitionActor,
} from './content-drafts';
export type { Campaign, CampaignStatus, CampaignDeliverable, DeliverableStatus } from './campaigns';
export type { PostAnalytics, PostAnalyticsSource, RecordPostAnalyticsInput, AnalyticsSummary, ChannelSummary } from './analytics';

export class MemoryManager {
  private db: Database.Database;
  private summarizer?: SummarizerFn;

  // Cache for facts context + embeddings state — owned by FactsRepository
  private factsCache: FactsCache = createFactsCache();

  // Cache for soul context (invalidated on soul changes) — owned by SoulRepository
  private soulCache: SoulCache = createSoulCache();

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();

    // Run importance decay on startup (reduces importance for stale facts)
    _decayFactImportance(this.db);

    // Roll up old daily logs into durable summaries BEFORE pruning, then prune.
    // Runs in the background so startup is never blocked by an LLM call.
    void this.rollUpThenPrune();
  }

  /**
   * Roll up daily logs older than the retention window into weekly/monthly
   * summaries, then prune the raw logs. Summaries persist indefinitely.
   */
  private async rollUpThenPrune(): Promise<void> {
    try {
      if (!this.db.open) return;
      await _rollUpDailyLogs(this.db, (prompt, maxTokens) => summarizeText(prompt, maxTokens));
    } catch (e) {
      console.warn('[Memory] Daily log rollup skipped:', e);
    }
    // Prune daily logs older than 3 days — only the rolling window is kept.
    // Guard against a connection closed while the async rollup was in flight.
    if (!this.db.open) return;
    _pruneOldDailyLogs(this.db, 3);
  }

  private initialize(): void {
    this.db.exec(`
      -- Sessions for isolated conversation threads
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        context_type TEXT NOT NULL DEFAULT 'personal',
        client_id TEXT,
        project_key TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Clients (brands): each is a shared memory scope with an on-disk brain.
      -- One agency, many brands — selecting a client in the UI scopes memory to it.
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sync_mode TEXT NOT NULL DEFAULT 'live' CHECK(sync_mode IN ('live', 'manual')),
        repo_url TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Projects: a lightweight sub-scope under a client. id == the stable
      -- project_key used on sessions and the 'project:<id>' scope key.
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id),
        name TEXT NOT NULL,
        working_directory TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Main conversation messages (per-session)
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        timestamp TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        token_count INTEGER,
        session_id TEXT REFERENCES sessions(id)
      );

      -- Facts extracted from conversations (long-term memory).
      -- scope isolates facts by selected context: 'user' (personal), 'world',
      -- 'client:<id>', 'project:<key>', or 'chat:<sessionId>'.
      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        subject TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'user',
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Scheduled cron jobs (supports cron/at/every schedule types)
      CREATE TABLE IF NOT EXISTS cron_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        schedule_type TEXT NOT NULL DEFAULT 'cron' CHECK(schedule_type IN ('cron', 'at', 'every')),
        schedule TEXT,
        run_at TEXT,
        interval_ms INTEGER,
        prompt TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'desktop',
        enabled INTEGER DEFAULT 1,
        delete_after_run INTEGER DEFAULT 0,
        context_messages INTEGER DEFAULT 0,
        next_run_at TEXT,
        last_run_at TEXT,
        last_status TEXT CHECK(last_status IN ('ok', 'error', 'skipped')),
        last_error TEXT,
        last_duration_ms INTEGER,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Summaries of older conversation chunks (per-session)
      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        start_message_id INTEGER NOT NULL,
        end_message_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        session_id TEXT REFERENCES sessions(id),
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Calendar events
      CREATE TABLE IF NOT EXISTS calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        start_time TEXT NOT NULL,
        end_time TEXT,
        all_day INTEGER DEFAULT 0,
        location TEXT,
        reminder_minutes INTEGER DEFAULT 15,
        reminded INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'desktop',
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Tasks / Todos
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        due_date TEXT,
        priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high')),
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
        reminder_minutes INTEGER,
        reminded INTEGER DEFAULT 0,
        channel TEXT DEFAULT 'desktop',
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Daily logs for memory journaling (global across all sessions)
      CREATE TABLE IF NOT EXISTS daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Soul aspects (agent's evolving identity/personality)
      CREATE TABLE IF NOT EXISTS soul (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        aspect TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Telegram chat to session mapping
      CREATE TABLE IF NOT EXISTS telegram_chat_sessions (
        chat_id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        group_name TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Rolling summaries for smart context (different from compaction summaries)
      CREATE TABLE IF NOT EXISTS rolling_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        start_message_id INTEGER NOT NULL,
        end_message_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_rolling_summaries_session ON rolling_summaries(session_id, end_message_id);
      CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_summaries_range ON summaries(start_message_id, end_message_id);
      CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
      CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_time);
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(date);
      CREATE INDEX IF NOT EXISTS idx_soul_aspect ON soul(aspect);

      -- Unique constraint on session names (for Telegram group linking)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_name_unique ON sessions(name);
    `);

    // Create FTS5 virtual table for keyword search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
          category,
          subject,
          content,
          content='facts',
          content_rowid='id'
        );
      `);

      // Create triggers to keep FTS index in sync
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
          INSERT INTO facts_fts(rowid, category, subject, content)
          VALUES (new.id, new.category, new.subject, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, category, subject, content)
          VALUES ('delete', old.id, old.category, old.subject, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, category, subject, content)
          VALUES ('delete', old.id, old.category, old.subject, old.content);
          INSERT INTO facts_fts(rowid, category, subject, content)
          VALUES (new.id, new.category, new.subject, new.content);
        END;
      `);
    } catch {
      // FTS5 triggers may already exist
    }

    // Migration: add subject column if missing (must run BEFORE FTS rebuild)
    const columns = this.db.pragma('table_info(facts)') as Array<{ name: string }>;
    const hasSubject = columns.some((c) => c.name === 'subject');
    if (!hasSubject) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN subject TEXT NOT NULL DEFAULT ''`);
      console.log('[Memory] Migrated facts table: added subject column');
    }

    // Migration: add importance and last_accessed_at columns to facts
    const factsColumns = this.db.pragma('table_info(facts)') as Array<{ name: string }>;
    if (!factsColumns.some((c) => c.name === 'importance')) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN importance INTEGER DEFAULT 50`);
      console.log('[Memory] Migrated facts table: added importance column');
    }
    if (!factsColumns.some((c) => c.name === 'last_accessed_at')) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN last_accessed_at TEXT`);
      console.log('[Memory] Migrated facts table: added last_accessed_at column');
    }

    // Migration: add scope column to facts (isolates memory by selected context).
    // Default 'user' preserves all existing behavior (personal memory) — no backfill.
    if (!factsColumns.some((c) => c.name === 'scope')) {
      this.db.exec(`ALTER TABLE facts ADD COLUMN scope TEXT NOT NULL DEFAULT 'user'`);
      console.log('[Memory] Migrated facts table: added scope column');
    }
    // Create the scope index AFTER the column is guaranteed to exist — on a fresh
    // install the column ships in CREATE TABLE (so the ALTER above is skipped),
    // while on an existing DB it was just added. Either way the index is safe here
    // but would fail if placed in the initial schema block (runs before migration).
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope)`);

    // Rebuild FTS index from existing facts (after all schema migrations)
    this.rebuildFtsIndex();

    // Migration: add session_id to messages if missing
    const msgColumns = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    const hasSessionId = msgColumns.some((c) => c.name === 'session_id');
    if (!hasSessionId) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      console.log('[Memory] Migrated messages table: added session_id column');
    }

    // Migration: add session_id to summaries if missing
    const sumColumns = this.db.pragma('table_info(summaries)') as Array<{ name: string }>;
    const sumHasSessionId = sumColumns.some((c) => c.name === 'session_id');
    if (!sumHasSessionId) {
      this.db.exec(`ALTER TABLE summaries ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      console.log('[Memory] Migrated summaries table: added session_id column');
    }

    // Migration: add metadata column to messages if missing
    const msgColsForMeta = this.db.pragma('table_info(messages)') as Array<{ name: string }>;
    const hasMetadata = msgColsForMeta.some((c) => c.name === 'metadata');
    if (!hasMetadata) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN metadata TEXT`);
      console.log('[Memory] Migrated messages table: added metadata column');
    }

    // Migration: create default session and migrate orphan messages
    this.migrateToDefaultSession();

    // Migration: add session_id to calendar_events, tasks, and cron_jobs
    this.migrateSessionScopedTables();

    // Migration: add sdk_session_id to sessions for SDK session persistence
    const sessColumns = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumns.some((c) => c.name === 'sdk_session_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT');
      console.log('[Memory] Migrated sessions table: added sdk_session_id column');
    }

    // Migration: add mode column to sessions for per-session mode lock
    const sessColumnsForMode = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumnsForMode.some((c) => c.name === 'mode')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'coder'");
      console.log('[Memory] Migrated sessions table: added mode column');
    }

    // Migration: add selected-context columns to sessions (scoped memory).
    // context_type defaults to 'personal' — existing sessions keep today's behavior.
    const sessColumnsForContext = this.db.pragma('table_info(sessions)') as Array<{
      name: string;
    }>;
    if (!sessColumnsForContext.some((c) => c.name === 'context_type')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN context_type TEXT NOT NULL DEFAULT 'personal'");
      console.log('[Memory] Migrated sessions table: added context_type column');
    }
    if (!sessColumnsForContext.some((c) => c.name === 'client_id')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN client_id TEXT');
      console.log('[Memory] Migrated sessions table: added client_id column');
    }
    if (!sessColumnsForContext.some((c) => c.name === 'project_key')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN project_key TEXT');
      console.log('[Memory] Migrated sessions table: added project_key column');
    }

    // Migration: ensure the clients table exists on databases created before scoping.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sync_mode TEXT NOT NULL DEFAULT 'live' CHECK(sync_mode IN ('live', 'manual')),
        repo_url TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
    `);

    // Migration: add last_pulled_at/last_pushed_at to clients (roadmap item 9 —
    // discoverable/shareable git-brain sync). Both null until the first
    // successful pull/push; the UI uses them to render "last synced" and a
    // stale indicator.
    const clientColumns = this.db.pragma('table_info(clients)') as Array<{ name: string }>;
    if (!clientColumns.some((c) => c.name === 'last_pulled_at')) {
      this.db.exec('ALTER TABLE clients ADD COLUMN last_pulled_at TEXT');
      console.log('[Memory] Migrated clients table: added last_pulled_at column');
    }
    if (!clientColumns.some((c) => c.name === 'last_pushed_at')) {
      this.db.exec('ALTER TABLE clients ADD COLUMN last_pushed_at TEXT');
      console.log('[Memory] Migrated clients table: added last_pushed_at column');
    }

    // Migration: ensure the projects table exists on databases created before
    // client-first workspaces. Idempotent — safe to run on every startup.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL REFERENCES clients(id),
        name TEXT NOT NULL,
        working_directory TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_projects_client ON projects(client_id);
    `);

    // Migration: add working_directory column to sessions for per-session workspace
    const sessColumnsForWd = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumnsForWd.some((c) => c.name === 'working_directory')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN working_directory TEXT');
      console.log('[Memory] Migrated sessions table: added working_directory column');
    }

    // Migration: add pulse_enabled column to sessions (NULL = unset → primary-session default)
    const sessColumnsForPulse = this.db.pragma('table_info(sessions)') as Array<{ name: string }>;
    if (!sessColumnsForPulse.some((c) => c.name === 'pulse_enabled')) {
      this.db.exec('ALTER TABLE sessions ADD COLUMN pulse_enabled INTEGER');
      console.log('[Memory] Migrated sessions table: added pulse_enabled column');
    }

    // Migration: add embedding BLOB column to facts for semantic recall
    const factsColsForEmbedding = this.db.pragma('table_info(facts)') as Array<{ name: string }>;
    if (!factsColsForEmbedding.some((c) => c.name === 'embedding')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN embedding BLOB');
      console.log('[Memory] Migrated facts table: added embedding column');
    }

    // Migration: add sensitive flag to facts (excluded from resurfacing/cloud)
    if (!factsColsForEmbedding.some((c) => c.name === 'sensitive')) {
      this.db.exec('ALTER TABLE facts ADD COLUMN sensitive INTEGER DEFAULT 0');
      console.log('[Memory] Migrated facts table: added sensitive column');
    }

    // Migration: add embedding BLOB column to soul for semantic recall
    const soulColsForEmbedding = this.db.pragma('table_info(soul)') as Array<{ name: string }>;
    if (!soulColsForEmbedding.some((c) => c.name === 'embedding')) {
      this.db.exec('ALTER TABLE soul ADD COLUMN embedding BLOB');
      console.log('[Memory] Migrated soul table: added embedding column');
    }

    // Daily log rollups (weekly/monthly summaries that persist past pruning)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_log_rollups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period_type TEXT NOT NULL CHECK(period_type IN ('week', 'month')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_rollups_period ON daily_log_rollups(period_type, period_start);

      -- Key/value store for memory maintenance bookkeeping (consolidation/resurfacing timestamps)
      CREATE TABLE IF NOT EXISTS memory_meta (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );

      -- Proactive check-in / daily brief delivery log (dedup + daily-cap accounting)
      CREATE TABLE IF NOT EXISTS pulse_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        kind TEXT NOT NULL CHECK(kind IN ('checkin', 'brief')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_pulse_log_session ON pulse_log(session_id, created_at);

      -- Content workflow (roadmap item 6): per-brand drafts moving through a
      -- human-gated approval pipeline. scope isolates drafts by selected
      -- context, same convention as facts.scope. See src/memory/content-drafts.ts
      -- for the status state machine and human-only approval enforcement.
      CREATE TABLE IF NOT EXISTS content_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        session_id TEXT REFERENCES sessions(id),
        channel TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN
          ('draft', 'pending_approval', 'approved', 'rejected', 'scheduled', 'posted', 'failed')),
        scheduled_for TEXT,
        posted_at TEXT,
        external_ref TEXT,
        cron_job_id INTEGER REFERENCES cron_jobs(id) ON DELETE SET NULL,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_content_drafts_scope ON content_drafts(scope, status);

      -- Append-only post-attempt audit log (dry-run or real), independent of
      -- the draft's current status so retries/dry-runs don't overwrite history.
      CREATE TABLE IF NOT EXISTS content_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER NOT NULL REFERENCES content_drafts(id),
        scope TEXT NOT NULL,
        channel TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('posted', 'failed', 'dry_run')),
        detail TEXT,
        external_ref TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_content_posts_draft ON content_posts(draft_id);
      CREATE INDEX IF NOT EXISTS idx_content_posts_scope ON content_posts(scope, created_at);

      -- Campaigns / plans (roadmap item 10): a lightweight persisted object so
      -- the orchestrating model can manage multi-deliverable work across turns
      -- and days. scope isolates campaigns by selected context, same
      -- convention as facts.scope / content_drafts.scope. See
      -- src/memory/campaigns.ts for the deliverable status state machine and
      -- depends_on dependency enforcement.
      CREATE TABLE IF NOT EXISTS campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        name TEXT NOT NULL,
        brief TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN
          ('active', 'paused', 'completed', 'archived')),
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_campaigns_scope ON campaigns(scope, status);

      -- One unit of work inside a campaign. depends_on is a same-campaign
      -- self-reference (enforced at the application layer in campaigns.ts's
      -- addDeliverable, not via a DB-level campaign_id match, since SQLite
      -- foreign keys can't express "same parent as me"). result_ref is free
      -- text — 'content_draft:<id>' by convention when the output is a
      -- content-workflow draft (roadmap item 6), otherwise a summary string.
      CREATE TABLE IF NOT EXISTS campaign_deliverables (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
        lane TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
          ('pending', 'in_progress', 'review', 'done', 'blocked')),
        assigned_specialist TEXT,
        depends_on INTEGER REFERENCES campaign_deliverables(id) ON DELETE SET NULL,
        result_ref TEXT,
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        updated_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_campaign_deliverables_campaign ON campaign_deliverables(campaign_id, status);

      -- Post analytics (X/LinkedIn/etc. performance): per-post metric
      -- snapshots, scoped like facts/content_drafts. See src/memory/analytics.ts
      -- for why this is append-only (a post's numbers keep climbing after it
      -- ships) and how "current numbers" resolves to "latest snapshot per post".
      CREATE TABLE IF NOT EXISTS post_analytics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        channel TEXT NOT NULL,
        external_ref TEXT NOT NULL,
        content_post_id INTEGER REFERENCES content_posts(id) ON DELETE SET NULL,
        title TEXT NOT NULL DEFAULT '',
        impressions INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        comments INTEGER NOT NULL DEFAULT 0,
        shares INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0,
        video_views INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'mcp')),
        raw_json TEXT,
        captured_at TEXT NOT NULL DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ'))),
        created_at TEXT DEFAULT ((strftime('%Y-%m-%dT%H:%M:%fZ')))
      );
      CREATE INDEX IF NOT EXISTS idx_post_analytics_scope ON post_analytics(scope, channel, captured_at);
      CREATE INDEX IF NOT EXISTS idx_post_analytics_ref ON post_analytics(scope, channel, external_ref, captured_at);
    `);

    // Migration: add content_draft_id to cron_jobs (links a scheduled cron job
    // back to the draft it will post — see checkDueJobs's 'content_post' branch
    // in src/scheduler/index.ts). Idempotent, same pragma-check pattern as the
    // other cron_jobs migrations in this file.
    const cronColumnsForContent = this.db.pragma('table_info(cron_jobs)') as Array<{
      name: string;
    }>;
    if (!cronColumnsForContent.some((c) => c.name === 'content_draft_id')) {
      this.db.exec(
        'ALTER TABLE cron_jobs ADD COLUMN content_draft_id INTEGER REFERENCES content_drafts(id) ON DELETE SET NULL'
      );
      console.log('[Memory] Migrated cron_jobs table: added content_draft_id column');
    }
    // Migration: add job_type to cron_jobs. This column previously only
    // existed once src/tools/scheduler-tools.ts's ensureCronJobColumns ran
    // (lazily, on the first create_routine/create_reminder call) — content
    // scheduling (schedule_content_draft) needs it unconditionally, so it's
    // guaranteed here at MemoryManager init instead of depending on that
    // other lazy path having already run.
    if (!cronColumnsForContent.some((c) => c.name === 'job_type')) {
      this.db.exec("ALTER TABLE cron_jobs ADD COLUMN job_type TEXT DEFAULT 'routine'");
      console.log('[Memory] Migrated cron_jobs table: added job_type column');
    }

    // Backfill embeddings for rows missing them, in the background (fire-and-forget).
    this.backfillEmbeddings();
  }

  /**
   * One-time background backfill: embed facts/soul rows whose embedding IS NULL.
   * Runs lazily so it never blocks startup or a chat turn.
   */
  private backfillEmbeddings(): void {
    void (async () => {
      try {
        if (!this.db.open) return;
        const { backfillMissingEmbeddings } = await import('./semantic');
        if (!this.db.open) return;
        await backfillMissingEmbeddings(this.db);
      } catch (e) {
        console.warn('[Memory] Embedding backfill skipped:', e);
      }
    })();
  }

  /**
   * Add session_id column to calendar_events, tasks, and cron_jobs tables
   * and migrate existing records to the default session
   */
  private migrateSessionScopedTables(): void {
    const DEFAULT_SESSION_ID = 'default';

    // Helper to check if column exists
    const hasColumn = (table: string, column: string): boolean => {
      const columns = this.db.pragma(`table_info(${table})`) as Array<{ name: string }>;
      return columns.some((c) => c.name === column);
    };

    // Migrate calendar_events
    if (!hasColumn('calendar_events', 'session_id')) {
      this.db.exec(
        `ALTER TABLE calendar_events ADD COLUMN session_id TEXT REFERENCES sessions(id)`
      );
      const count = (
        this.db
          .prepare('SELECT COUNT(*) as c FROM calendar_events WHERE session_id IS NULL')
          .get() as { c: number }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE calendar_events SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} calendar events to default session`);
      }
      console.log('[Memory] Migrated calendar_events table: added session_id column');
    }

    // Migrate tasks
    if (!hasColumn('tasks', 'session_id')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      const count = (
        this.db.prepare('SELECT COUNT(*) as c FROM tasks WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE tasks SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} tasks to default session`);
      }
      console.log('[Memory] Migrated tasks table: added session_id column');
    }

    // Migrate cron_jobs
    if (!hasColumn('cron_jobs', 'session_id')) {
      this.db.exec(`ALTER TABLE cron_jobs ADD COLUMN session_id TEXT REFERENCES sessions(id)`);
      const count = (
        this.db.prepare('SELECT COUNT(*) as c FROM cron_jobs WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (count > 0) {
        this.db
          .prepare('UPDATE cron_jobs SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${count} cron jobs to default session`);
      }
      console.log('[Memory] Migrated cron_jobs table: added session_id column');
    }

    // Create indexes for session filtering
    try {
      this.db.exec(
        `CREATE INDEX IF NOT EXISTS idx_calendar_session ON calendar_events(session_id)`
      );
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id)`);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_cron_session ON cron_jobs(session_id)`);
    } catch {
      // Indexes may already exist
    }
  }

  /**
   * Create default session and migrate existing messages without session_id
   */
  private migrateToDefaultSession(): void {
    const DEFAULT_SESSION_ID = 'default';
    const DEFAULT_SESSION_NAME = 'Chat';

    // Only create default session if NO sessions exist at all
    // (Don't recreate it if user deleted it and has other sessions)
    const sessionCount = (
      this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }
    ).c;
    const existing = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(DEFAULT_SESSION_ID);
    if (!existing && sessionCount === 0) {
      // Create default session
      this.db
        .prepare(
          `
        INSERT INTO sessions (id, name, created_at, updated_at)
        VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))
      `
        )
        .run(DEFAULT_SESSION_ID, DEFAULT_SESSION_NAME);
      console.log('[Memory] Created default session');
    }

    // Migrate orphan messages/summaries to default session (only if it exists)
    const defaultExists = this.db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(DEFAULT_SESSION_ID);
    if (defaultExists) {
      const orphanCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM messages WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (orphanCount > 0) {
        this.db
          .prepare('UPDATE messages SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${orphanCount} messages to default session`);
      }

      const orphanSumCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM summaries WHERE session_id IS NULL').get() as {
          c: number;
        }
      ).c;
      if (orphanSumCount > 0) {
        this.db
          .prepare('UPDATE summaries SET session_id = ? WHERE session_id IS NULL')
          .run(DEFAULT_SESSION_ID);
        console.log(`[Memory] Migrated ${orphanSumCount} summaries to default session`);
      }
    }
  }

  /**
   * Rebuild FTS index from existing facts
   */
  private rebuildFtsIndex(): void {
    try {
      // Check if FTS table is empty but facts exist
      const ftsCount = (
        this.db.prepare('SELECT COUNT(*) as c FROM facts_fts').get() as { c: number }
      ).c;
      const factsCount = (this.db.prepare('SELECT COUNT(*) as c FROM facts').get() as { c: number })
        .c;

      if (ftsCount === 0 && factsCount > 0) {
        console.log('[Memory] Rebuilding FTS index...');
        const facts = this.db
          .prepare('SELECT id, category, subject, content FROM facts')
          .all() as Fact[];
        const insert = this.db.prepare(
          'INSERT INTO facts_fts(rowid, category, subject, content) VALUES (?, ?, ?, ?)'
        );

        for (const fact of facts) {
          insert.run(fact.id, fact.category, fact.subject, fact.content);
        }
        console.log(`[Memory] Rebuilt FTS index with ${facts.length} facts`);
      }
    } catch (e) {
      console.warn('[Memory] FTS rebuild failed:', e);
    }
  }

  /**
   * Set the summarizer function
   */
  setSummarizer(fn: SummarizerFn): void {
    this.summarizer = fn;
  }

  // ============ SESSION METHODS ============

  createSession(
    name: string,
    mode: AgentModeId = 'coder',
    workingDirectory?: string | null
  ): Session {
    return _createSession(this.db, name, mode, workingDirectory);
  }

  ensureSession(id: string, mode: AgentModeId = 'coder'): void {
    _ensureSession(this.db, id, mode);
  }

  getSessionByName(name: string): Session | null {
    return _getSessionByName(this.db, name);
  }

  getSession(id: string): Session | null {
    return _getSession(this.db, id);
  }

  getSessions(): Session[] {
    return _getSessions(this.db);
  }

  getSessionWorkingDirectory(sessionId: string): string | null {
    return _getSessionWorkingDirectory(this.db, sessionId);
  }

  setSessionWorkingDirectory(sessionId: string, workingDirectory: string | null): void {
    _setSessionWorkingDirectory(this.db, sessionId, workingDirectory);
  }

  renameSession(id: string, name: string, workingDirectory?: string): boolean {
    return _renameSession(this.db, id, name, workingDirectory);
  }

  deleteSession(id: string): boolean {
    return _deleteSession(this.db, id);
  }

  touchSession(id: string): void {
    _touchSession(this.db, id);
  }

  getSessionMessageCount(sessionId: string): number {
    return _getSessionMessageCount(this.db, sessionId);
  }

  getSessionMode(sessionId: string): AgentModeId {
    return _getSessionMode(this.db, sessionId);
  }

  setSessionMode(sessionId: string, mode: AgentModeId): boolean {
    return _setSessionMode(this.db, sessionId, mode);
  }

  // ============ SELECTED MEMORY CONTEXT (scoped memory) ============

  getSessionContext(sessionId: string): SessionContext {
    return _getSessionContext(this.db, sessionId);
  }

  setSessionContext(sessionId: string, context: SessionContext): boolean {
    return _setSessionContext(this.db, sessionId, context);
  }

  // ============ CLIENT (BRAND) METHODS ============

  getClients(): Client[] {
    return _getClients(this.db);
  }

  getClient(id: string): Client | null {
    return _getClient(this.db, id);
  }

  createClient(input: {
    id: string;
    name: string;
    syncMode?: ClientSyncMode;
    repoUrl?: string | null;
  }): Client {
    return _createClient(this.db, input);
  }

  updateClient(
    id: string,
    fields: { name?: string; syncMode?: ClientSyncMode; repoUrl?: string | null }
  ): boolean {
    return _updateClient(this.db, id, fields);
  }

  deleteClient(id: string): boolean {
    return _deleteClient(this.db, id);
  }

  /** Stamp a client's last-pulled timestamp (roadmap item 9 — sync status). */
  touchClientPulled(id: string, isoTimestamp?: string): boolean {
    return _touchClientPulled(this.db, id, isoTimestamp);
  }

  /** Stamp a client's last-pushed timestamp. */
  touchClientPushed(id: string, isoTimestamp?: string): boolean {
    return _touchClientPushed(this.db, id, isoTimestamp);
  }

  // ============ PROJECT METHODS ============

  getProjects(clientId: string): Project[] {
    return _getProjects(this.db, clientId);
  }

  getProject(id: string): Project | null {
    return _getProject(this.db, id);
  }

  createProject(input: {
    id: string;
    clientId: string;
    name: string;
    workingDirectory?: string | null;
  }): Project {
    return _createProject(this.db, input);
  }

  updateProject(id: string, fields: { name?: string; workingDirectory?: string | null }): boolean {
    return _updateProject(this.db, id, fields);
  }

  deleteProject(id: string): boolean {
    return _deleteProject(this.db, id);
  }

  // ============ TELEGRAM CHAT SESSION METHODS ============

  /**
   * Link a Telegram chat to a session
   */
  linkTelegramChat(chatId: number, sessionId: string, groupName?: string): boolean {
    return _linkTelegramChat(this.db, chatId, sessionId, groupName);
  }

  /**
   * Unlink a Telegram chat from its session
   */
  unlinkTelegramChat(chatId: number): boolean {
    return _unlinkTelegramChat(this.db, chatId);
  }

  /**
   * Get the session ID for a Telegram chat
   */
  getSessionForChat(chatId: number): string | null {
    return _getSessionForChat(this.db, chatId);
  }

  /**
   * Get the Telegram chat ID for a session
   */
  getChatForSession(sessionId: string): number | null {
    return _getChatForSession(this.db, sessionId);
  }

  /**
   * Get all Telegram chat to session mappings
   */
  getAllTelegramChatSessions(): TelegramChatSession[] {
    return _getAllTelegramChatSessions(this.db);
  }

  // ============ DAILY LOG METHODS ============

  getDailyLog(date?: string): DailyLog | null {
    return _getDailyLog(this.db, date);
  }

  appendToDailyLog(entry: string): DailyLog {
    return _appendToDailyLog(this.db, entry);
  }

  getDailyLogsSince(days: number = 3): DailyLog[] {
    return _getDailyLogsSince(this.db, days);
  }

  deleteDailyLog(id: number): boolean {
    return _deleteDailyLog(this.db, id);
  }

  getDailyLogsContext(days: number = 3): string {
    return _getDailyLogsContext(this.db, days);
  }

  async rollUpDailyLogs(): Promise<number> {
    return _rollUpDailyLogs(this.db, (prompt, maxTokens) => summarizeText(prompt, maxTokens));
  }

  getRollupsForContext(budgetChars: number = 600): string {
    return _getRollupsForContext(this.db, budgetChars);
  }

  getDailyLogOnThisDay(): { rollups: DailyLogRollup[]; logs: DailyLog[] } {
    return _getDailyLogOnThisDay(this.db);
  }

  getAllRollups(): DailyLogRollup[] {
    return _getAllRollups(this.db);
  }

  selectResurfaceCandidate(
    now: Date = new Date(),
    visibleScopes?: string[]
  ): ResurfaceCandidate | null {
    return _selectResurfaceCandidate(this.db, now, visibleScopes);
  }

  // ============ PULSE (PROACTIVE CHECK-IN) METHODS ============

  recordPulse(sessionId: string, kind: PulseKind, content: string, now?: Date): number {
    return _recordPulse(this.db, sessionId, kind, content, now);
  }

  getRecentPulses(sessionId: string, days: number = 7, now?: Date): PulseEntry[] {
    return _getRecentPulses(this.db, sessionId, days, now);
  }

  countPulsesSince(kind: PulseKind, sinceIso: string): number {
    return _countPulsesSince(this.db, kind, sinceIso);
  }

  countSessionPulsesSince(sessionId: string, kind: PulseKind, sinceIso: string): number {
    return _countSessionPulsesSince(this.db, sessionId, kind, sinceIso);
  }

  getPulseEnabledSessions(): Session[] {
    return _getPulseEnabledSessions(this.db);
  }

  setSessionPulseEnabled(sessionId: string, enabled: boolean): boolean {
    return _setSessionPulseEnabled(this.db, sessionId, enabled);
  }

  // ============ MESSAGE METHODS ============

  saveMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    sessionId: string = 'default',
    metadata?: Record<string, unknown>
  ): number {
    return _saveMessage(this.db, role, content, sessionId, metadata);
  }

  getRecentMessages(limit: number = 50, sessionId: string = 'default'): Message[] {
    return _getRecentMessages(this.db, limit, sessionId);
  }

  getMessageCount(sessionId?: string): number {
    return _getMessageCount(this.db, sessionId);
  }

  async getSmartContext(
    sessionId: string = 'default',
    options: SmartContextOptions
  ): Promise<SmartContext> {
    return _getSmartContext(this.db, sessionId, options, {
      summarizer: this.summarizer,
    });
  }

  // ============ FACT METHODS ============

  saveFact(
    category: string,
    subject: string,
    content: string,
    sensitive?: boolean,
    scope: string = 'user'
  ): number {
    const id = _saveFact(this.db, category, subject, content, this.factsCache, sensitive, scope);
    // Write-audit log (roadmap item 8): every fact write, no bypass — this is
    // the single MemoryManager entry point every caller (agent remember tool,
    // facts:create IPC, atelier-bridge mirror sync, consolidation) goes through.
    appendAuditLog({
      sessionId: getCurrentSessionId(),
      scope,
      tool: 'saveFact',
      target: `${scope}:${category}/${subject || '(no subject)'}`,
      digest: digestContent(content),
    });
    return id;
  }

  getFact(id: number): Fact | null {
    return _getFact(this.db, id);
  }

  getAllFacts(): Fact[] {
    return _getAllFacts(this.db);
  }

  getFactsForContext(visibleScopes?: string[]): string {
    return _getFactsForContext(this.db, this.factsCache, visibleScopes);
  }

  // ============ SEMANTIC RECALL ============

  /**
   * Embed a query string for semantic retrieval. Returns null on failure so
   * callers can fall back to wholesale context.
   */
  async embedQuery(text: string): Promise<Float32Array | null> {
    try {
      if (!text || text.trim().length === 0) return null;
      return await embedText(text);
    } catch (e) {
      console.warn('[Memory] Query embedding failed:', e);
      return null;
    }
  }

  retrieveRelevantFacts(
    queryEmbedding: Float32Array,
    k: number,
    budgetChars: number,
    visibleScopes?: string[]
  ): string {
    return _retrieveRelevantFacts(this.db, queryEmbedding, k, budgetChars, visibleScopes);
  }

  retrieveRelevantSoul(
    queryEmbedding: Float32Array,
    k: number,
    budgetChars: number,
    alwaysInclude: string[] = []
  ): string {
    return _retrieveRelevantSoul(this.db, queryEmbedding, k, budgetChars, alwaysInclude);
  }

  retrieveRelevantRollups(queryEmbedding: Float32Array, k: number, budgetChars: number): string {
    return _retrieveRelevantRollups(this.db, queryEmbedding, k, budgetChars);
  }

  semanticSearchFacts(
    queryEmbedding: Float32Array,
    k = 6,
    visibleScopes?: string[]
  ): Array<Fact & { score: number }> {
    return _semanticSearchFacts(this.db, queryEmbedding, k, visibleScopes) as Array<
      Fact & { score: number }
    >;
  }

  findNearDuplicateFacts(
    threshold = 0.82,
    scope?: string
  ): Array<Array<{ id: number; subject: string; content: string }>> {
    return _findNearDuplicateFacts(this.db, threshold, scope);
  }

  getFactsMemoryUsage(scope?: string): { usedChars: number; budgetChars: number; pct: number } {
    return _getFactsMemoryUsage(this.db, scope);
  }

  deleteFact(id: number): boolean {
    return _deleteFact(this.db, id, this.factsCache);
  }

  updateFact(
    id: number,
    fields: {
      category?: string;
      subject?: string;
      content?: string;
      sensitive?: boolean;
      scope?: string;
    }
  ): boolean {
    const ok = _updateFact(this.db, id, fields, this.factsCache);
    if (ok) {
      // Write-audit log (roadmap item 8). Read the post-update row so the
      // logged category/subject/scope reflect what actually landed, not just
      // whichever fields this call happened to touch.
      const fact = _getFact(this.db, id);
      appendAuditLog({
        sessionId: getCurrentSessionId(),
        scope: fact?.scope ?? fields.scope ?? null,
        tool: 'updateFact',
        target: fact
          ? `${fact.scope}:${fact.category}/${fact.subject || '(no subject)'}`
          : `fact#${id}`,
        digest: digestContent(fields.content ?? JSON.stringify(fields)),
      });
    }
    return ok;
  }

  setFactSensitive(id: number, sensitive: boolean): boolean {
    return _setFactSensitive(this.db, id, sensitive, this.factsCache);
  }

  /** Promote a fact to a broader scope (chat → project → client → world). */
  promoteFact(id: number, targetScope: string): { ok: boolean; id: number | null } {
    return _promoteFact(this.db, id, targetScope, this.factsCache);
  }

  deleteFactBySubject(category: string, subject: string): boolean {
    return _deleteFactBySubject(this.db, category, subject, this.factsCache);
  }

  searchFacts(query: string, category?: string): Fact[] {
    return _searchFacts(this.db, query, category);
  }

  getFactsByCategory(category: string): Fact[] {
    return _getFactsByCategory(this.db, category);
  }

  getFactCategories(): string[] {
    return _getFactCategories(this.db);
  }

  // ============ CRON JOB METHODS ============

  saveCronJob(
    name: string,
    schedule: string,
    prompt: string,
    channel: string = 'default',
    sessionId: string = 'default'
  ): number {
    return _saveCronJob(this.db, name, schedule, prompt, channel, sessionId);
  }

  getCronJobs(enabledOnly: boolean = true): CronJob[] {
    return _getCronJobs(this.db, enabledOnly);
  }

  setCronJobEnabled(name: string, enabled: boolean): boolean {
    return _setCronJobEnabled(this.db, name, enabled);
  }

  deleteCronJob(name: string): boolean {
    return _deleteCronJob(this.db, name);
  }

  /** Configure a just-created cron job as a one-time 'content_post' job (roadmap item 6). */
  setCronJobForContentPost(cronJobId: number, runAtIso: string, draftId: number): void {
    _setCronJobForContentPost(this.db, cronJobId, runAtIso, draftId);
  }

  // ============ CONTENT DRAFT METHODS (roadmap item 6) ============

  createContentDraft(input: CreateContentDraftInput): number {
    return _createContentDraft(this.db, input);
  }

  getContentDraft(id: number): ContentDraft | null {
    return _getContentDraft(this.db, id);
  }

  getContentDraftsForScopes(visibleScopes: string[], status?: ContentDraftStatus): ContentDraft[] {
    return _getContentDraftsForScopes(this.db, visibleScopes, status);
  }

  updateContentDraft(
    id: number,
    fields: UpdateContentDraftFields
  ): { ok: boolean; error?: string } {
    return _updateContentDraft(this.db, id, fields);
  }

  setContentDraftStatus(
    id: number,
    to: ContentDraftStatus,
    actor: TransitionActor,
    options?: SetStatusOptions
  ): { ok: boolean; error?: string } {
    return _setContentDraftStatus(this.db, id, to, actor, options);
  }

  deleteContentDraft(id: number): boolean {
    return _deleteContentDraft(this.db, id);
  }

  recordContentPost(input: RecordContentPostInput): number {
    return _recordContentPost(this.db, input);
  }

  getContentPostsForDraft(draftId: number): ContentPost[] {
    return _getContentPostsForDraft(this.db, draftId);
  }

  getContentPostsForScopes(visibleScopes: string[], limit: number = 100): ContentPost[] {
    return _getContentPostsForScopes(this.db, visibleScopes, limit);
  }

  // ============ CAMPAIGN METHODS (roadmap item 10) ============

  createCampaign(input: CreateCampaignInput): number {
    return _createCampaign(this.db, input);
  }

  getCampaign(id: number): Campaign | null {
    return _getCampaign(this.db, id);
  }

  getCampaignsForScopes(visibleScopes: string[], status?: CampaignStatus): Campaign[] {
    return _getCampaignsForScopes(this.db, visibleScopes, status);
  }

  updateCampaign(id: number, fields: UpdateCampaignFields): boolean {
    return _updateCampaign(this.db, id, fields);
  }

  deleteCampaign(id: number): boolean {
    return _deleteCampaign(this.db, id);
  }

  addDeliverable(input: AddDeliverableInput): AddDeliverableResult {
    return _addDeliverable(this.db, input);
  }

  getDeliverable(id: number): CampaignDeliverable | null {
    return _getDeliverable(this.db, id);
  }

  getDeliverablesForCampaign(campaignId: number): CampaignDeliverable[] {
    return _getDeliverablesForCampaign(this.db, campaignId);
  }

  setDeliverableStatus(
    id: number,
    to: DeliverableStatus,
    resultRef?: string | null
  ): SetDeliverableStatusResult {
    return _setDeliverableStatus(this.db, id, to, resultRef);
  }

  /** Link a deliverable's result to a content-workflow draft (roadmap item 10, requirement 3). */
  linkDeliverableToContentDraft(
    deliverableId: number,
    contentDraftId: number
  ): SetDeliverableStatusResult {
    return _linkDeliverableToContentDraft(this.db, deliverableId, contentDraftId);
  }

  deleteDeliverable(id: number): boolean {
    return _deleteDeliverable(this.db, id);
  }

  /** The next unblocked, not-yet-started deliverable in a campaign, or null if none. */
  getNextUnblockedDeliverable(campaignId: number): CampaignDeliverable | null {
    return _getNextUnblockedDeliverable(this.db, campaignId);
  }

  // ============ POST ANALYTICS (X/LinkedIn/etc. performance) ============

  recordPostAnalytics(input: RecordPostAnalyticsInput): number {
    return _recordPostAnalytics(this.db, input);
  }

  getPostAnalyticsForScopes(visibleScopes: string[], channel?: string): PostAnalytics[] {
    return _getPostAnalyticsForScopes(this.db, visibleScopes, channel);
  }

  getLatestPostAnalyticsForScopes(visibleScopes: string[], channel?: string): PostAnalytics[] {
    return _getLatestPostAnalyticsForScopes(this.db, visibleScopes, channel);
  }

  getPostAnalyticsHistory(scope: string, channel: string, externalRef: string): PostAnalytics[] {
    return _getPostAnalyticsHistory(this.db, scope, channel, externalRef);
  }

  deletePostAnalytics(id: number): boolean {
    return _deletePostAnalytics(this.db, id);
  }

  /** Aggregate summary (totals, per-channel breakdown, top posts) over the given LATEST-per-post rows. */
  summarizeAnalytics(
    rows: PostAnalytics[],
    options?: { topN?: number; minImpressionsForRanking?: number }
  ): AnalyticsSummary {
    return _summarizeAnalytics(rows, options);
  }

  // ============ UTILITY METHODS ============

  getStats(sessionId?: string): {
    messageCount: number;
    factCount: number;
    cronJobCount: number;
    summaryCount: number;
    estimatedTokens: number;
    sessionCount?: number;
  } {
    let messages: { c: number; t: number };
    let summaries: { c: number };

    if (sessionId) {
      // Session-specific stats
      messages = this.db
        .prepare('SELECT COUNT(*) as c, SUM(token_count) as t FROM messages WHERE session_id = ?')
        .get(sessionId) as { c: number; t: number };
      summaries = this.db
        .prepare('SELECT COUNT(*) as c FROM summaries WHERE session_id = ?')
        .get(sessionId) as { c: number };
    } else {
      // Global stats
      messages = this.db
        .prepare('SELECT COUNT(*) as c, SUM(token_count) as t FROM messages')
        .get() as { c: number; t: number };
      summaries = this.db.prepare('SELECT COUNT(*) as c FROM summaries').get() as { c: number };
    }

    const facts = this.db.prepare('SELECT COUNT(*) as c FROM facts').get() as { c: number };
    const cronJobs = this.db.prepare('SELECT COUNT(*) as c FROM cron_jobs').get() as { c: number };
    const sessionCount = this.db.prepare('SELECT COUNT(*) as c FROM sessions').get() as {
      c: number;
    };

    return {
      messageCount: messages.c,
      factCount: facts.c,
      cronJobCount: cronJobs.c,
      summaryCount: summaries.c,
      estimatedTokens: messages.t || 0,
      sessionCount: sessionCount.c,
    };
  }

  clearConversation(sessionId?: string): void {
    if (sessionId) {
      // Clear only the specified session
      this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
      this.db.prepare('DELETE FROM summaries WHERE session_id = ?').run(sessionId);
      // Clear SDK session so next message starts fresh
      this.clearSdkSessionId(sessionId);
    } else {
      // Clear all (legacy behavior)
      this.db.exec('DELETE FROM messages');
      this.db.exec('DELETE FROM summaries');
      this.db.exec('UPDATE sessions SET sdk_session_id = NULL');
    }
  }

  // ============ SDK SESSION PERSISTENCE ============

  getSdkSessionId(sessionId: string): string | null {
    return _getSdkSessionId(this.db, sessionId);
  }

  setSdkSessionId(sessionId: string, sdkSessionId: string): void {
    _setSdkSessionId(this.db, sessionId, sdkSessionId);
  }

  clearSdkSessionId(sessionId: string): void {
    _clearSdkSessionId(this.db, sessionId);
  }

  // ============ SOUL METHODS ============

  setSoulAspect(aspect: string, content: string): number {
    return _setSoulAspect(this.db, aspect, content, this.soulCache);
  }

  getSoulAspect(aspect: string): SoulAspect | null {
    return _getSoulAspect(this.db, aspect);
  }

  getAllSoulAspects(): SoulAspect[] {
    return _getAllSoulAspects(this.db);
  }

  deleteSoulAspect(aspect: string): boolean {
    return _deleteSoulAspect(this.db, aspect, this.soulCache);
  }

  deleteSoulAspectById(id: number): boolean {
    return _deleteSoulAspectById(this.db, id, this.soulCache);
  }

  updateSoulAspect(id: number, fields: { aspect?: string; content?: string }): boolean {
    return _updateSoulAspect(this.db, id, fields, this.soulCache);
  }

  getSoulContext(): string {
    return _getSoulContext(this.db, this.soulCache);
  }

  getSoulMemoryUsage(): { usedChars: number; budgetChars: number; pct: number } {
    return _getSoulMemoryUsage(this.db);
  }

  getDailyLogsMemoryUsage(days: number = 3): {
    usedChars: number;
    budgetChars: number;
    pct: number;
  } {
    return _getDailyLogsMemoryUsage(this.db, days);
  }

  // ============ EXPORT ============

  exportMemory(): import('./export').MemoryExport {
    return _exportMemory(this.db);
  }

  exportMemoryMarkdown(): string {
    return _exportMemoryMarkdown(_exportMemory(this.db));
  }

  // ============ MEMORY META (key/value bookkeeping) ============

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM memory_meta WHERE key = ?').get(key) as
      | { value: string | null }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO memory_meta (key, value, updated_at)
         VALUES (?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value);
  }

  // ============ CONSOLIDATION ============

  async consolidateMemory(
    opts: {
      force?: boolean;
      reflect?: boolean;
    } = {}
  ): Promise<{
    ran: boolean;
    factsDeleted: number;
    factsAdded: number;
    soulDeleted: number;
    soulAdded: number;
  }> {
    const { consolidateMemory } = await import('./consolidation');
    return consolidateMemory(this, opts);
  }

  close(): void {
    this.db.close();
  }
}

export { MemoryManager as MemoryStore };
