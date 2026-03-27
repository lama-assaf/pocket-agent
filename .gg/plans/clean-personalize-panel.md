# Clean Up Personalize Panel: Agent Name + Your Details

## Problem
1. **Container within container** — `pz-content` (padded) wraps `pz-form-section` (bg + border + padding) creating a nested box look
2. **Inconsistent font sizing** — Agent name input is 18px, form inputs are 15px, settings inputs are 12-13px
3. Overall looks messy and inconsistent

## Plan

### File: `ui/chat/personalize-panel.css`

#### 1. Normalize input font sizes to 14px across all personalize inputs
- **Line 56**: `pz-name-input` — change `font-size: 18px` → `14px`, `font-weight: 600` → `500`
- **Line 74**: `pz-form-group input, textarea` — change `font-size: 15px` → `14px`
- **Line 80**: `pz-form-group select` — change `font-size: 15px` → `14px`
- **Line 114**: `pz-world-tab-content textarea` — change `font-size: 15px` → `14px`

#### 2. Remove double-container look from `pz-form-section`
- **Line 68**: `pz-form-section` — remove `background`, `border`, `border-radius` so it's just structural padding. Change to just `padding: 0; margin-bottom: 16px;`

#### 3. Normalize label sizing
- **Line 72**: `pz-form-group label` — change `font-size: 13px` → `12px`, remove `text-transform: uppercase`, remove `letter-spacing`

#### 4. Reduce agent name input max-width and padding
- **Line 56**: `pz-name-input` — change `padding: 12px 16px` → `8px 12px`, remove `max-width: 320px` (let it be `width: 100%`)

#### 5. Normalize form input padding
- **Line 74**: `pz-form-group input, textarea` — change `padding: 12px 14px` → `8px 12px`
- **Line 80**: `pz-form-group select` — change `padding: 12px 36px 12px 14px` → `8px 30px 8px 12px`

### Files to edit
- `ui/chat/personalize-panel.css` — all changes

### Verification
- `npm run typecheck && npm run lint` (CSS-only changes, should pass)
- Visual: all inputs in personalize panel should have consistent 14px font, uniform padding, no nested container boxing
