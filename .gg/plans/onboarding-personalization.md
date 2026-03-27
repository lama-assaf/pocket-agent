# Onboarding: Add Personalization & CLI Install Steps

## Overview

Extend the existing onboarding wizard (embedded in `chat.html`) with new steps **after** auth is completed but **before** the final success screen. Each step collects one piece of information — simple, one question per screen. All steps are skippable.

## Current Flow
1. **Keychain** → 2. **Permissions** (macOS only) → 3. **Auth Method** → 4. **OAuth/API Key** → 5. **Success**

## New Flow
1. **Keychain** → 2. **Permissions** (macOS) → 3. **Auth Method** → 4. **OAuth/API Key** → 5. **Your Name** → 6. **Your Location** → 7. **Your Occupation** → 8. **Your Birthday** → 9. **Agent Name** → 10. **Agent Personality** → 11. **Your Goals** → 12. **Your Struggles** → 13. **Fun Facts** → 14. **Pocket CLI** → 15. **Success**

Each personalization step (5–13) is: one question, one input, a continue button, and a "skip" link. Minimal, clean, same visual style as existing onboarding steps.

## Skip Mechanism

Every personalization step (5–14) has **two skip options**:

1. **"skip" link** — skips just this step, moves to the next one (saves nothing for this field)
2. **"skip all, start chatting" link** — jumps straight to the success screen, skipping all remaining personalization + CLI steps

Both are text links below the continue button, stacked vertically:
```
[Continue →]

skip
skip all, start chatting
```

The "skip all" link is slightly more muted than the per-step skip. This ensures users who don't want to fill anything out can bail immediately on the first personalization step without clicking through 10 screens.

## Progress Indicator

Add a subtle dot-based progress indicator at the top of the onboarding container (below the subtitle). Shows current position in the flow. Dots are small, muted — active dot is accent-colored.

## Files to Modify

### 1. `ui/chat.html` (lines ~261–276)
Insert new `ob-step` divs between the auth completion and the success step.

**New steps to add (each as a `<div class="ob-step" id="ob-step-{id}">`):**

#### Step: Your Name (`ob-step-name`)
- Label: "what should I call you?"
- Input: text, placeholder "your name"
- Saves to: `profile.name`

#### Step: Your Location (`ob-step-location`)
- Label: "where are you based?"
- Input: text with location autocomplete (reuse existing `pz-` autocomplete pattern from `personalize-panel.js`)
- Saves to: `profile.location` + auto-sets `profile.timezone`

#### Step: Your Occupation (`ob-step-occupation`)
- Label: "what do you do?"
- Input: text, placeholder "developer, designer, student..."
- Saves to: `profile.occupation`

#### Step: Your Birthday (`ob-step-birthday`)
- Label: "when's your birthday?"
- Input: month + day selects (same as personalize panel)
- Saves to: `profile.birthday`

#### Step: Agent Name (`ob-step-agent-name`)
- Label: "what would you like to call me?"
- Input: text, placeholder "Frankie", default value "Frankie"
- Saves to: `personalize.agentName`

#### Step: Agent Personality (`ob-step-personality`)
- Label: "how should I act?"
- Input: textarea (4 rows), placeholder "chill, witty, to the point..."
- Saves to: `personalize.personality`

#### Step: Your Goals (`ob-step-goals`)
- Label: "what are you working toward?"
- Input: textarea (4 rows), placeholder "launch my startup, learn piano..."
- Saves to: `personalize.goals`

#### Step: Your Struggles (`ob-step-struggles`)
- Label: "what are you dealing with?"
- Input: textarea (4 rows), placeholder "time management, staying focused..."
- Saves to: `personalize.struggles`

#### Step: Fun Facts (`ob-step-funfacts`)
- Label: "anything else I should know?"
- Input: textarea (4 rows), placeholder "I have a dog named Max, I'm vegetarian..."
- Saves to: `personalize.funFacts`

#### Step: Pocket CLI (`ob-step-cli`)
- Label: "install pocket CLI for terminal access"
- Info text: "Use `pocket` from your terminal to chat, run tasks, and more"
- Button: "Install Pocket CLI" (primary) — triggers the same install logic from `settings-panel.js`
- Shows install status/progress
- Skip link: "skip for now"

### 2. `ui/chat/onboarding.js`

Add new functions:

