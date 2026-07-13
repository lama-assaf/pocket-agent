/**
 * Client (brand) records: the persistence layer for shared memory scopes.
 *
 * A client is a brand the agency works with. Selecting it in the UI scopes
 * memory to `client:<id>` with World as its base. This module owns only the
 * SQLite row; on-disk brains and sync live under src/clients/ (Phase 1+).
 */

import type Database from 'better-sqlite3';

export type ClientSyncMode = 'live' | 'manual';

export interface Client {
  id: string;
  name: string;
  sync_mode: ClientSyncMode;
  repo_url: string | null;
  /** ISO timestamp of the last successful pull (clone or fetch+merge), or null if never pulled. */
  last_pulled_at: string | null;
  /** ISO timestamp of the last successful push (a commit actually landed on the remote), or null if never pushed. */
  last_pushed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** List all clients, most recently updated first. */
export function getClients(db: Database.Database): Client[] {
  return db
    .prepare(
      `SELECT id, name, sync_mode, repo_url, last_pulled_at, last_pushed_at, created_at, updated_at
       FROM clients
       ORDER BY updated_at DESC`
    )
    .all() as Client[];
}

/** Get a single client by id, or null when it doesn't exist. */
export function getClient(db: Database.Database, id: string): Client | null {
  const row = db
    .prepare(
      `SELECT id, name, sync_mode, repo_url, last_pulled_at, last_pushed_at, created_at, updated_at
       FROM clients WHERE id = ?`
    )
    .get(id) as Client | undefined;
  return row ?? null;
}

/**
 * Create a client. `id` is a stable slug used as the `client:<id>` scope key and
 * the on-disk checkout folder; it must not change once memory is attributed to it.
 */
export function createClient(
  db: Database.Database,
  input: { id: string; name: string; syncMode?: ClientSyncMode; repoUrl?: string | null }
): Client {
  const existing = getClient(db, input.id);
  if (existing) throw new Error(`Client "${input.id}" already exists`);
  db.prepare(
    `INSERT INTO clients (id, name, sync_mode, repo_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))`
  ).run(input.id, input.name, input.syncMode ?? 'live', input.repoUrl ?? null);
  return getClient(db, input.id)!;
}

/** Update a client's mutable fields. Returns true when a row changed. */
export function updateClient(
  db: Database.Database,
  id: string,
  fields: { name?: string; syncMode?: ClientSyncMode; repoUrl?: string | null }
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.syncMode !== undefined) {
    sets.push('sync_mode = ?');
    values.push(fields.syncMode);
  }
  if (fields.repoUrl !== undefined) {
    sets.push('repo_url = ?');
    values.push(fields.repoUrl);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  const result = db.prepare(`UPDATE clients SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

/** Delete a client row. Returns true when a row was removed. */
export function deleteClient(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM clients WHERE id = ?').run(id).changes > 0;
}

/**
 * Stamp a client's last-pulled timestamp (roadmap item 9 — sync status).
 * Called by sync:pull on a successful pull (clone or fetch+merge) and by the
 * on-launch auto-pull for 'live' clients, so the UI can show "last pulled"
 * and flag a client as stale.
 */
export function touchClientPulled(
  db: Database.Database,
  id: string,
  isoTimestamp: string = new Date().toISOString()
): boolean {
  const result = db
    .prepare('UPDATE clients SET last_pulled_at = ? WHERE id = ?')
    .run(isoTimestamp, id);
  return result.changes > 0;
}

/** Stamp a client's last-pushed timestamp. Called by sync:publish after an actual push. */
export function touchClientPushed(
  db: Database.Database,
  id: string,
  isoTimestamp: string = new Date().toISOString()
): boolean {
  const result = db
    .prepare('UPDATE clients SET last_pushed_at = ? WHERE id = ?')
    .run(isoTimestamp, id);
  return result.changes > 0;
}
