// e2e/playwright.config.ts
// SEPARATE from vitest.config.ts on purpose: this suite drives the real,
// compiled Electron app (see e2e/README.md for the build/ABI prerequisites),
// not in-process unit tests. Vitest only globs `tests/**/*.test.ts`; this
// config only globs `e2e/specs/**/*.spec.ts` — the two can never collide.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  // Electron app launch + a full onboarding/UI walk per spec file is
  // meaningfully slower than a browser page load — give it room.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Each spec file launches its own isolated Electron instance (see
  // fixtures/electron-app.ts) and internally runs its tests in serial order —
  // running spec FILES in parallel is safe (independent tmp userData dirs)
  // but keep it conservative locally by default; CI can raise --workers.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
