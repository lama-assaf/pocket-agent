/**
 * Projects: a lightweight sub-scope under a client.
 *
 * Covers the load-bearing guarantees for client-first workspaces:
 *  1. CRUD (create / read / update / delete) mirrors clients.
 *  2. A project belongs to exactly one client (FK integrity on create).
 *  3. The scope key is `project:<id>` (feeds resolveVisibleScopes).
 *  4. setSessionContext rejects a project that doesn't belong to the client.
 */

import { describe, it, expect, vi } from 'vitest';
import { projectScope } from '../../src/memory/scope';

// Keep the real recall/scoring functions; stub only the async embedding writes so
// MemoryManager construction doesn't spin up the embedding model in tests.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

describe('project scope key', () => {
  it('is project:<id>', () => {
    expect(projectScope('site')).toBe('project:site');
    expect(projectScope('brand-2026')).toBe('project:brand-2026');
  });
});

describe('projects CRUD (MemoryManager)', () => {
  it('creates, reads, updates, and deletes a project under a client', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    memory.createClient({ id: 'acme', name: 'Acme' });

    const created = memory.createProject({
      id: 'site',
      clientId: 'acme',
      name: 'Website',
      workingDirectory: '/tmp/acme-site',
    });
    expect(created.id).toBe('site');
    expect(created.client_id).toBe('acme');
    expect(created.name).toBe('Website');
    expect(created.working_directory).toBe('/tmp/acme-site');

    // Read by id and by client.
    expect(memory.getProject('site')?.name).toBe('Website');
    expect(memory.getProjects('acme').map((p) => p.id)).toEqual(['site']);

    // Update mutable fields.
    expect(memory.updateProject('site', { name: 'Marketing Site' })).toBe(true);
    expect(memory.getProject('site')?.name).toBe('Marketing Site');
    expect(memory.updateProject('site', { workingDirectory: null })).toBe(true);
    expect(memory.getProject('site')?.working_directory).toBeNull();

    // Delete.
    expect(memory.deleteProject('site')).toBe(true);
    expect(memory.getProject('site')).toBeNull();
    expect(memory.getProjects('acme')).toEqual([]);
    memory.close();
  });

  it("lists only a given client's projects (isolation by client)", async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    memory.createClient({ id: 'acme', name: 'Acme' });
    memory.createClient({ id: 'globex', name: 'Globex' });
    memory.createProject({ id: 'acme-site', clientId: 'acme', name: 'Site' });
    memory.createProject({ id: 'globex-app', clientId: 'globex', name: 'App' });

    expect(memory.getProjects('acme').map((p) => p.id)).toEqual(['acme-site']);
    expect(memory.getProjects('globex').map((p) => p.id)).toEqual(['globex-app']);
    memory.close();
  });

  it('rejects a project whose parent client does not exist (FK integrity)', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    expect(() => memory.createProject({ id: 'orphan', clientId: 'ghost', name: 'X' })).toThrow(
      /Unknown client/
    );
    memory.close();
  });

  it('rejects a duplicate project id', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    memory.createClient({ id: 'acme', name: 'Acme' });
    memory.createProject({ id: 'site', clientId: 'acme', name: 'Site' });
    expect(() => memory.createProject({ id: 'site', clientId: 'acme', name: 'Again' })).toThrow(
      /already exists/
    );
    memory.close();
  });
});

describe('setSessionContext project integrity', () => {
  it('accepts a project that belongs to the selected client', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    memory.createClient({ id: 'acme', name: 'Acme' });
    memory.createProject({ id: 'site', clientId: 'acme', name: 'Site' });
    const session = memory.createSession('Chat with Acme');

    expect(
      memory.setSessionContext(session.id, {
        contextType: 'project',
        clientId: 'acme',
        projectKey: 'site',
      })
    ).toBe(true);

    const ctx = memory.getSessionContext(session.id);
    expect(ctx.contextType).toBe('project');
    expect(ctx.clientId).toBe('acme');
    expect(ctx.projectKey).toBe('site');
    memory.close();
  });

  it('rejects a project that belongs to a different client', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    memory.createClient({ id: 'acme', name: 'Acme' });
    memory.createClient({ id: 'globex', name: 'Globex' });
    memory.createProject({ id: 'site', clientId: 'acme', name: 'Site' });
    const session = memory.createSession('Mismatch');

    expect(() =>
      memory.setSessionContext(session.id, {
        contextType: 'project',
        clientId: 'globex',
        projectKey: 'site',
      })
    ).toThrow(/does not belong/);
    memory.close();
  });

  it('rejects an unknown project', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    memory.createClient({ id: 'acme', name: 'Acme' });
    const session = memory.createSession('Ghost project');
    expect(() =>
      memory.setSessionContext(session.id, {
        contextType: 'project',
        clientId: 'acme',
        projectKey: 'nope',
      })
    ).toThrow(/Unknown project/);
    memory.close();
  });
});
