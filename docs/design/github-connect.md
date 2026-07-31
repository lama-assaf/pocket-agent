# Connect your own GitHub account (brain sync)

## Status quo (Phase 0 audit)

**How brain sync auth works today, end to end:**

1. `src/settings/schema.ts` defines a single setting, `github.token` (category
   `sync`, `encrypted: true` → stored via Electron's `safeStorage` OS-keychain
   encryption, same as every API key). Default value is empty.
2. `src/clients/sync.ts`'s `authFor(token)` turns that raw string into the
   credential pair `isomorphic-git` sends over HTTPS: `{ username: token,
   password: 'x-oauth-basic' }` — the standard "token-as-username" convention
   GitHub (and most git hosts) accept for HTTPS auth. This is used by all
   three git operations: `cloneBrain`, `pullBrain`, `pushBrain`.
3. `src/clients/sync-manager.ts` wraps those into `pullBrainRepo`/
   `publishBrainRepo`/`autoPullLiveClients` — each takes a `{ dir, url, token
   }` `BrainRepo` and is a soft no-op (`error: 'sync not configured'`) when
   either `url` or `token` is empty. `autoPullLiveClients` is what runs on
   every launch for every `sync_mode: 'live'` client with a `repo_url`.
4. `src/main/index.ts` (on-launch) and `src/main/ipc/settings-ipc.ts`
   (`sync:pull`/`sync:pullAll`/`sync:publish`) both read
   `SettingsManager.get('github.token')` fresh on every call — there is no
   caching of the token itself, so writing a new value to that one setting
   key is instantly picked up everywhere, with zero other code changes.
5. **The only UI surface today** is a raw password box, `#ob-github-token`,
   inside the "Join your team's shared brains?" step of first-run onboarding
   (`ui/chat.html` / `ui/chat/onboarding.js`). There is **no Settings-panel
   entry point** for this token at all — a user who skips that onboarding
   step, or wants to add/rotate a token later, has no in-app way to do it
   except... there isn't one. (`docs/settings.md` and
   `docs/clients-and-projects.md` already describe a "Settings → Sync"
   section as if it exists — it doesn't yet; this change is what makes that
   documentation true.)
6. Today's flow is "bring your own PAT, pasted once during onboarding." It
   already has the right shape for what we want (per-user token, stored
   locally, read by `authFor` with no other code aware of *how* the token was
   obtained) — it's just a bad first-run experience and has no
   connect/disconnect/status affordance afterward.

**Precedent already in this codebase for exactly the two flows we need:**

- `src/auth/kimi-oauth.ts` — a complete **OAuth 2.0 Device Authorization Grant
  (RFC 8628)** implementation (device-code request → open browser → poll
  token endpoint, handling `authorization_pending`/`slow_down`/
  `expired_token`/`access_denied`) with a bundled public `client_id` and NO
  secret. This is the exact shape GitHub's own device flow needs — GitHub
  implements the same RFC.
- `src/auth/linkedin-oauth.ts` / `src/auth/openai-oauth.ts` — browser-redirect
  flows with a local loopback callback server. Not the right fit here (see
  below), but confirms the "one singleton manager class, `startFlow`/
  `isPending`/`cancelFlow`/`logout`, tokens land in `SettingsManager`" shape
  every auth module in this app already follows.

## Device Flow vs. web application flow — recommendation

| | Web application flow | **Device Authorization Grant** |
|---|---|---|
| Needs a `client_secret` | Yes | **No** |
| Needs a redirect URI / local server | Yes | No |
| Needs a backend to hold the secret | Yes (or the secret ships in the app, which is a real leak) | No |
| UX | Browser tab → auto-redirect back to the app | Browser tab → user types an 8-char code shown in the app |
| Built for | Server-side web apps | **CLI tools, TVs, desktop apps without a safe place for a secret** |