```javascript
// Progress indicator
function obUpdateProgress(stepId) // updates dot indicator based on current step

// Navigation helpers — each step saves its value and moves to next
async function obSaveName()       // save profile.name → go to location
async function obSaveLocation()   // save profile.location + timezone → go to occupation
async function obSaveOccupation() // save profile.occupation → go to birthday
async function obSaveBirthday()   // save profile.birthday → go to agent-name
async function obSaveAgentName()  // save personalize.agentName → go to personality
async function obSavePersonality()// save personalize.personality → go to goals
async function obSaveGoals()      // save personalize.goals → go to struggles
async function obSaveStruggles()  // save personalize.struggles → go to funfacts
async function obSaveFunFacts()   // save personalize.funFacts → go to CLI
async function obInstallCli()     // run CLI install → go to success

// Skip helpers
function obSkipToSuccess()        // jump straight to success from any personalization step
```

Each save function:
1. Gets input value
2. If not empty, saves via `window.pocketAgent.settings.set(key, value)`
3. Calls `obShowStep('next-step-id')`

`obSkipToSuccess()` simply calls `obShowStep('ob-step-success')` — used by the "skip all, start chatting" link on every personalization step.

**Location autocomplete**: Replicate the location autocomplete logic from `personalize-panel.js` but scoped to `ob-` prefixed elements. On city select, auto-fill timezone.

**Birthday**: Populate day select (1–31) on DOMContentLoaded, same as `_pzSetupBirthdayPicker`.

**CLI Install**: Reuse the same shell commands from `_stgCliCommands` (copy the constants into onboarding scope or extract to shared). Show spinner during install, success/error status after.

**Update `obShowStep`**: Add call to `obUpdateProgress(stepId)` to update the progress dots.

**Modify existing auth completion flows**: 
- In `obCompleteOAuth()` (line 284): change `obShowStep('ob-step-success')` → `obShowStep('ob-step-name')`
- In `obValidateAndSave()` (line 355): change `obShowStep('ob-step-success')` → `obShowStep('ob-step-name')`

**Add to `obShowStep` function**: Handle reset states for new steps (clear statuses, etc.)

### 3. `ui/chat/onboarding.css`

Add styles for:
- **Progress dots**: `.ob-progress` — flex row of small dots, centered
- **Progress dot**: `.ob-progress-dot` — 6px circles, muted color, `.active` gets accent color + slight scale
- **Textarea variant**: `.ob-form-group textarea` — same style as input but multi-line
- **Skip links container**: `.ob-skip-links` — stacked skip + skip-all, centered
- **Skip-all link**: `.ob-skip-all` — slightly more muted than regular skip link
- **CLI install status**: Reuse existing `.ob-status` classes

### 4. Update Success Step Text

In `chat.html` line ~267, update the success step text to reflect that everything is configured:
- "you're all set!" / "everything's configured, let's start chatting"

## Implementation Order

1. **CSS first** — Add progress dots + textarea + skip-all styles to `onboarding.css`
2. **HTML steps** — Add all new `ob-step` divs to `chat.html` (between auth steps and success)
3. **Progress indicator HTML** — Add `.ob-progress` div to onboarding container
4. **JS logic** — Add save/navigation functions + progress tracking + location autocomplete + CLI install + `obSkipToSuccess` to `onboarding.js`
5. **Wire up auth → personalization** — Change the two `obShowStep('ob-step-success')` calls to `obShowStep('ob-step-name')`
6. **Build & verify** — `npm run typecheck && npm run lint`

## Key Design Principles

- **One question per screen** — never overwhelm
- **Everything skippable** — "skip" on every step to skip that one step
- **Skip all** — "skip all, start chatting" on every personalization step to bail entirely
- **Auto-save on continue** — clicking continue saves the value, no separate save button needed
- **Enter key submits** — for text inputs, Enter → save & continue
- **Smooth transitions** — reuse existing `obStepIn` animation
- **Consistent visual style** — same `.ob-btn`, `.ob-form-group`, `.ob-status` classes

## Risks

- **Location autocomplete** requires `window.pocketAgent.location.lookup()` and `window.pocketAgent.location.getTimezones()` — these exist in preload already (used by personalize panel)
- **CLI install** requires `window.pocketAgent.shell.runCommand()` — exists in preload
- **Many steps** — 15 total might feel long. Mitigation: progress dots show they're quick, every step is one-tap skip, and "skip all" lets you bail immediately
