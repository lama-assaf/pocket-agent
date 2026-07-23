# Updating r3to.os (unsigned macOS builds)

This project ships macOS builds **without** an Apple Developer account —
no code signing, no notarization. That's a deliberate cost tradeoff, not
an oversight, and it changes how updates work compared to a signed app.

## The constraint: why in-app auto-*install* can't work unsigned on macOS

`electron-updater`'s macOS auto-update is built on **Squirrel.Mac**.
Electron's own docs state this plainly: an app "must be signed for
automatic updates on macOS" — that's a hard requirement of Squirrel.Mac
itself, not an electron-updater option you can turn off.

Concretely, in `src/main/updater.ts`:
- `checkForUpdates()` / the `checking-for-update` → `update-available`
  events **do work** unsigned — this step only fetches `latest-mac.yml`
  from the GitHub Release and compares semver, no code signature is
  involved.
- `downloadUpdate()` also works unsigned — it's just an HTTP download of
  the release zip.
- **`installUpdate()` (`autoUpdater.quitAndInstall()`) is where it
  breaks.** Squirrel.Mac verifies the downloaded update's code signature
  against the running app's before swapping app bundles. On an unsigned
  build there is no valid signature to check, and Squirrel.Mac rejects
  the update — real-world failure modes reported against electron-updater
  read like `Code signature ... did not pass validation: code object is
  not signed at all`.
- `src/main/updater.ts` has no special-casing for this today (no
  `forceDevUpdateConfig`, no unsigned-install fallback) — the failure
  would surface through the generic `autoUpdater.on('error', ...)`
  handler and land in the catch-all `status: 'error'` branch with the
  raw Squirrel/electron-updater error message.

**Bottom line: on macOS, in-app "Check for Updates" can detect and
notify about a new version, but it cannot silently install it while
unsigned.** Don't rely on the "download → install → relaunch" button
working end-to-end for mac testers; treat it as a notify-only signal that
points them at the manual path below. (This macOS-specific signature
requirement is a Squirrel.Mac constraint; the Windows leg is unchanged
by this doc and out of scope here.)

## How a new version ships (developer)

1. Bump `version` in `package.json`.
2. Commit the bump.
3. Tag and push:
   ```bash
   git tag v<version>
   git push origin v<version>
   ```
4. `.github/workflows/build.yml` runs on the tag push:
   - `verify` — format/lint/typecheck/test on Node 22.
   - `build-mac` — `npm run build && npx electron-builder --mac --arm64 --x64 --config.mac.identity=null -p never` (mirrors `npm run dist:local` exactly; no Apple secrets read or required).
   - `build-win` — unchanged by this doc; reads `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` secrets and signs if they're set, otherwise electron-builder skips Windows signing.
   - `release` — publishes `*.dmg`, `*.zip`, `*-setup.exe`, `latest-mac.yml`, `latest.yml` to a GitHub Release tagged `v<version>` via `softprops/action-gh-release`.

No manual publish step, no secrets to configure for macOS. The tag push
is the entire trigger.

## How a tester updates (manual path — the one that actually works)

1. Open the [GitHub Releases page](https://github.com/lama-assaf/pocket-agent/releases) and download the new `r3to.os-<version>-<arch>.dmg` (`arm64` for Apple Silicon, `x64` for Intel).
2. Open the DMG and drag `r3to.os` into `/Applications`, replacing the old app when prompted.
3. **First launch after replacing:** a plain double-click will be blocked by Gatekeeper ("r3to.os can't be opened because it is from an unidentified developer"). In `Applications`, **right-click `r3to.os` → Open → Open** once to approve it. Every launch after that works normally, including via Spotlight/double-click.
4. If macOS still refuses: `System Settings → Privacy & Security` shows an "Open Anyway" button for the blocked app right after the failed launch attempt — use that as a fallback to step 3.

The in-app **Check for Updates** button (Settings) is still useful here:
it will tell you a new version exists and link you to the release, even
though it can't finish the install itself on an unsigned mac build.

## If you later add an Apple Developer account

Re-enable signing + notarization by restoring the old `build-mac` steps
(`Import certificates` + `Build and notarize` using `CERTIFICATE_P12`,
`CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
`APPLE_TEAM_ID` secrets, dropping `--config.mac.identity=null`) — at that
point `installUpdate()` will work end-to-end on macOS with no code
changes needed in `src/main/updater.ts`.
