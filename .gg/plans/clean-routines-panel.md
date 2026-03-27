# Simplify Routines Panel — Remove Creator, Keep Job List Only

## Problem
The routines panel has a complex job creation form (name, schedule tabs, time pickers, day selectors, prompt source, textarea) that takes up most of the screen. The agent creates routines itself anyway, so this form is unnecessary clutter. We want to simplify to just show the list of existing routines.

## Plan

### File: `ui/chat.html`

#### 1. Remove the entire creation form section
Remove the first `<section class="rtn-section">` block (lines ~786-864) containing the `rtn-grid` with all the form rows (Job Name, When, Source, Prompt, Let's Go button).

Keep only the "Running on Autopilot" section, but simplify it — remove the `<h2>` and `<p>` titles since there's only one section now. The `rtn-grid` wrapper with `rtn-jobs-list` stays.

The routines content should become:
```html
<div class="routines-content">
  <div class="rtn-grid">
    <div id="rtn-jobs-list" class="rtn-jobs-list">
      <div class="rtn-empty">
        <svg ...clock icon...></svg>
        <p>Loading...</p>
      </div>
    </div>
  </div>
</div>
```

### File: `ui/chat/routines-panel.css`

#### 2. Remove form-related CSS rules that are no longer needed
Remove these selectors (they only applied to the creation form):
- `.rtn-section-title` (line 72-78)
- `.rtn-section-desc` (line 80-84)
- `.rtn-row` and all its variants (lines 94-104, 106-112, 114-134, 136-143, 145)
- `.rtn-name-session` (lines 148-150)
- `.rtn-schedule-tabs` and `.rtn-schedule-tab` (lines 153-173)
- `.rtn-time-picker` (lines 176-178)
- `.rtn-day-selector` and `.rtn-day-btn` (lines 181-202)
- `.rtn-interval-input` and `.rtn-interval-label` (lines 205-207)
- `.rtn-schedule-options` (lines 210-211)
- `.rtn-row.full-width`, `.rtn-row.schedule-row` (lines 214-217)
- `.rtn-create-btn` (lines 220-242)

Keep:
- Header styles (already clean)
- Content/scrollbar styles
- `.rtn-section` (still used as wrapper)
- `.rtn-grid` (wraps the jobs list)
- `.rtn-jobs-list`, `.rtn-job-item`, `.rtn-job-status`, `.rtn-job-info`, `.rtn-job-name`, `.rtn-job-session-badge`, `.rtn-job-schedule`, `.rtn-job-prompt`, `.rtn-job-actions`, `.rtn-icon-btn`, `.rtn-empty`

#### 3. Normalize font sizes & padding to match personalize panel cleanup
- `.rtn-grid`: keep bg/border/radius, that's fine — it's the job list container
- `.rtn-job-item`: padding `12px 14px` → `10px 14px` (slightly tighter)
- `.rtn-job-name`: font-size `13px` is fine
- `.rtn-job-schedule`: fine at `11px`
- `.rtn-job-prompt`: fine at `11px`

#### 4. Remove the `.rtn-section` margin-bottom since there's only one section now
- `.rtn-section`: change `margin-bottom: 24px` → `margin-bottom: 0`

### File: `ui/chat/routines-panel.js`

#### 5. Remove creation form JS functions and init code
Remove:
- `_rtnCurrentScheduleType` variable (line 5)
- `_rtnSelectedDays` variable (line 6)
- `_rtnSessionsMap` variable (line 7)
- `_rtnWorkflowCommands` variable (line 8)
- The entire `_rtnInit()` function (lines 85-124) — replace with a no-op or just call `_rtnLoadJobs()` directly in `showRoutinesPanel`
- `_rtnTo24Hour()` function (lines 128-133)
- `_rtnBuildCronExpression()` function (lines 135-159)
- `_rtnLoadSessions()` function (lines 217-228)
- `_rtnLoadWorkflows()` function (lines 230-242)
- `rtnHandlePromptSourceChange()` function (lines 293-309)
- `rtnCreateJob()` function (lines 311-332)

Keep:
- `showRoutinesPanel` / `hideRoutinesPanel` / `toggleRoutinesPanel` — but simplify `showRoutinesPanel` to just call `_rtnLoadJobs()` directly (remove `_rtnInit` call)
- `_rtnShowToast` helper
- `_rtnEscapeHtml` / `_rtnEscapeAttr` helpers
- `_rtnParseDbTimestamp`, `_rtnScheduleToHuman` — needed for display
- `_rtnLoadJobs` — the core display function
- `rtnToggleJob`, `rtnRunJob`, `rtnDeleteJob` — action buttons on jobs

Update `showRoutinesPanel`:
- Remove the `_rtnInit()` call and `_rtnInitialized` guard
- Just call `_rtnLoadJobs()` directly

Also keep `_rtnSessionsMap` and `_rtnLoadSessions` — they're needed by `_rtnLoadJobs` to display session names. But remove the creation-form part of `_rtnLoadSessions` (the `sel.innerHTML = ...` bit that populates the `<select>` element). Actually, just keep the map-building part.

### Verification
- `npm run typecheck && npm run lint`
- Visual: routines panel shows only the job list, no creation form
