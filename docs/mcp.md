# MCP integrations

r3to.os can connect to [Model Context Protocol](https://modelcontextprotocol.io) servers to extend what the agent can do — social platforms, project tools, dev tools, and more — configured from **Settings → MCP Servers**.

## First-party vs. marketplace servers

- **First-party (built-in)** servers are native to the app, always on, and not user-toggleable.
- **Marketplace servers** come from curated catalogs bundled with the Atelier/Salon operator packs (`src/marketplace/seed/*/mcp-configs/mcp-servers.json`) — each a stdio (spawned subprocess) or remote-URL server, with any required credentials templated as `${VAR}` placeholders.

The Settings MCP list merges both into one view, showing whether each is configured (has its required credentials), enabled, and its live connection status.

## Enabling a server

1. Open Settings → MCP Servers.
2. Fill in any required credentials for the server you want (API keys, tokens — never committed anywhere, stored encrypted).
3. Toggle it on. Saving a server's last missing credential auto-enables it (unless it's flagged as a risk/cost server, which always requires an explicit confirm).
4. Some servers layer a **scope-level** override on top — e.g. an Agency-wide disable a specific client can't override, or a client-level disable that doesn't affect others.

Once enabled and configured, a server is lazily spawned/connected the first time a session actually needs its tools — not eagerly on app start. A server that fails to connect or crashes simply contributes no tools for that session; it never takes down the agent loop.

## What's in the catalog

Highlights (see each pack's `mcp-configs/README.md` for the full, current list and required env vars):

- **Social/community** (Salon pack) — X (official hosted MCP, OAuth or bearer-token variants), Discord, Telegram, Reddit, Hacker News, Brave Search, Postiz/Typefully/Buffer scheduling, and Apify-based cookieless social-listening actors.
- **Design/product/dev** (Atelier pack) — Figma (remote + Dev Mode), Notion, Linear, PostHog, a sandboxed filesystem server, and an Electron automation/debugging server (launch/inspect/screenshot/interact with Electron windows via Chrome DevTools Protocol — useful for testing this app itself).

Each entry documents its own setup quirks (OAuth redirect ports, ToS notes, cost/rate-limit flags) directly in its catalog `_comment` and the pack's README.

## Reauthenticating

Servers that delegate OAuth token caching to an external CLI expose a **Reauthenticate** action in Settings — it clears the cached token and, if the server is still enabled/configured, immediately starts a fresh sign-in.

Next: [CLI](./cli.md).
