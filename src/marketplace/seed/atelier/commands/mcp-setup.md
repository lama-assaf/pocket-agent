---
name: mcp-setup
description: enable optional MCP servers (figma, notion, linear, posthog, filesystem) for this project
---

# /mcp-setup

atelier bundles no MCP servers by default. this command copies the ones you
choose into the current project's `.mcp.json`.

## steps

1. read the catalog at `${CLAUDE_PLUGIN_ROOT}/mcp-configs/mcp-servers.json`
   (fall back to the repo checkout's `mcp-configs/mcp-servers.json` if the env
   var is unset).
2. present the available servers with a one-line description each and which
   env tokens they need:
   - figma-remote — remote URL, OAuth in-client, no token
   - figma-dev-mode — needs FIGMA_API_KEY
   - notion — needs NOTION_TOKEN
   - linear-remote — remote URL, OAuth in-client, no token
   - posthog — needs POSTHOG_API_KEY (POSTHOG_HOST defaults to https://us.i.posthog.com in the template; change if you use the EU host)
   - filesystem — needs a directory path argument; default to the project root
3. ask the user which servers to enable ($ARGUMENTS may already name them —
   e.g. `/atelier:mcp-setup notion linear` skips the question).
4. merge the chosen entries into `<project>/.mcp.json`:
   - create the file with `{ "mcpServers": {} }` if it does not exist
   - NEVER overwrite an existing server entry with the same name; report the
     conflict and leave the existing entry alone
   - strip all `_comment` keys from copied entries
   - for filesystem, replace `${PROJECT_ROOT}` in the template args with the
     project root path
5. after writing, list which env vars the user must export (or add to their
   shell profile / secret store) before the servers will start, and remind
   them to restart the session or run /mcp to connect.
