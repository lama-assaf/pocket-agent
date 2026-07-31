# Getting started

r3to.os (Zilliqa community edition) is an Electron menu-bar app for macOS.

## Install

| Mac | Link |
|-----|------|
| Apple Silicon (M1/M2/M3/M4) | [Download](https://github.com/lama-assaf/pocket-agent/releases/latest) |
| Intel | [Download](https://github.com/lama-assaf/pocket-agent/releases/latest) |

1. Drag to Applications, launch it.
2. It shows up in your menu bar.
3. Click it, paste your Anthropic API key (get one at [console.anthropic.com](https://console.anthropic.com)).
4. Start chatting.

The API key is stored in your system keychain, not in plain text. Everything else — messages, facts, analytics, clients/projects — is stored locally in SQLite on your machine.

## For developers

```bash
git clone https://github.com/lama-assaf/pocket-agent.git
cd pocket-agent
npm install
npm run dev
```

`npm run typecheck` and `npm run lint` should stay clean after any change (see the repo's `CLAUDE.md` for the full contributor workflow). `better-sqlite3` is a native module rebuilt per-ABI — tests run under Node (`pretest` handles rebuilding automatically), and `npm run electron`'s `preelectron` hook rebuilds for Electron. See [dev-setup.md](./dev-setup.md) if you ever hit a `NODE_MODULE_VERSION` error.

## Onboarding flow

First launch walks through:

1. **Anthropic API key** (or OAuth sign-in) — required before the agent can respond at all.
2. **Personalize** — your name and how the agent should refer to you.
3. **Optional integrations** — Telegram bot token, browser automation mode, the standalone `pocket` CLI.

All of this can be revisited any time from **Settings**.

## Telegram setup (optional)

Talk to the agent from your phone, with full access to memory and tools:

1. Create a bot with [@BotFather](https://t.me/botfather) on Telegram.
2. Copy the token into r3to.os → Settings → Telegram.
3. Message your bot.

**Group chats:** add the bot to a group and use `/link SessionName` to connect that group to a specific session — each group can have its own isolated conversation, separate from your personal one. For the bot to see all messages in a group (not just commands starting with `/`), either make it an admin or disable privacy mode in BotFather.

**Bot commands:** `/status` `/facts` `/clear` `/link <session>` `/unlink` `/mychatid`.

## Browser automation

Two tiers (`src/browser/`):

- **Basic (Electron) mode** — a hidden Electron window. No setup needed. Handles screenshots, clicking by CSS selector, typing into inputs, extracting page content (text/HTML/links/tables), running JavaScript, downloading files.
- **Chrome (CDP) mode** — connects to your actual Chrome browser over the Chrome DevTools Protocol, with all your logged-in sessions (Gmail, GitHub, etc.) already available — no re-authentication needed. Start Chrome with remote debugging first:

  ```bash
  # macOS
  /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

  # Windows
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222

  # Linux
  google-chrome --remote-debugging-port=9222
  ```

Configure the mode and CDP URL under Settings → Browser.

## Routines & scheduled tasks

Cron-based automations (`src/scheduler/`) that run full agent executions on a schedule — with access to tools, browser automation, and conversation history, not just reminders. Examples: a morning briefing that checks calendar/Slack, a weekly progress-doc update, a daily price-watch on a webpage.

## Privacy

- Everything is stored locally in SQLite — no cloud database.
- Conversations go to Anthropic's API (that's how the model responds) and to whichever other provider you've configured under Settings → LLM.
- API keys are stored in your system keychain.
- No built-in analytics or telemetry service is called by the app itself; the only network calls are the ones you configure (LLM provider, MCP servers, git sync, Telegram).

Next: [Memory & the Brain](./memory-and-brain.md) or [Clients & projects](./clients-and-projects.md).
