---
name: mcp-setup
description: enable optional MCP servers (x-api, discord, telegram, reddit, and more) for this project
---

# /mcp-setup

salon bundles no MCP servers by default. this command copies the ones you
choose into the current project's `.mcp.json`.

## steps

1. read the catalog at `${CLAUDE_PLUGIN_ROOT}/mcp-configs/mcp-servers.json`
   (fall back to the repo checkout's `mcp-configs/mcp-servers.json` if the env
   var is unset).
2. present the available servers with a one-line description each and which
   env tokens they need. flag the two that carry real risk before the user
   picks them, not after:
   - x-api: official X hosted MCP; needs an X developer app on the
     **Pay-per-use Production plan**, a paid, metered surface, not a
     free tier. confirm the user understands the cost before enabling.
   - twitter-community: community X MCP (raw v1.1-style keys), no cost flag
   - discord: needs DISCORD_TOKEN
   - telegram: needs TG_APP_ID/TG_API_HASH, **plus a required one-time
     interactive `auth` subcommand** before first use
     (`npx -y @chaindead/telegram-mcp auth --app-id <ID> --api-hash <HASH> --phone <NUM>`).
     tell the user to run this once, outside the session, before the server
     will work; merging the config alone is not enough.
   - reddit: zero-config for reads; REDDIT_USERNAME/PASSWORD needed for writes
   - hacker-news: zero-config, no token
   - brave-search: needs a free API key (~2k queries/mo)
   - postiz / typefully / buffer: scheduling servers; plan limits apply, do
     not assume the free tier covers the user's volume
   - linkedin-unofficial: **ToS RISK: unofficial scraper.** interactive
     browser login on first use, session persists in `~/.linkedin-mcp`, no
     headless env-var mode, and must stay pinned to `@latest` (fixes ship
     continuously as LinkedIn's page structure changes). REQUIRE an explicit
     confirmation from the user ("yes, I understand this violates LinkedIn's
     ToS and accept the risk") before adding this entry; do not add it on an
     ambiguous or implied yes.
3. ask the user which servers to enable ($ARGUMENTS may already name them,
   e.g. `/salon:mcp-setup discord telegram` skips the question, but
   linkedin-unofficial still requires the explicit confirmation from step 2
   even if it's named in $ARGUMENTS).
4. merge the chosen entries into `<project>/.mcp.json`:
   - create the file with `{ "mcpServers": {} }` if it does not exist
   - NEVER overwrite an existing server entry with the same name; report the
     conflict and leave the existing entry alone
   - strip all `_comment` keys from copied entries
5. after writing, list which env vars the user must export (or add to their
   shell profile / secret store) before the servers will start, call out the
   telegram one-time `auth` subcommand again if it was enabled, and remind
   them to restart the session or run /mcp to connect.
