# Updating r3to.os (unsigned macOS builds)

This project ships macOS builds **without** an Apple Developer account —
no code signing, no notarization. That's a deliberate cost tradeoff for an
internal-only tool, not an oversight, and it changes how updates work
compared to a signed app.

## The constraint: why in-app auto-update can't work unsigned on macOS

`electron-updater`'s macOS auto-update is built on **Squirrel.Mac**, which
requires the running app to have a valid code signature before it will
swap in a downloaded update — Electron's own docs state an app "must be
signed for automatic updates on macOS." That's a hard requirement of
Squirrel.Mac itself, not an electron-updater option you can turn off.

Rather than let testers hit a cryptic `Could not get code signature for
running application` error mid-update, `src/main/updater.ts` checks the
running app's signature (`codesign --verify`) once at startup:

- **Signed build** (not the case today, but supported if that ever
  changes): the updater initializes normally — background check, silent
  download, "restart to apply" banner, the works.
- **Unsigned build** (today's reality): `initializeUpdater()` logs a
  single line (`[Updater] Unsigned macOS build — auto-update is
  unavailable...`) and never touches `autoUpdater` — no periodic checks,
  no network calls, no error spam. The in-app Settings → Updates panel
  shows **"Manual updates only"** with a **"Download the latest DMG"**
  link straight to GitHub Releases instead of a "Check Now"/"Restart"
  flow that could never finish.

## How a new version ships (developer)

1. Make sure `main` is green (`npm run verify`).
2. Tag and push:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
3. `.github/workflows/release.yml` runs on the tag push: `verify`, then
   builds the unsigned `dmg`/`zip` for `arm64` + `x64`
   (`CSC_IDENTITY_AUTO_DISCOVERY=false`, package.json's
   `build.mac.identity: null` — no Apple secrets read or required) and
   uploads them as a **draft** GitHub Release.
4. A human opens the draft, sanity-checks the artifacts, and clicks
   **Publish release**. See `RELEASE.md` for the full walkthrough.

## How a tester updates (manual path — the one that works)

1. Open the [GitHub Releases page](https://github.com/lama-assaf/pocket-agent/releases) and download the new `r3to.os-<version>-<arch>-mac.dmg` (`arm64` for Apple Silicon, `x64` for Intel).
2. Open the DMG and drag `r3to.os` into `/Applications`, replacing the old app when prompted.
3. **First launch after replacing:** a plain double-click will be blocked by Gatekeeper ("r3to.os can't be opened because it is from an unidentified developer"). In `Applications`, **right-click `r3to.os` → Open → Open** once to approve it. Every launch after that works normally, including via Spotlight/double-click.
4. If macOS still refuses: `System Settings → Privacy & Security` shows an "Open Anyway" button for the blocked app right after the failed launch attempt — use that as a fallback to step 3.

The in-app **Settings → Updates** panel won't offer a "Check Now"/install
flow on this build — it links straight to the GitHub Releases page above
instead, since it can't do anything more useful on an unsigned build.

## If you later add an Apple Developer account

Re-introduce signing + notarization by:
- Setting `build.mac.identity` back to a real Developer ID (or removing
  the `identity: null` override) and `build.mac.notarize: true` in
  `package.json`.
- Adding `CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/
  `APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` as GitHub Actions secrets
  and passing them through `.github/workflows/release.yml`'s env block
  (dropping `CSC_IDENTITY_AUTO_DISCOVERY: false`).

At that point `src/main/updater.ts`'s signature check will pass and the
updater will initialize normally — no other code changes needed.