**Recommendation: GitHub OAuth Device Flow.** This app is a desktop Electron
app with no backend server. The web application flow requires a
`client_secret` to exchange the authorization code for a token — shipping
that secret inside the app (or proxying it through a backend we'd have to
stand up and operate) is exactly the anti-pattern this task rules out. The
device flow needs only a `client_id`, which is a public identifier (GitHub's
own docs: *"it does not require the OAuth client secret, which means there is
no user-owned server component required"*). This is precisely the pattern
`kimi-oauth.ts` already uses in this codebase, and the pattern GitHub's own
CLI (`gh`) and Git Credential Manager use for exactly this scenario.

## Design

### Registering the GitHub OAuth App (one-time, manual, by whoever operates this app's release)

1. Go to **github.com/settings/developers → OAuth Apps → New OAuth App**
   (or, for an org-owned app, the org's Developer Settings).
2. Application name: e.g. "r3to.os". Homepage URL: the project repo or
   site. Authorization callback URL: device flow doesn't use one, but GitHub
   requires a value — any placeholder like the homepage URL is fine.
3. After creating it, open the app's settings and **check "Enable Device
   Flow"** — GitHub disabled this by default for all OAuth Apps since March
   2022 (phishing mitigation); it must be turned on explicitly or every
   device-flow request will fail.
4. Copy the **Client ID** (NOT the client secret — device flow never uses
   it). Enter it in **Settings → GitHub → OAuth App Client ID**, or set the
   `POCKET_AGENT_GITHUB_CLIENT_ID` environment variable before launching.
5. No further registration is needed for each user — the same `client_id` is
   shared by every install (it is a public identifier, safe to ship, exactly
   like the bundled Claude/Kimi client ids already in this repo).

### Scopes

Requesting `repo` — the classic OAuth scope needed for read/write access to
private repositories (the r3toAI brain repos are private). This is the same
level of access a manually-created PAT with "repo" checked would grant;
device flow doesn't let us request anything narrower for private-repo
read/write with a classic OAuth App.

### Token storage

The device flow's resulting `access_token` is written to the **exact same
setting**, `github.token`, that the manual-PAT flow already writes to and
that `authFor`/`sync.ts` already reads. This is the crux of "reuse existing
sync code unchanged" — nothing downstream of `SettingsManager.get('github.token')`
needs to know or care whether the value came from a device-flow OAuth
exchange or a hand-pasted PAT. Storage is already secure: `github.token` is
declared `encrypted: true` in the settings schema, so it round-trips through
Electron's `safeStorage` (OS keychain — Keychain on macOS, DPAPI on Windows,
libsecret on Linux) exactly like every provider API key already does. No new
storage mechanism needed.

A second, small setting is added — `github.authMethod` (`'oauth' | 'pat' |
''`) — purely so the Settings UI can show "Connected as @username via
GitHub sign-in" vs. "Manual token configured" and offer the right
disconnect copy. It has zero effect on sync behavior; `authFor` never reads
it.

### Refresh / expiry

Classic GitHub OAuth App user-to-server tokens (obtained via the
authorization code OR device flow) **do not expire** unless the user
revokes access, the OAuth App is deleted, or GitHub itself invalidates it
(e.g. detected as leaked). This is a real difference from Claude/OpenAI/Kimi/
LinkedIn in this codebase, all of which do carry a refresh cycle — there is
**no refresh token here, and none is needed**. What we do instead: every
"connected" status check calls `GET https://api.github.com/user` with the
stored token. A `401` means the token was revoked/invalidated — the UI
then shows "Disconnected — sign in again" rather than a stale "Connected"
badge; any other failure (offline, GitHub down) degrades to "Connected,
can't verify right now" rather than wrongly reporting a disconnect.

### Disconnect flow

Clears `github.token` and `github.authMethod` (same two settings the connect
flow wrote). `sync.ts`/`sync-manager.ts` immediately see an empty token on
their next call and degrade to their existing "sync not configured" soft
no-op — no special-casing needed there either.

### Coexistence with the manual-PAT fallback

Both write to the same `github.token` setting, so they're mutually exclusive
in effect (whichever was set last wins) but never conflict structurally.
Settings UI: "Connect GitHub" is the primary, prominent action; the raw PAT
input is inside a collapsed "Advanced: use a Personal Access Token instead"
section, pre-existing pattern in this Settings panel (`<details>` blocks are
already used for LinkedIn's setup steps). Saving a PAT manually sets
`github.authMethod = 'pat'`; completing the device flow sets it to `'oauth'`;
either one overwrites whatever the other set.

### Access-control prerequisite for the r3toAI repos (important — call this out to users)

**Connecting a GitHub account only proves who the user is — it does not by
itself grant that user access to any specific repository.** For a client's
`repo_url` (e.g. the r3toAI comms-brain repos) to actually pull/push
successfully, the connected GitHub account must **already be a collaborator
on that repo, or a member of the org with sufficient access** (r3toAI, in
this case). If it isn't, the git operation will fail with a normal
authentication/authorization error from GitHub (typically a 404, since
GitHub doesn't reveal whether a private repo exists to an unauthorized
caller) — the same failure a misconfigured PAT would produce today. This is
not something the connect flow can fix or work around; it's a separate,
manual step: whoever administers the r3toAI org needs to invite each
teammate's GitHub account as a collaborator (or org member) on the relevant
brain repo(s) before that teammate's connected account can sync it.

## What changes, file by file

| File | Change |
|---|---|
| `src/auth/github-device-flow.ts` (new) | Testable device-flow request and polling logic |
| `src/auth/github-oauth.ts` (new) | Device-flow manager and encrypted token persistence. `startFlow()` resolves as soon as the device code arrives and polls to completion in the background (fire-and-forget, same shape as `kimi-oauth.ts`) — it must NOT await the whole flow before returning, or the UI would never get a chance to show the code the user needs to type in |
| `src/settings/schema.ts` | New public client-ID setting plus cosmetic `github.authMethod` |
| `src/main/ipc/misc-ipc.ts` | `github:startOAuth` / `isOAuthPending` / `cancelOAuth` / `getAuthStatus` / `disconnect` handlers |
| `src/main/preload.ts` | `githubAuth: {...}` exposed to renderer, mirrors `kimiAuth`/`openaiAuth` |
| `ui/chat.html` | GitHub Settings section: Client ID, Connect button, status, device-code display, and a collapsed "Advanced: use a Personal Access Token instead" `<details>` block (the PAT fallback UI) |
| `ui/chat/settings-panel.js` | GitHub connect/disconnect/status behavior, a 3s `isOAuthPending()` poll loop (mirrors `_stgStartKimiPolling`) to detect when the background device-flow poll finishes, and the PAT box's save/delete handlers |
| `tests/unit/github-device-flow.test.ts` (new) | Mocked-fetch coverage for success, polling, slowdown, errors, cancellation, and timeout |
| `tests/unit/github-oauth.test.ts` (new) | Manager-level coverage: `startFlow()` resolving early vs. blocking, settings persistence, concurrent-start guard, cancellation, `getAuthStatus()`'s revoked/offline distinction, and `disconnect()` |

Nothing in `src/clients/sync.ts`, `src/clients/sync-manager.ts`, or any IPC
handler that reads `github.token` for actual git operations changes at all.
