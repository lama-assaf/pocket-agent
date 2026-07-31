# The `pocket` CLI

Alongside the desktop app, there's a standalone `pocket` command-line tool (a separate binary, published at [lama-assaf/pocket-agent-cli](https://github.com/lama-assaf/pocket-agent-cli)) for terminal-based workflows and its own config store (`~/.config/pocket/config.json`).

## Install / update from Settings

Settings → the **Pocket CLI** section can check, install, and update the CLI for you, without leaving the app:

- **Check** — looks for `pocket` on your `PATH` and compares its version against the latest GitHub release.
- **Install** — downloads and installs the latest release for your platform (macOS/Linux via a shell installer script; Windows via a PowerShell installer that unzips to `%LOCALAPPDATA%\pocket-agent-cli` and updates your user `PATH`).
- **Update** — re-runs the same installer to pick up a newer release.

These actions run a small, explicitly allowlisted set of shell commands (see `src/main/ipc/misc-ipc.ts`) — only `api.github.com`/`raw.githubusercontent.com` requests scoped to the `lama-assaf/pocket-agent-cli` repo, plus the platform-appropriate install invocation. Nothing else is executable through this path.

## Credential bridging

If you've already configured credentials through the CLI's own config (e.g. `x_client_id`/`x_client_secret` for X/Twitter), the desktop app can read them as a fallback when resolving an [MCP server](./mcp.md)'s required environment variables — so you don't have to re-enter the same credential twice. The CLI's config always takes lower priority than anything you've explicitly set in the app's own Settings UI.

Next: [Settings](./settings.md).
