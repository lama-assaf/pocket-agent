# Polish Chat Bubbles — "Expensive" Look

## Problem Diagnosis

After comparing our chat CSS against 30+ real-world chat implementations (ChatGPT-style, Electron desktop apps, AI chat UIs from tldraw, vercel/ai, forem, openclaw, Kilo-Org, QwenLM, cloudflare, nbonamy/witsy, etc.), here's exactly what makes ours look "vibe coded":

### 1. Bouncy message entrance animation (biggest tell)
Our `messageIn` has a **4-keyframe spring bounce** with scale overshoot (`0.92 → 1.02 → 0.99 → 1`). Every single real-world chat uses a **simple 2-keyframe fade+slide** (`opacity 0→1, translateY 10-12px→0`). The bounce screams "I used a cool CSS generator".

**Evidence:** forem/forem, tldraw, NVIDIA, microsoft, clockworklabs, JianguSheng, qusaismael — all use simple `from { opacity:0; translateY(10-12px) } to { opacity:1; translateY(0) }`. Zero use scale overshoot.

### 2. Hover lift on messages (zero real apps do this)
Both user and assistant messages have `translateY(-1px)` + enhanced `box-shadow` on `:hover`. Messages are **content, not interactive cards**. No real chat app lifts messages on hover. The only hover effect real apps use is revealing action buttons (copy, etc.) — which we already do.

**Evidence:** Searched 10+ chat CSS repos for `message.*:hover.*translateY` — found zero.

### 3. `backdrop-filter: blur(10px)` on every assistant message
Frosted glass on every single message is heavy, both visually and computationally. Real apps use flat solid backgrounds. This adds a "glassy" aesthetic that conflicts with the rest of the dark UI.

**Evidence:** openclaw, cloudflare/templates, Kilo-Org/kilocode, anomalyco/opencode — all use simple solid/transparent backgrounds for assistant messages. None use backdrop-filter on messages.

### 4. Too many visual layers competing
Our assistant message has **5 simultaneous visual effects**: 
- `rgba(28,28,30,0.85)` background
- `backdrop-filter: blur(10px)`
- `border: 1px solid var(--border)`
- `box-shadow: inset 0 1px 0 rgba(255,255,255,0.03)`
- `box-shadow: 0 2px 8px rgba(0,0,0,0.15)`

Polished apps use **1-2 effects max** (usually just a background color and maybe a subtle border).

### 5. Heavy box-shadows
User: `0 2px 8px rgba(0,0,0,0.2)` — too heavy for dark theme where depth cues are subtle.  
Real apps use `0 1px 2px rgba(0,0,0,0.1)` or nothing.

### 6. 18px border-radius
Our `--radius: 18px` makes bubbles very round/bubbly. Most polished chat apps use **8-16px**. Tldraw uses 16px, forem uses 8px, rivet uses 12px.

---

## Changes

### File: `ui/shared/variables.css`

**Line 26:** Change `--radius: 18px` → `--radius: 16px`  
Rationale: 16px is the sweet spot — still rounded but less bubbly/toyish. Matches tldraw.

### File: `ui/chat/messages.css`

**Lines 97-101 (.message):** Remove `will-change` (not needed for one-shot animations), keep `contain`.

**Lines 103-118 (messageIn keyframes):** Replace 4-keyframe bounce with simple 2-keyframe:
```css
@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

**Lines 120-132 (.message.user):** 
- Remove hover block entirely (lines 129-132)
- Reduce box-shadow: `0 1px 3px rgba(0, 0, 0, 0.2)` 
- Remove `transition` (no hover effect to transition to)

**Lines 134-150 (.message.assistant + hover):**
- Remove `backdrop-filter` and `-webkit-backdrop-filter`
- Change background to solid: `var(--bg-tertiary)` (already defined as `#1c1c1e`)
- Remove inset box-shadow, simplify to just: `box-shadow: none;` (border is enough)
- Remove hover block entirely (lines 146-150)
- Remove `transition` 

### File: `ui/chat/status.css`

**Line 12:** Change animation to match new simpler `messageIn`:
```css
animation: messageIn 0.3s ease-out;
```
(was `0.4s cubic-bezier(0.34, 1.56, 0.64, 1)` — the spring bezier was for the bounce)

**Line 14:** Reduce box-shadow: `0 1px 3px rgba(0, 0, 0, 0.15)` (was `0 2px 12px`)

### File: `ui/chat/global-chat.css`

**Lines 327-343 (.message.global-chat-self):**
- Reduce box-shadow to `0 1px 3px rgba(0, 0, 0, 0.2)`
- Remove hover block (lines 340-343)
- Remove transition

**Lines 345-365 (.message.global-chat-other):**
- Remove `backdrop-filter` and `-webkit-backdrop-filter`
- Change background to solid `var(--bg-tertiary)`
- Remove inset shadow, set `box-shadow: none`
- Remove hover block (lines 361-365)
- Remove transition

---

## What NOT to change

- **User bubble gradient** — Fine for branding, just overdone when combined with heavy shadows
- **Pixel cat animation** — Unique personality, keep it
- **Status shimmer text** — Tasteful, keep it
- **Streaming cursor** — Standard pattern, keep it
- **Copy button reveal on hover** — This IS the correct hover pattern for messages
- **Empty state pixel heart** — Character, keep it
- **Input container styling** — User already said it looks fine

## Verification

After changes, run:
```bash
npm run typecheck && npm run lint
```

Visual check: Messages should feel **flat, confident, quiet** — like Claude.ai or Linear's interface. Depth comes from content hierarchy and spacing, not shadows and glass.
