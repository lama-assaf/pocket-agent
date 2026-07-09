# memory

atelier memory is **per-project**. each project you work in gets its own
`.atelier/memory/` directory at the project root:

    <project>/.atelier/memory/
    ├── instincts.md   # short, durable patterns for this project, injected automatically
    ├── lessons.md     # dated takeaways from work in this project
    ├── decisions/     # one file per significant project decision
    └── glossary.md    # project-specific terminology that overrides defaults

## how it gets used

the prompt-context hook (scripts/hooks/prompt-context.js) resolves the current
project from the hook's `cwd` and injects that project's `instincts.md` as
context. if the project has no memory directory, the seed `instincts.md` in
this folder is used as a fallback (and skipped while it still contains only
template examples).

## this directory is the seed

the files here are **templates**. `/atelier:memory-init` copies instincts.md,
lessons.md, glossary.md, and decisions/README.md into a project's
`.atelier/memory/`; `templates/` stays seed-side only (it's not copied — see
`commands/memory-init.md`). edit the files here to change what new projects
start with; edit the project's own `.atelier/memory/` to change what atelier
remembers about that project.

## commands

- `/atelier:memory-init` — seed `.atelier/memory/` in the current project
- `/atelier:remember <note>` — append a dated entry to the project's lessons.md
- `/atelier:remember --instinct <note>` — add a standing rule to instincts.md

## committed or ignored?

committed by default — project memory is most useful when the whole team's
sessions share it. add `.atelier/` to `.gitignore` instead if you want memory
to stay personal to your machine.

## maintenance

once a quarter, per project: prune instincts that no longer apply, archive old
decisions, update the glossary. memory that grows unchecked stops being useful.
