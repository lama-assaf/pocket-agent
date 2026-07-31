# Release process

r3to.os is distributed **internally only** — trusted testers, no Mac App
Store, no Apple Developer account. macOS builds ship as **unsigned,
un-notarized** dmg/zip. That's a deliberate cost decision, not a TODO: see
`docs/updating-unsigned.md` for the full rationale and how the app itself
degrades gracefully around it.

## How versioning works

`scripts/sync-version.cjs` runs before every build (`prebuild` npm hook) and
overwrites `package.json`'s `version` from the latest git tag (`git describe
--tags --abbrev=0`, stripping the leading `v`). **The tag is the source of
truth** — don't hand-edit `version` in `package.json`.

## Cutting a release (tag → CI → publish)

1. Make sure `main` is green: `npm run verify` (format, lint, typecheck, tests).
2. Write release notes at `docs/releases/vX.Y.Z.md` (see existing files for
   the format — highlights + any packaging caveats).
3. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
4. Pushing the tag triggers `.github/workflows/release.yml`, which:
   - runs `npm run verify` again on the CI runner,
   - builds the macOS `dmg` + `zip` for `arm64` and `x64` — **unsigned**,
     no Apple credentials involved (`package.json`'s `build.mac.identity:
     null` + `notarize: false`, plus `CSC_IDENTITY_AUTO_DISCOVERY: false`
     in the workflow so electron-builder never scans the runner's keychain
     for a signing identity to ad-hoc sign with),
   - uploads the artifacts as a **draft** GitHub Release (draft, not
     published — nobody is notified yet).
5. Open the draft release on GitHub, sanity-check the artifacts (both
   `arm64`/`x64` `.dmg` and `.zip` files should be attached) and notes,
   then click **Publish release**.

There are no signing secrets to configure and nothing else to wait on —
publishing the draft is the last step.

### Releasing locally instead of via CI

```bash
GH_TOKEN=<token with repo scope> npm run release        # macOS dmg + zip, unsigned
GH_TOKEN=<token with repo scope> npm run release:win     # Windows nsis + zip, if ever needed
```

Both run the full build then `electron-builder --publish always`, which
uploads to GitHub Releases as a draft (`build.publish.releaseType: "draft"`
in `package.json`) — same review-then-publish step as above. `GH_TOKEN`
needs `repo` scope; in CI this is `secrets.GITHUB_TOKEN` (already granted via
the `permissions:` block in `release.yml` — no extra secret needed there).

## Tester install instructions

Send testers the `.dmg` link from the published release.

1. Download `r3to.os-<version>-<arch>-mac.dmg` (`arm64` for Apple Silicon,
   `x64` for Intel).
2. Open the DMG and drag `r3to.os` into `/Applications`, **replacing** the
   existing app if this is an update.
3. **First launch after every install/replace:** a plain double-click is
   blocked by Gatekeeper ("r3to.os can't be opened because it is from an
   unidentified developer") — this is expected for an unsigned build.
   In `Applications`, **right-click r3to.os → Open → Open** once to approve
   it. Every launch after that works normally (Spotlight, Dock, etc.).
4. If macOS still refuses: `System Settings → Privacy & Security` shows an
   "Open Anyway" button for the blocked app right after the failed launch
   attempt — use that as a fallback to step 3.
5. **Getting a new version:** there's no in-app auto-install on this build
   (see below) — repeat steps 1–3 with the new DMG each time a release ships.

## Updates are manual, on purpose

`electron-updater`'s macOS auto-install is built on Squirrel.Mac, which
refuses to swap in an update for an app it can't verify the code signature
of — a hard requirement, not a setting. Rather than let that surface as a
confusing runtime error, `src/main/updater.ts` detects an unsigned build at
startup and disables the updater entirely: one log line
(`[Updater] Unsigned macOS build — auto-update is unavailable...`), no
periodic checks, no network calls, no error spam.

In-app, **Settings → Updates** reflects this honestly: instead of "Check
Now" / "restart to apply", testers see **"Manual updates only"** with a
**"Download the latest DMG"** link straight to the GitHub Releases page —
never a misleading restart prompt that could never finish.

This entire mechanism (updater and its UI) is also a no-op in `npm run dev`/
unpackaged builds (`app.isPackaged` guard in `src/main/updater.ts` — status
reports `dev-mode`), so local development is never affected.

## Bug reports / logs

The app version is visible in the window title bar and in **Settings →
Updates** ("Current Version", `#current-version`). For crash/error reports,
console output is mirrored to a day-sharded log file at
`app.getPath('logs')` (`src/utils/app-log.ts`) — on macOS that's:

```
~/Library/Logs/r3to.os/main-YYYY-MM-DD.log
```

Ask testers to attach the relevant day's file (or the last couple of days)
when filing a bug.
