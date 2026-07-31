# Dev setup: native modules (better-sqlite3) and CI caching

## Supported Node.js version

This repo's `engines.node` field (`package.json`) requires **Node.js 22 or 24** — both current LTS
lines. Node 23 and 25 are deliberately excluded: they're odd-numbered, non-LTS "Current" releases
that reach end-of-life quickly (23 already has), and several dependencies (ESLint, Vitest) refuse
to install under them regardless of what this repo's own `engines` field says, so using one still
produces `npm warn EBADENGINE` noise from deep in `node_modules` even if you silence ours. Install
a supported version with [nvm](https://github.com/nvm-sh/nvm)/[fnm](https://github.com/Schniz/fnm)/
[volta](https://volta.sh): `nvm install 22 && nvm use 22`.

`better-sqlite3` is the one native (compiled C++) dependency in this repo, and it's the most
common source of a confusing local/CI failure: **`NODE_MODULE_VERSION` mismatch** — "The module
was compiled against a different Node.js version". The rest of this doc explains why, what
already handles it automatically, and the exact commands for when it doesn't.

## Why this happens

A native addon (the `.node` file under `node_modules/better-sqlite3/build/Release/`) is compiled
against one specific ABI (`NODE_MODULE_VERSION`), not "Node 22" in general. This repo runs on
**two different runtimes that don't share an ABI**:

- **Electron** (`npm run electron`, `npm run dev`, the packaged app) — Electron bundles its own
  Node with its own ABI, different from your system Node even at the same "Node 22" major version.
- **Plain Node** (`npm test` / Vitest, this repo's CLI-style scripts) — your system Node's own ABI.

node-gyp/prebuild-install only keep **one** compiled copy in `build/Release`, so switching between
`npm run electron` and `npm test` used to force a full recompile every time, and a stale build
throws `NODE_MODULE_VERSION`/`was compiled against a different...` at the first `new Database(...)`
call (never at `require()` time — see `scripts/native-check-lib.cjs`'s doc comment).

## What already happens automatically (no action needed most of the time)

1. **`npm install`/`npm ci` almost never compiles from source.** better-sqlite3's own `install`
   script runs `prebuild-install`, which downloads a prebuilt binary matching your exact
   platform/arch/ABI from better-sqlite3's GitHub releases, and only falls back to a from-source
   `node-gyp rebuild` if no matching prebuild exists. This repo doesn't need to vendor or publish
   its own prebuilt binaries — better-sqlite3 already ships them upstream.
2. **`postinstall` rebuilds for Electron's ABI** (`npx electron-rebuild -f -w better-sqlite3`).
   `@electron/rebuild` also prefers a prebuild-install-fetched binary for Electron's ABI over a
   from-source compile — it only compiles when no matching Electron prebuild exists for your
   platform/arch.
3. **A per-ABI local cache makes switching fast after the first build of each side**
   (`scripts/native-cache.cjs`): once `better_sqlite3.node` has been built/fetched for a given
   `(ABI, platform, arch)`, it's copied into `node_modules/.native-cache/` (gitignored, per
   machine). `npm run electron`'s `preelectron` hook (`scripts/check-native.cjs`) and the test
   suite's `pretest` hook (`scripts/check-native-node.cjs`) both check whether the *currently
   installed* addon actually opens a database under their runtime; on a mismatch they restore
   from this cache (a fast file copy) before falling back to a real rebuild. So the sequence
   `npm run electron` → `npm test` → `npm run electron` → ... only pays the compile/download cost
   once per side, not on every switch.

In practice: a normal `npm install` + `npm run dev` + `npm test` loop should never require a
manual native rebuild.

## Exact commands (when it still breaks)

```bash
# Tests fail with NODE_MODULE_VERSION / "was compiled against a different Node.js version":
npm rebuild better-sqlite3          # rebuilds for your current (plain Node) runtime
npm test                            # pretest hook will also self-heal this automatically

# npm run electron / npm run dev fails the same way:
npx electron-rebuild -f -w better-sqlite3   # same as `npm run rebuild:native`
npm run electron

# Nuclear option — wipe the per-ABI cache and node_modules, reinstall clean:
rm -rf node_modules
npm install                         # triggers prebuild-install + postinstall's electron-rebuild
```

`npm run rebuild:native` is a shortcut for the `electron-rebuild` command above.

## CI caching

Two workflows install dependencies:

- **`.github/workflows/ci.yml`** (`verify` job — runs `npm run verify` on PRs/pushes to `main`,
  Node ABI only): caches `~/.npm` via `actions/setup-node`'s `cache: 'npm'` (so a matching
  prebuild-install download is a cache hit, not a network fetch), **and** caches `node_modules`
  itself (including the already-compiled `better-sqlite3` addon) keyed on
  `runner.os + node version + package-lock.json hash`. On a lockfile-unchanged cache hit, `npm ci`
  is skipped entirely — the compiled addon is already correct for that Node ABI, and `vitest`'s
  own `pretest` hook still double-checks it before running.
- **`.github/workflows/release.yml`** (`release-mac` — packages the Electron app and drafts a
  GitHub Release on a version tag push): caches `~/.npm` (via the same `cache: 'npm'` mechanism)
  so `postinstall`'s `electron-rebuild` prefers a cached prebuild-install download over a
  from-source compile. This workflow does **not** cache `node_modules` wholesale —
  electron-builder does its own per-target native-module handling when packaging both `arm64` and
  `x64` in the same job, so caching the single-arch addon `postinstall` builds for the host runner
  risks reusing the wrong arch's compiled binary across a target it didn't build for. Caching only
  the *download* cache (not the compiled output) is the safe subset here.

## See also

- `CLAUDE.md`'s "Native module note" (short version, points here for detail).
- `e2e/README.md`'s "Why the ABI dance" section — the E2E suite adds a *third* ABI switch
  (Electron for the real app launch, then back to Node for the unit suite afterward), using the
  same `scripts/check-native.cjs`/`check-native-node.cjs`/`native-cache.cjs` machinery.
