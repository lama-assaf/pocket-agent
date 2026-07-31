/**
 * Non-mock helpers shared by the scripted-conversation eval scenarios.
 * Deliberately contains no `vi.mock(...)` — mock declarations are hoisted
 * per test FILE in Vitest, so they can't live in a shared imported module;
 * every scenario file declares its own (see scripted-conversations.eval.test.ts).
 * This module only wires up the REAL MemoryManager/session plumbing every
 * scenario needs, so that boilerplate isn't repeated per scenario `it`.
 */
import type { MemoryManager } from '../../src/memory/index';
import { setMemoryManager } from '../../src/tools/memory-tools';
import { setCurrentSessionId } from '../../src/tools/session-context';
import type { SessionContext } from '../../src/memory/sessions';

/** A fresh in-memory MemoryManager, registered as the active manager for the tools that read it via getMemoryManager(). */
export async function createEvalMemory(): Promise<MemoryManager> {
  const { MemoryManager: MM } = await import('../../src/memory/index');
  const memory = new MM(':memory:');
  setMemoryManager(memory);
  return memory;
}

/**
 * Create a session with the given selected context (personal/world/client/
 * project) and make it the active session for the current async context —
 * every real tool handler resolves scope from `getCurrentSessionId()` +
 * `memory.getSessionContext(id)`, so this is what actually makes a scenario
 * "client A's conversation" vs "a personal conversation".
 */
export function createEvalSession(
  memory: MemoryManager,
  name: string,
  context: SessionContext
): string {
  const session = memory.createSession(name, 'general', null);
  setCurrentSessionId(session.id);
  if (context.contextType !== 'personal') {
    memory.setSessionContext(session.id, context);
  }
  return session.id;
}

export function personalContext(): SessionContext {
  return { contextType: 'personal', clientId: null, projectKey: null };
}

export function clientContext(clientId: string): SessionContext {
  return { contextType: 'client', clientId, projectKey: null };
}

export function worldContext(): SessionContext {
  return { contextType: 'world', clientId: null, projectKey: null };
}
