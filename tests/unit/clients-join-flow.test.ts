/**
 * Join flow (roadmap item 9): pasting a setup string creates the client row
 * correctly. Exercises the exact sequence src/main/ipc/settings-ipc.ts's
 * `clients:join` handler runs — decode -> reject-if-duplicate ->
 * memory.createClient -> ensureClientScaffold — directly against a real
 * MemoryManager and a tmp clients root, so the DB/filesystem outcomes are
 * verified without needing to mock Electron's ipcMain or the handler's
 * unrelated dependencies (getWindow, AgentManager, telegram, etc.).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodeClientSetupString, decodeClientSetupString } from '../../src/clients/setup-string';
import { ensureClientScaffold } from '../../src/clients/registry';
import { setClientsRoot, clientPaths } from '../../src/clients/paths';

// Stub only the async embedding writes so MemoryManager needs no embedding model.
vi.mock('../../src/memory/semantic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/memory/semantic')>();
  return {
    ...actual,
    embedFactAsync: vi.fn(),
    embedSoulAspectAsync: vi.fn(),
    backfillMissingEmbeddings: vi.fn(async () => {}),
  };
});

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pocket-agent-join-test-'));
  setClientsRoot(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Mirrors the clients:join IPC handler's logic exactly (decode, reject
 * duplicate, createClient, scaffold) minus the pull step, which is exercised
 * separately via sync-manager's own tests (pullBrainRepo soft no-op /
 * clone/pull paths) — join-flow correctness here is about the client ROW,
 * not the git transport.
 */
async function runJoinFlow(
  memory: import('../../src/memory/index').MemoryManager,
  setupString: string
): Promise<{ success: boolean; client?: import('../../src/memory/index').Client; error?: string }> {
  const decoded = decodeClientSetupString(setupString);
  if (!decoded.ok || !decoded.payload) {
    return { success: false, error: decoded.error || 'Invalid setup string' };
  }
  const { id, name, repoUrl, syncMode } = decoded.payload;

  if (memory.getClient(id)) {
    return { success: false, error: `You already have a client "${id}" — nothing to join.` };
  }

  try {
    const client = memory.createClient({ id, name, syncMode, repoUrl });
    ensureClientScaffold(client.id);
    return { success: true, client };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

describe('join flow — creates the client row correctly', () => {
  it('creates a client row matching the decoded setup string', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const setupString = encodeClientSetupString({
      id: 'acme',
      name: 'Acme Co',
      repoUrl: 'https://github.com/acme/brain.git',
      syncMode: 'live',
    });

    const result = await runJoinFlow(memory, setupString);
    expect(result.success).toBe(true);
    expect(result.client).toMatchObject({
      id: 'acme',
      name: 'Acme Co',
      repo_url: 'https://github.com/acme/brain.git',
      sync_mode: 'live',
    });

    const stored = memory.getClient('acme');
    expect(stored).toMatchObject({ id: 'acme', name: 'Acme Co', repo_url: 'https://github.com/acme/brain.git' });
    memory.close();
  });

  it('materializes the on-disk brain scaffold for the joined client', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const setupString = encodeClientSetupString({
      id: 'acme',
      name: 'Acme Co',
      repoUrl: 'https://github.com/acme/brain.git',
    });

    await runJoinFlow(memory, setupString);

    const paths = clientPaths('acme');
    expect(fs.existsSync(paths.memoryDir)).toBe(true);
    expect(fs.existsSync(paths.guardrailsDir)).toBe(true);
    memory.close();
  });

  it('respects the setup string\u2019s syncMode (manual)', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const setupString = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
      syncMode: 'manual',
    });

    const result = await runJoinFlow(memory, setupString);
    expect(result.client?.sync_mode).toBe('manual');
    memory.close();
  });

  it('rejects joining a client id that already exists locally (never overwrites)', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');
    memory.createClient({ id: 'acme', name: 'Existing Acme', repoUrl: 'https://old-repo' });

    const setupString = encodeClientSetupString({
      id: 'acme',
      name: 'Acme Co (from teammate)',
      repoUrl: 'https://github.com/acme/brain.git',
    });

    const result = await runJoinFlow(memory, setupString);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already have/i);

    // The original client is untouched.
    const stored = memory.getClient('acme');
    expect(stored?.name).toBe('Existing Acme');
    expect(stored?.repo_url).toBe('https://old-repo');
    memory.close();
  });

  it('rejects a malformed setup string without creating any client row', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const result = await runJoinFlow(memory, 'not a valid setup string');
    expect(result.success).toBe(false);
    expect(memory.getClients()).toEqual([]);
    memory.close();
  });

  it('a freshly joined client has null last_pulled_at/last_pushed_at until synced', async () => {
    const { MemoryManager } = await import('../../src/memory/index');
    const memory = new MemoryManager(':memory:');

    const setupString = encodeClientSetupString({
      id: 'acme',
      name: 'Acme',
      repoUrl: 'https://github.com/acme/brain.git',
    });
    const result = await runJoinFlow(memory, setupString);
    expect(result.client?.last_pulled_at).toBeNull();
    expect(result.client?.last_pushed_at).toBeNull();
    memory.close();
  });
});
