# Settings

Settings are organized into categories (`src/settings/schema.ts`), each with its own panel:

| Category | Covers |
|---|---|
| `agent` | Which model/provider drives the agent, thinking level |
| `api_keys` | Anthropic and other LLM provider API keys |
| `appearance` | Theme/skin |
| `auth` | OAuth vs. API-key auth method for supported providers |
| `browser` | Automation mode (Electron vs. Chrome/CDP) and CDP URL |
| `chat` | Chat-window behavior |
| `content` | Content-drafting preferences |
| `features` | Feature flags |
| `linkedin` | LinkedIn OAuth connection + org analytics sync |
| `mcp` | The MCP marketplace enable/credential store (see [MCP integrations](./mcp.md)) |
| `memory` | Memory/recall tuning |
| `notifications` | Desktop notification behavior |
| `onboarding` | First-run onboarding state |
| `personalize` | How the agent addresses you, identity/personality |
| `profile` | Your name, birthday (for automatic birthday reminders), and similar profile facts |
| `pulse` | Background "pulse" activity checks |
| `scheduler` | Cron job / routine scheduling |
| `sync` | GitHub connection (Connect GitHub device flow, or a manual PAT fallback) + repo URLs for client/Agency brain git sync (see [Clients & projects](./clients-and-projects.md), [GitHub account connection](./github-account-connection.md)) |
| `telegram` | Bot token and group-linking |
| `window` | Window sizing/position persistence |

Encrypted settings (API keys, tokens) are stored via the OS keychain/encrypted store and are never sent back to the renderer in plain text — a masked placeholder is shown instead once a value is set.

## Where to look next

- [Getting started](./getting-started.md) for first-run setup.
- [Clients & projects](./clients-and-projects.md) for sync configuration.
- [MCP integrations](./mcp.md) for the MCP credentials store.
- [CLI](./cli.md) for the standalone `pocket` CLI install/update flow.
