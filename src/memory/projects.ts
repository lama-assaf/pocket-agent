/**
 * Project records: a lightweight sub-scope under a client (brand).
 *
 * A project groups memory beneath a client. Its scope key is `project:<id>`,
 * inheriting the client + world scopes (see resolveVisibleScopes in ./scope).
 * The `id` doubles as the stable `project_key` stored on sessions — it must not
 * change once memory is attributed to it. The `working_directory` is an optional
 * linked directory for coder work; it is a link, not the project's identity.
 *
 * This module owns only the SQLite row (mirrors ./clients). On-disk scaffolding
 * lives under src/clients/ and the IPC layer.
 */

import type Database from 'better-sqlite3';

export interface Project {
  id: string;
  client_id: string;
  name: string;
  working_directory: string | null;
  created_at: string;
  updated_at: string;
}

/** List a client's projects, most recently updated first. */
export function getProjects(db: Database.Database, clientId: string): Project[] {
  return db
    .prepare(
      `SELECT id, client_id, name, working_directory, created_at, updated_at
       FROM projects
       WHERE client_id = ?
       ORDER BY updated_at DESC`
    )
    .all(clientId) as Project[];
}

/** Get a single project by id, or null when it doesn't exist. */
export function getProject(db: Database.Database, id: string): Project | null {
  const row = db
    .prepare(
      `SELECT id, client_id, name, working_directory, created_at, updated_at
       FROM projects WHERE id = ?`
    )
    .get(id) as Project | undefined;
  return row ?? null;
}

/**
 * Create a project under a client. `id` is a stable slug used as the
 * `project:<id>` scope key and the `project_key` on sessions; it must not change
 * once memory is attributed to it. Throws when the id already exists or the
 * parent client is unknown (a project must belong to exactly one client).
 */
export function createProject(
  db: Database.Database,
  input: { id: string; clientId: string; name: string; workingDirectory?: string | null }
): Project {
  const existing = getProject(db, input.id);
  if (existing) throw new Error(`Project "${input.id}" already exists`);
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(input.clientId) as
    | { id: string }
    | undefined;
  if (!client) throw new Error(`Unknown client "${input.clientId}"`);
  db.prepare(
    `INSERT INTO projects (id, client_id, name, working_directory, created_at, updated_at)
     VALUES (?, ?, ?, ?, (strftime('%Y-%m-%dT%H:%M:%fZ')), (strftime('%Y-%m-%dT%H:%M:%fZ')))`
  ).run(input.id, input.clientId, input.name, input.workingDirectory ?? null);
  return getProject(db, input.id)!;
}

/** Update a project's mutable fields. Returns true when a row changed. */
export function updateProject(
  db: Database.Database,
  id: string,
  fields: { name?: string; workingDirectory?: string | null }
): boolean {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.workingDirectory !== undefined) {
    sets.push('working_directory = ?');
    values.push(fields.workingDirectory);
  }
  if (sets.length === 0) return false;
  sets.push("updated_at = (strftime('%Y-%m-%dT%H:%M:%fZ'))");
  values.push(id);
  const result = db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  return result.changes > 0;
}

/** Delete a project row. Returns true when a row was removed. */
export function deleteProject(db: Database.Database, id: string): boolean {
  return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
}
