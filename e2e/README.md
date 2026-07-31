# E2E tests

Real, full end-to-end tests for the Electron app — launches the actual compiled app
(`electron .`, same as `npm run electron`) via Playwright's `_electron` API and drives it
through onboarding, client/project creation, the Brain (memory) panel, analytics, and
Settings > MCP. See `../docs/e2e/PLAN.md` for the original recon/design notes; this file is
the day-to-day "how do I run this" doc.

**Separate from the unit suite on purpose** — `vitest.config.ts` only globs
`tests/**/*.test.ts`; `e2e/playwright.config.ts` only globs `e2e/specs/**/*.spec.ts`. Neither
can pick up the other's files, and `npm run lint`/`tsc --noEmit` only touch `src/`.

## Running it

```bash
npm run test:e2e            # builds the app, rebuilds better-sqlite3 for Electron's ABI, runs all specs
npm run test:e2e:headed     # same, with --headed (mostly useful for local debugging/tracing)
```

`test:e2e` has a `pretest:e2e` hook that builds (`tsc` + preload + `fix-esm-imports` +
`copy-seed-assets`) and rebuilds the native module, and a `posttest:e2e` hook that switches
`better-sqlite3` back to Node's ABI afterward — so running `npm run test:e2e` then
`npx vitest run` right after just works, no manual rebuild step needed. If you ever need to
do it by hand:

```bash
npm run build                              # compile dist/
npx electron-rebuild -f -w better-sqlite3  # Electron's ABI (needed to launch the real app)
npx playwright test --config e2e/playwright.config.ts
node scripts/check-native-node.cjs         # switch back to Node's ABI for the unit suite
```

Why the ABI dance: `better-sqlite3` is a native addon compiled per-runtime. The unit suite
runs under plain Node; launching the real Electron app needs the addon compiled for
Electron's ABI instead. Both `scripts/check-native.cjs` (used by `npm run electron`) and
`scripts/check-native-node.cjs` (used by the unit suite's `pretest`) share a per-ABI binary
cache (`scripts/native-cache.cjs`), so switching back and forth after the first rebuild of
each side is a fast file copy, not a full native rebuild.

## What's covered

| Spec | Covers |
|---|---|
| `app-launch.spec` | True first run: window opens, no fatal main-process error, no uncaught renderer exception, onboarding renders. |
| `onboarding.spec` | Walks every onboarding step that needs no live credentials (Welcome → Keychain → Permissions → Auth); documents + explicitly skips the live-credentialed completion (see below); exercises the app's own real completion path so the rest of the suite has a legitimate way past onboarding. |
| `clients-projects.spec` | Create a client + a project under it via the real picker UI, select it, close + relaunch the app against the same profile, requery and confirm both persisted. |
| `memory-brain.spec` | Capture a fact in a client's Brain scope, confirm it renders + round-trips through the real IPC contract, confirm switching to Personal does NOT leak it (scope isolation). |
| `analytics.spec` | Record a snapshot via the real "Record snapshot" form; extend it with `media_urls`/`top_comments` via the same `window.pocketAgent.analytics.record` contract the form itself calls (no UI field exists for those two yet) and confirm they round-trip. |
| `mcp.spec` | Settings > MCP Servers lists the catalog including `electron-mcp-server`; toggle it on; confirm a toggled server's enabled flag survives a full app restart. |

Every spec asserts real DOM state and/or real persisted state via `window.pocketAgent.*`
queries — not screenshots.

## Onboarding and live credentials

The onboarding auth step requires either a real Anthropic/OpenAI OAuth session (opens an
external browser) or an API key that's live-validated over the network
(`settings:validateAnthropic` etc.). **There is no credential test double in this app**, so
`onboarding.spec` does not attempt to complete that step through the UI — it verifies both
paths are reachable, then declares a genuine `test.skip(...)` for the actual live-credential
completion, with the reason as a skip annotation. It shows up as a real "skipped" test in
Playwright's own report (not silently omitted, not faked as a pass) rather than faking it.

To reach a usable post-onboarding state for the other specs,
`e2e/fixtures/electron-app.ts`'s `bypassOnboardingToUsableState()` writes a placeholder
`anthropic.apiKey` through the real settings IPC (the same call the UI makes;
`hasRequiredKeys()` only checks *presence*, live validation only gates the UI's Continue
button) and then calls `obFinishSetup()` — the exact global function the wizard's own
"Finish" button invokes. This runs real app code end to end (settings write, DOM teardown,
`initializeChatAfterOnboarding()` → `cvLaunch()`) — not a manually toggled class or a
skipped code path.

## State isolation

Every spec file gets its own `fs.mkdtempSync` profile directory passed as
`--user-data-dir` (the standard Electron/Chromium switch) — a fresh DB, `world/`,
`clients/`, `plugins/`, and settings store per file, never the developer's real profile.
Tests within one file share that single launched app and run in declared order
(`test.describe.configure({ mode: 'serial' })`); `clients-projects.spec` and `mcp.spec`
explicitly close + relaunch the SAME profile dir mid-file to prove on-disk persistence, not
just in-memory renderer state. Every file removes its tmp dir in `afterAll` (best-effort).

## A note on the live marketplace packs during "restart" tests

`atelier`/`salon` are live marketplace packs (`src/marketplace/registry.ts`'s `PACK_SOURCES`)
that self-update from their real GitHub repos in the background on every launch
(`PackSyncManager.checkAndUpdate()`, fire-and-forget). `electron-mcp-server` was added to the
bundled seed as part of this session's work and may not exist upstream yet — on a machine
with real internet access, a background refresh landing during a restart could legitimately
replace it with whatever the real `lama-assaf/atelier` repo currently has, independent of
anything this suite does. `mcp.spec`'s restart-persistence check therefore uses
`atelier:filesystem` (a long-standing, stable catalog entry) instead, and reads the `enabled`
boolean via the real IPC contract rather than depending on any one entry's UI status text.

## Known limitations

- No true "headless" mode: Electron always creates a real `BrowserWindow`; there's no
  Chromium-style headless flag that applies here. `--headed` is accepted for parity/local
  debugging but the window renders the same either way.
- `npm run test:e2e` needs real network access for the very first `electron-rebuild` if
  prebuilt binaries for this Electron version + platform/arch aren't already cached locally.
