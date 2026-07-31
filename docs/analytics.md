# Analytics

Post-performance tracking for whatever your client posts on social/content channels (X, LinkedIn, etc.), scoped just like facts and lessons.

## What's tracked

Each snapshot (`post_analytics` table, `src/memory/analytics.ts`) records: impressions, likes, comments, shares, clicks, video views, the post's direct URL, its lead/thread text, notable top comments, and any shared media URLs (images/files) attached to the post. Snapshots are **append-only** — a post's numbers keep climbing after it ships, so every capture (manual entry or an MCP fetch) writes a new row rather than overwriting the last one. "Current numbers" is always "the latest snapshot per post"; the full history is there for a "performance over time" view.

## Where numbers come from

- **Manual entry** — paste in a post's stats yourself from the Analytics panel.
- **MCP / integrations** — e.g. the LinkedIn org-analytics sync pulls impressions/engagement for posts published from a connected LinkedIn org page, on launch and periodically thereafter.

## Aggregate views

The Analytics panel shows totals and a per-channel breakdown (impressions, likes, comments, shares, clicks, video views, engagement rate = (likes+comments+shares)/impressions), plus a ranked "top posts" list by engagement rate.

## Sharing analytics with your team

Analytics are part of a client's shareable brain (see [Clients & projects](./clients-and-projects.md)):

- **Publish** exports a client's latest per-post snapshots to `.atelier/memory/analytics-summary.md` and `analytics-posts.md` (human-readable, git-diffable) *and* `analytics-posts.json` (a lossless, machine-readable copy).
- **Pull** re-imports that JSON file into the local `post_analytics` table — deduped on channel + post + capture time, so re-pulling never duplicates rows and never overwrites your own locally-captured snapshot for the same post/moment. This is what lets a fresh install (or a teammate who's never run their own capture) see real, queryable numbers immediately after one pull — no live re-fetch required.

Next: [MCP integrations](./mcp.md).
