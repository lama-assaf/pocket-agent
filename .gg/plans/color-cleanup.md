# Color Cleanup Plan

## Goal
Replace hardcoded hex/rgba colors with CSS variables. Add missing variables for recurring one-offs.

## New Variables to Add (`ui/shared/variables.css`)

```css
--link: #60a5fa;
--link-hover: #93c5fd;
--telegram: #229ED9;
--badge-bg: #1f1528;
--badge-border: #352547;
--cyan: #22d3ee;
```

## Files & Changes

### 1. `ui/shared/variables.css`
- Add the 6 new variables listed above

### 2. `ui/chat/messages.css`
**Telegram colors:**
- Line 185: `#0088cc` → `var(--telegram)` (telegram header color)
- Line 287: `#1f1528` → `var(--badge-bg)` (scheduled badge bg)
- Line 288: `#352547` → `var(--badge-border)` (scheduled badge border)
- Line 308: `#229ED9` → `var(--telegram)` (telegram badge color)
- Line 309: `#0d1a22` → hardcoded OK (telegram badge bg, unique dark tint, only used here)
- Line 310: `#1a3344` → hardcoded OK (telegram badge border, unique, only used here)
- Line 318: `#229ED9` → `var(--telegram)` (telegram badge fill)
- Line 335: `#1f1528` → `var(--badge-bg)` (ios badge bg)
- Line 336: `#352547` → `var(--badge-border)` (ios badge border)
- Line 361: `#1f1528` → `var(--badge-bg)` (workflow badge bg)
- Line 362: `#352547` → `var(--badge-border)` (workflow badge border)

### 3. `ui/chat/markdown.css`
- Line 84: `#60a5fa` → `var(--link)`
- Line 86: `rgba(96, 165, 250, 0.4)` → leave (underline decoration, no var needed)
- Line 91: `#93c5fd` → `var(--link-hover)`
- Line 92: `rgba(147, 197, 253, 0.6)` → leave
- Line 96: `#bfdbfe` → leave (user bubble link, unique light variant, only used once)

### 4. `ui/chat/status.css`
- Line 160: `#a855f7` → `var(--accent)` (subagent border)
- Line 171: `#a855f7` → `var(--accent)` (subagent gradient stop)
- Line 172: `#ec4899` → `var(--accent-secondary)` (subagent gradient stop)
- Line 173: `#a855f7` → `var(--accent)` 
- Line 174: `#ec4899` → `var(--accent-secondary)`
- Line 175: `#a855f7` → `var(--accent)`
- Line 186: `#ef4444` → `var(--error)` (blocked border)
- Line 194: `#ef4444` → `var(--error)` (blocked gradient)
- Line 195: `#f97316` → `var(--orange)` (blocked gradient)
- Line 196: `#ef4444` → `var(--error)` (blocked gradient)
- Line 206: `#f97316` → `var(--orange)` (blocked detail color)
- Line 216: `#22c55e` → `var(--success)` (CLI border)
- Line 223-227: `#22c55e` → `var(--success)` (CLI gradient stops, 4 instances)
- Line 237: `#22c55e` → `var(--success)` (CLI detail color)
- Line 242: `#3b82f6` → hardcoded OK (team blue, unique status color)
- Line 249-253: `#3b82f6` → keep, `#06b6d4` → keep (team gradient, unique status)
- Line 263: `#06b6d4` → keep (team detail)
- Line 326: `#a855f7` → `var(--accent)` (plan mode border)
- Line 333-335: `#a855f7` → `var(--accent)`, `#8b5cf6` → keep as variation

### 5. `ui/chat/input.css`
- Line 170: `#ef4444` → `var(--error)`, `#dc2626` → hardcoded OK (darker error, unique)
- Line 174: `#f87171` → hardcoded OK (lighter error hover, unique), `#ef4444` → `var(--error)`

### 6. `ui/chat/base.css`
- Line 3: `#f59e0b` → `var(--warning)`, `#d97706` → hardcoded OK (darker warning variant)

### 7. `ui/chat/sidebar.css`
- Line 247: `#0088cc` → `var(--telegram)`

### 8. `ui/chat/global-chat.css`
- Line 166: `#ef4444` → `var(--error)` (unread badge bg)
- Line 248: `#22c55e` → `var(--success)` (connected status)
- Line 761: `#f59e0b` → `var(--warning)` (admin border)
- Line 971: `#c084fc` → `var(--accent-hover)` (reaction active color)
- Line 1225: `#22d3ee` → `var(--cyan)` (mention highlight in input)
- Line 1236: `#22d3ee` → `var(--cyan)` (mention highlight in bubbles)
- Tier system (lines 504-630): **LEAVE ALONE** — decorative rainbow, intentionally diverse

### 9. `ui/chat/onboarding.css`
- Line 235: `#10b981` → `var(--success)`, `#059669` → hardcoded OK (darker success)
- Line 483: `#ea580c` → hardcoded OK (orange hover, unique variant)

## NOT Touching
- Pixel heart in messages.css (decorative art, uses `#c084fc` / `var(--accent-hover)` mix — fine)
- Pixel cat animation in status.css (`#fff` for eyes — fine)
- Tier system in global-chat.css (intentionally rainbow)
- Admin username effects in global-chat.css (decorative)
- `rgba()` values used for opacity variants of known colors (these are correctly contextual)

## Verification
After all changes: `npm run lint:fix && npm run typecheck && npm run format`
