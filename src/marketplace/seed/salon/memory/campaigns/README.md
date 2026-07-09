# campaigns

one file per campaign, at `.atelier/memory/campaigns/<slug>.md`. a campaign
file is the single source of truth for that campaign's lifecycle: strategy,
engagement, and retro skills all read and append to the same file rather than
scattering state across separate documents.

## lifecycle sections

each campaign file grows through four sections, in order, as the campaign
progresses. don't skip a section; a thin section (even one line: "n/a for
this campaign") is better than a missing one.

1. **brief**: written by `/salon:campaign` (campaign-brief skill). goal,
   audience, key message, platforms in play, constraints/banned topics.
2. **calendar**: written by the content-calendar skill. dated slots, one
   line per planned post: platform, format, working title, status.
3. **engager ledger**: appended to as the campaign runs. one row per
   recurring or high-weight engager: handle, tier, posts engaged, suggested
   next action.
4. **retro**: written by `/salon:retro` (campaign-retro skill) once the
   campaign wraps. what worked, what didn't, lessons worth promoting into
   `.atelier/memory/lessons.md`.

## naming

slugs are lowercase-kebab-case, short enough to type from memory:
`launch-week`, `q3-hiring-push`, `conference-recap`. one file per campaign;
don't split a single campaign across multiple files.

## this directory is salon-specific

`campaigns/` is added by salon into the shared `.atelier/memory/` tree.
atelier doesn't read or write it. see `../README.md` for how salon and
atelier share the rest of the memory directory.
