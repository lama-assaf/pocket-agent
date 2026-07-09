import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/settings', () => ({
  SettingsManager: {
    get: vi.fn(),
    getArray: vi.fn(),
    set: vi.fn(),
  },
}));

import { getAtelierMemoryTools } from '../../src/tools/atelier-memory-tools';

describe('memory_init tool', () => {
  it('exposes a memory_init tool with a handler', () => {
    const tools = getAtelierMemoryTools();
    const init = tools.find((t) => t.name === 'memory_init');
    expect(init).toBeDefined();
    expect(typeof init!.handler).toBe('function');
  });
});
