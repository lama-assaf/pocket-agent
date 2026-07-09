# memory

salon memory is **per-project** and **shared with atelier**. there is no
`.salon/` directory — both plugins read and write the same tree at the
project root:

    <project>/.atelier/memory/
    ├── instincts.md      # short, durable patterns for this project (atelier base)
    ├── lessons.md        # dated takeaways from work in this project (atelier base)
    ├── decisions/        # one file per significant project decision (atelier base)
    ├── glossary.md        # project-specific terminology (atelier base)
    ├── voice.md           # brand voice profile (salon addition)
    └── campaigns/         # one file per campaign, lifecycle sections (salon addition)

## who owns what

atelier owns the base layout — `instincts.md`, `lessons.md`, `decisions/`,
`glossary.md`. salon adds `voice.md` and `campaigns/` into that same tree.
neither plugin touches the other's files beyond reading them: salon's writing
skills read `instincts.md` and `voice.md`; salon never edits atelier's
`decisions/` or `glossary.md`.

if both plugins are installed on a project, they cooperate automatically —
`/atelier:memory-init` seeds the atelier base, `/salon:memory-init` fills in
whatever's missing (its own files, or the whole tree if atelier hasn't run
yet). neither command overwrites a file the other one already wrote.

## how it gets used

the prompt-context hook (scripts/hooks/prompt-context.js) resolves the
current project and injects `instincts.md` as context automatically, plus
`voice.md` when a writing-related keyword is detected in the prompt. if the
project has no memory directory yet, the seed `instincts.md` in this folder
is used as a fallback (and skipped while it still contains only template
examples).

## this directory is the seed

the files here are **templates**, salon's copies of the shared-tree seeds.
`/salon:memory-init` copies whichever of `instincts.md`, `lessons.md`,
`voice.md`, and `campaigns/README.md` are missing from the project's
`.atelier/memory/` — it never overwrites a file that's already there,
whether atelier or salon put it there.

## commands

- `/salon:memory-init` — seed or extend `.atelier/memory/` in the current project
- `/salon:remember <note>` — append a dated entry to the project's lessons.md
- `/salon:remember --instinct <note>` — add a standing rule to instincts.md

## committed or ignored?

committed by default — project memory (including campaign history and voice)
is most useful when the whole team's sessions share it. add `.atelier/` to
`.gitignore` instead if you want memory to stay personal to your machine.

## maintenance

once a quarter, per project: prune instincts that no longer apply, archive
finished campaigns, and re-check voice.md still matches how the brand
actually sounds. memory that grows unchecked stops being useful.
