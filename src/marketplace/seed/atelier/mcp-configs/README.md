# mcp configs

mcp (model context protocol) server templates for the tools atelier most commonly references.

## quick start

run `/atelier:mcp-setup` in any project — it walks through this catalog and
merges your choices into that project's `.mcp.json`. nothing here auto-loads
with the plugin; every server is opt-in per project.

## what's in here

- `mcp-servers.json` — server definitions ready to drop into claude code's settings or any mcp-compatible harness
- platform-specific variants under `claude-code/`, `cursor/`, `opencode/` (session 2 ships only the canonical one; harness-specific notes live in `/adapters/`)

## servers included

| server | purpose | source |
|---|---|---|
| figma-remote | figma via official remote mcp endpoint | mcp.figma.com |
| figma-dev-mode | figma via stdio (dev mode mcp from community) | npm: figma-developer-mcp |
| notion | notion pages, databases, search | npm: @notionhq/notion-mcp-server |
| linear-remote | linear via remote endpoint | mcp.linear.app |
| posthog | analytics events, dashboards | npm: @posthog/mcp |
| filesystem | sandboxed file access for atelier self-inspection | npm: @modelcontextprotocol/server-filesystem |

these are **templates**. registry urls, package names, and auth schemes change. always cross-check against the upstream docs before depending on them.

## environment variables expected

| var | server | how to get |
|---|---|---|
| FIGMA_API_KEY | figma-dev-mode | figma.com → settings → personal access tokens |
| NOTION_TOKEN | notion | notion.so/my-integrations |
| POSTHOG_API_KEY | posthog | app.posthog.com → project settings → api keys |
| PROJECT_ROOT | filesystem | path to the current project root |

set them in your shell profile or your harness's secret store. never commit tokens.

## how to use with claude code

option 1: merge into `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    ...contents of mcp-servers.json under mcpServers...
  }
}
```

option 2: use the `claude mcp add` cli to register each one.

## how to use with cursor

cursor reads `~/.cursor/mcp.json`. copy the `mcpServers` block in there.

## remote vs stdio

- **remote** servers (figma-remote, linear-remote): authenticated via the harness's oauth flow, no local install needed.
- **stdio** servers (figma-dev-mode, notion, posthog, filesystem): run as a local subprocess. requires npm/npx available on path.

prefer remote when offered. stdio if you need air-gapped or self-hosted.

## adding your own

each entry follows the standard mcp protocol shape:

```json
"name": {
  "command": "executable",
  "args": ["arg1", "arg2"],
  "env": { "KEY": "value" }
}
```

or for remote:

```json
"name": {
  "type": "url",
  "url": "https://example.com/mcp"
}
```

drop new entries into mcp-servers.json and re-run the installer or merge into your harness config directly.
