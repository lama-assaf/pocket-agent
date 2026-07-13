# mcp-configs

salon bundles no MCP servers by default and starts nothing on its own. run
`/salon:mcp-setup` to pick servers from `mcp-servers.json` and merge them
into the current project's `.mcp.json`. existing entries are never
overwritten, and `_comment` keys are stripped on copy.

## quick start

```
/salon:mcp-setup discord telegram
```

or run `/salon:mcp-setup` with no arguments to see the full catalog and
choose interactively.

## catalog

| key | server | env / setup | flag |
|---|---|---|---|
| x-api | official X hosted MCP (xurl OAuth bridge) | `X_CLIENT_ID`, `X_CLIENT_SECRET` | COST: requires an X dev app on the Pay-per-use Production plan, not free |
| twitter-community | @enescinar/twitter-mcp (raw v1.1-style keys) | `TWITTER_API_KEY` + 3 more | community, stale ~1yr |
| discord | mcp-discord | `DISCORD_TOKEN` | none |
| telegram | @chaindead/telegram-mcp (MTProto user session) | `TG_APP_ID`, `TG_API_HASH` | ToS: user-session automation; requires a one-time interactive `auth` subcommand before first use |
| reddit | reddit-mcp-server | reads: none; writes: `REDDIT_USERNAME`/`REDDIT_PASSWORD` | none |
| hacker-news | mcp-hacker-news | none | none, zero-config; unmaintained ~1yr, API stable |
| brave-search | @brave/brave-search-mcp-server | `BRAVE_API_KEY` | free tier ~2k queries/mo |
| postiz | official remote MCP | `POSTIZ_API_KEY` (in URL) | scheduling; plan limits apply |
| typefully | official remote MCP | `TYPEFULLY_API_KEY` (query param) | scheduling/drafting; paid plan; API-key auth only, not OAuth |
| buffer | official remote MCP (`mcp.buffer.com`) | `BUFFER_API_KEY` (Bearer header) | scheduling; plan limits apply, don't assume free tier |
| linkedin-unofficial | uvx mcp-server-linkedin@latest | interactive browser login, no env-var auth | **ToS RISK: unofficial scraper; requires explicit confirmation to add** |
| apify-social-listening | hosted Apify MCP (`mcp.apify.com`), pinned to 5 cookieless X + LinkedIn listening actors | `APIFY_TOKEN` (Bearer header) | COST: pay-per-result (X ~$0.18-0.40/1k tweets, LinkedIn ~$1.50-2/1k posts); ToS note below |
| apify-social-listening-local | @apify/actors-mcp-server (stdio), same pinned actors | `APIFY_TOKEN` | same as hosted entry |

### apify listening actors (pinned, verified 2026-07-09)

both apify entries expose exactly these five actors and nothing else (`?tools=` /
`--tools` replaces the default actor-discovery toolset):

| platform | actor | cookieless | cost | why this one |
|---|---|---|---|---|
| X | kaitoeasyapi/twitter-x-data-tweet-scraper-pay-per-result-cheapest | yes | $0.18/1k tweets | cheapest keyword search, 99.9% run success, 17.8k users |
| X | apidojo/tweet-scraper | yes | $0.40/1k tweets (50-tweet min/query) | largest adoption (66.8k users), advanced search syntax |
| LinkedIn | harvestapi/linkedin-post-search | yes | ~$1.50-2/1k posts | boolean keyword search with author/company/date filters, 4.92 rating |
| LinkedIn | harvestapi/linkedin-company-posts | yes | $1.50/1k posts | competitor company-page monitoring, up to 6 companies at once |
| LinkedIn | harvestapi/linkedin-profile-posts | yes | $1.50/1k posts | individual profile post history with engagement |

actor churn on X/LinkedIn is high; re-verify these picks periodically. swap the
actor list in both entries' `tools` parameter to change the pinned set.

### cookieless is not ToS-less

routing scraping through Apify removes your own account credentials from the
request path, but it relocates platform-ToS exposure rather than removing it.
X and LinkedIn prohibit automated scraping regardless of who runs the scraper;
Apify absorbs the operational risk (proxies, anti-bot, account bans) while the
downstream user of the data keeps the legal/ToS risk. LinkedIn in particular
has litigated against scraping vendors, and listing-page actors have been
forced to change tactics or shut down before. treat these entries as "lower
account risk", never "no risk".

## avoid-list

these were considered and rejected during the 2026-07-08 research pass:

- **cookie-based X scrapers** — suspension risk, and the ones surveyed are
  stale.
- **Discord self-bots** — automate a user account instead of a bot account;
  banned by Discord's terms.
- **Bot-API-only Telegram servers** — can't read channel/group history, only
  send; not useful for the listening or engagement workflows here.
- **the lone Google Trends scraper found** — fragile, breaks on layout
  changes, no maintenance signal.
- **community Mixpost MCP** — 1 star, no adoption signal; Buffer's official
  remote MCP is the documented scheduler alternative.
- **RapidAPI social wrappers** (checked 2026-07-09) — no maintained MCP server
  wraps RapidAPI's Twitter154 / "Fresh LinkedIn Profile Data" endpoints; the
  only candidates were unpublished from npm or single-maintainer hobby repos
  with no adoption. if you specifically need RapidAPI, write a thin custom MCP
  shim against your key; otherwise use the apify entries above.

## notes

- `mcp-setup` reads this catalog from `${CLAUDE_PLUGIN_ROOT}/mcp-configs/mcp-servers.json`
  (or the repo checkout path when that env var is unset).
- nothing here auto-connects. servers only start once merged into a
  project's `.mcp.json` and the session restarts or reconnects.
