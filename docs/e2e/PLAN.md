# E2E test harness — plan

## Recon findings

- **Unit suite**: `vitest.config.ts` globs `tests/**/*.test.ts` only, `environment: 'node'`, and
  explicitly excludes `src/main/index.ts` from coverage with the comment
  *"Electron main process - requires e2e testing"*. There is no Playwright/Spectron/WebdriverIO
  config anywhere in the repo, and `tests/manual/test-session-scoped.ts` is a standalone
  `ts-node` script, not part of any automated run. **No e2e suite exists today.**
- **App shape**: Electron `41.6.1`, `"type": "module"`, `"main": "dist/main/index.js"`. Build
  is `tsc && tsc -p tsconfig.preload.json && fix-esm-imports.cjs && copy-seed-assets.cjs` — the
  compiled `dist/` tree is what actually runs (`electron .` reads `dist/main/index.js`). There is
  **no packaged installer step** in the loop we need (`electron-builder` is for `npm run dist`
  only — out of scope here).
- **Tray-resident app, not a normal window app**: `app.on('window-all-closed')` is a no-op
  (`// Keep running (tray app)`) and `whenReady()` only calls `openChatWindow()` automatically
  when `SettingsManager.isFirstRun()` is true. On a **non-first-run** launch the app starts with
  **zero windows** — a real user opens it via the tray icon, Dock click (`activate`), or the
  global `Alt+Z` shortcut. This directly shapes the harness: reaching "a window exists" for
  anything past onboarding requires either (a) staying on the very first launch (window opens
  automatically because `isFirstRun()` is true), or (b) completing onboarding *within that same
  window* so the renderer's own `cvLaunch()` transition runs in-process — never a second
  detached relaunch with no window.
- **Onboarding gate needs live credentials**: `ob-step-auth` requires either Anthropic/OpenAI
  OAuth (opens a real external browser + waits for a pasted code) or an API key that the
  "Continue" button live-validates via `settings:validateAnthropic` → a real network call to
  Anthropic. **No test double exists for this in the app.** Full click-through completion of
  onboarding cannot be automated headlessly without real, working credentials. See "Onboarding"
  spec section below for how this is handled without faking anything.
- **IPC contract**: `src/main/preload.ts` exposes `window.pocketAgent.*` (agent, clients,
  projects, facts, marketplace, mcp, content, campaigns, analytics, settings, …), fully typed.
  This is the stable, versioned surface the harness drives through — either by clicking real DOM
  controls that call these methods, or (only where no UI path exists, e.g. `media_urls` /
  `top_comments` on an analytics snapshot) by calling `window.pocketAgent.*` directly via
  `page.evaluate`, which is the *same* contract the UI itself uses, not a backdoor.
- **Native module ABI**: `better-sqlite3` is compiled per-runtime. The unit suite's
  `pretest`/`check-native-node.cjs` keeps it on Node's ABI; launching the real Electron app needs
  Electron's ABI instead (`scripts/check-native.cjs` / `electron-rebuild`). Both scripts already
  share a per-ABI binary cache (`scripts/native-cache.cjs`) so switching is a fast file copy after
  the first rebuild of each side — the e2e scripts reuse this exact mechanism, never a bespoke one.

## Tooling choice

**Playwright's `_electron` API**, via `@playwright/test` (pinned `1.60.0`, matching the
`playwright-core` version already resolved in `package-lock.json` from an existing transitive
dependency — no new browser binaries to download, since Electron testing drives the app's own
bundled Chromium/Node, not a Playwright-managed browser). This is the standard, actively
maintained fit for Electron e2e (`electronApp = await electron.launch(...)`,
`electronApp.firstWindow()`, `electronApp.evaluate()` for main-process assertions, native
`dialog.*` stubbing). No concrete blocker was found — Electron 41 is well above Playwright's
supported `v14+` floor.

## Folder layout

```
e2e/
  playwright.config.ts     # separate from vitest.config.ts — own `testDir`, own timeouts
  fixtures/
    electron-app.ts        # launch/relaunch helpers, isolated tmp userData dir, onboarding bypass
  specs/
    app-launch.spec.ts
    onboarding.spec.ts
    clients-projects.spec.ts
    memory-brain.spec.ts
    analytics.spec.ts
    mcp.spec.ts
  README.md                # how to run locally (supersedes this plan doc once green)
```

`playwright.config.ts` only globs `e2e/specs/**/*.spec.ts` — vitest's config only globs
`tests/**/*.test.ts` and `eslint`/`tsc --noEmit` only touch `src/`, so the two suites can never
pick up each other's files.

## App launch under test

- `_electron.launch({ args: ['.', '--user-data-dir=' + tmpDir], cwd: repoRoot })` — mirrors
  `npm run electron`'s `electron .`, plus the standard Chromium/Electron `--user-data-dir` switch
  (confirmed via Electron's own issue tracker/community docs as the standard override —
  `app.getPath('userData')` resolves from it once Electron's own arg parsing has run, which is
  before `app.whenReady()` calls `app.getPath('userData')` in `src/main/index.ts`).
- Runs against **the compiled `dist/` tree** — `npm run test:e2e` builds first
  (`tsc && preload && fix-esm-imports && copy-seed-assets`), exactly the real app's build.

## State isolation

- Every spec **file** gets its own fresh `fs.mkdtempSync` directory passed as
  `--user-data-dir`, so each file gets an independent DB (`pocket-agent.db`), `world/`,
  `clients/`, `plugins/`, and settings store — never the developer's real profile, never shared
  across spec files. Electron's single-instance lock is itself keyed off the profile directory,
  so distinct tmp dirs also means no lock contention between spec files.
- Within one spec file, tests share the one launched app (fast, and lets
  "create → reopen/requery" persistence tests close and relaunch **the same** tmp dir to prove
  durability) — each file's tests run in declared (serial) order via
  `test.describe.configure({ mode: 'serial' })`.
- Every spec file removes its tmp dir in an `afterAll` (best-effort; never fails the run).

## What each spec covers

| Spec | Covers |
|---|---|
| `app-launch.spec` | True first run: process launches, main window opens, no uncaught main-process exceptions, onboarding renders. |
| `onboarding.spec` | First-run screen content; step navigation through the non-credentialed steps (name/location/occupation/etc.); **explicitly skips** the live-credential completion sub-case with a stated reason; documents+exercises the app's own real `obFinishSetup()` completion path (same code a real user's "Finish" click runs) once a placeholder key is present, so the rest of the suite has a legitimate way to reach a post-onboarding state. |
| `clients-projects.spec` | Create a client via the real picker UI, create a project under it, select it, close + relaunch the app against the same profile dir, requery and assert both still exist. |
| `memory-brain.spec` | Capture a `how_to_act`/fact entry in a client scope via the Brain panel UI; assert it renders back; switch scope to Personal and assert the client-scoped fact does not leak in. |
| `analytics.spec` | Record a snapshot via the real "Record snapshot" form, then extend it with `media_urls`/`top_comments` via the same `window.pocketAgent.analytics.record` contract the form itself calls (no UI field exists for those two yet); assert it's listed and the fields round-trip. |
| `mcp.spec` | Open Settings → MCP Servers, assert the catalog lists servers incl. `electron-mcp-server`, toggle one on, close+reopen the panel (and relaunch) to assert the enabled state persisted. |

Each spec asserts real DOM state (`locator.textContent`/`isVisible`) and, where it matters more
than pixels, real persisted state via `window.pocketAgent.*` queries run in `page.evaluate` —
never screenshot-diffing as the primary assertion.
