# CSS Best Practices Fixes

Based on real-world pattern comparison against 50+ open-source chat UI repos (microsoft/vscode, openai/chatkit, mcp-chrome, convex-backend, etc).

## Fix 1: Broken CSS in status.css (BUG)

**File:** `ui/chat/status.css`
**Lines 344-347** — Remove orphaned CSS fragments:
```
t infinite;
}
shimmer 2s ease-in-out infinite;
}
```
These are dangling copy-paste artifacts causing CSS parse errors. Delete lines 344-347.

## Fix 2: Add `color-scheme: dark` to variables.css

**File:** `ui/shared/variables.css`
Add `color-scheme: dark;` as the first property inside `:root {}`:
```css
:root {
  color-scheme: dark;
  --bg-primary: #0a0a0b;
  /* ...rest unchanged */
}
```
This ensures native form controls (`<select>`, `<input>`), scrollbars, and system UI elements render with dark chrome in Electron.

## Fix 3: Add Firefox scrollbar styling alongside WebKit

**File:** `ui/chat/messages.css`
Add before the existing `::-webkit-scrollbar` block (around line 18):
```css
#messages {
  /* ...existing properties... */
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
```
The `scrollbar-width: thin; scrollbar-color:` should be added to the `#messages` rule at line 1.

**File:** `ui/chat/global-chat.css`
Same treatment for `#global-chat-messages` — add to the rule around line 254:
```css
#global-chat-messages {
  /* ...existing properties... */
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
```

## Fix 4: Add `focus-visible` styles for accessibility

**File:** `ui/chat/base.css`
Add a global focus-visible rule at the end of the file (after the reduced-motion block):
```css
/* Keyboard focus indicators for accessibility */
button:focus-visible,
select:focus-visible,
[role="button"]:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

textarea:focus-visible,
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0;
}
```

## Fix 5: Add `contain: content` on message elements for rendering performance

**File:** `ui/chat/messages.css`
Add `contain: content;` to the `.message` rule (around line 88):
```css
.message {
  max-width: 80%;
  padding: 12px 16px;
  border-radius: var(--radius);
  line-height: 1.5;
  font-size: 14px;
  word-wrap: break-word;
  animation: messageIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  transform-origin: bottom;
  contain: content;
}
```

**File:** `ui/chat/global-chat.css`
Add `contain: content;` to `.global-chat-wrapper` rule (around line 287):
```css
.global-chat-wrapper {
  display: flex;
  flex-direction: column;
  max-width: 80%;
  contain: content;
}
```

## Fix 6: Add `will-change` hints on animated elements

**File:** `ui/chat/messages.css`
Add `will-change: transform, opacity;` to the `.message` rule (same block as Fix 5):
```css
.message {
  /* ...existing... */
  contain: content;
  will-change: transform, opacity;
}
```

**File:** `ui/chat/status.css`
Add `will-change: transform;` to `.typing-dot` (around line 301):
```css
.typing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: typingBounce 1.4s infinite ease-in-out both;
  will-change: transform;
}
```

## Fix 7: Refine `prefers-reduced-motion` rule

**File:** `ui/chat/base.css`
Replace the current reduced-motion block (lines 17-23) with a more targeted version that kills looping/infinite animations but preserves short transitions (hover states, etc):
```css
/* Accessibility: respect OS-level reduced motion preference */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.15s !important;
    scroll-behavior: auto !important;
  }
}
```
The key change: `transition-duration: 0.15s` instead of `0.01ms`. This keeps hover/focus transitions feeling responsive while killing looping animations. Also adds `scroll-behavior: auto` to disable smooth scrolling for users who prefer reduced motion.

## Implementation Order

1. Fix 1 (bug fix — status.css broken syntax)
2. Fix 2 (color-scheme — variables.css)
3. Fix 7 (reduced-motion refinement — base.css)
4. Fix 4 (focus-visible — base.css)
5. Fix 3 (Firefox scrollbar — messages.css, global-chat.css)
6. Fix 5 + Fix 6 (contain + will-change — messages.css, global-chat.css, status.css)

## Verification

After all edits: `npm run lint && npm run typecheck` (CSS files won't affect typecheck, but lint may have CSS rules).
Visually verify in the Electron app that:
- Native `<select>` elements render dark
- Scrollbars still look correct
- Animations still play
- Tab-focusing shows outlines on buttons
