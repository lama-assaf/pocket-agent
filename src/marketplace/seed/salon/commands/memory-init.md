---
name: memory-init
description: seed or extend the shared per-project memory (.atelier/memory/) with salon's files
---

# /memory-init

seed the current project with salon's per-project memory, sharing the same
`.atelier/memory/` tree atelier uses. this command never overwrites an
existing file, regardless of which plugin wrote it.

## steps

1. determine the project root (the current working directory's repo root, or
   the cwd itself if not a git repo).
2. if `<project>/.atelier/memory/` already exists (atelier or a previous
   salon run created it), ADD ALL salon-side files that are missing:
   - `.atelier/memory/instincts.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/instincts.md`
   - `.atelier/memory/lessons.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/lessons.md`
   - `.atelier/memory/voice.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/voice.md`
   - `.atelier/memory/campaigns/README.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/campaigns/README.md`

   for each, check if the file already exists before writing. never touch a
   file that's already there — not `instincts.md`, not `lessons.md`, not
   `voice.md` if it's already been customized. report exactly which files
   were added and which were already present and left alone.
3. if `<project>/.atelier/memory/` does not exist at all, create the full
   shared base plus salon's additions in one pass:
   - `.atelier/memory/instincts.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/instincts.md`
   - `.atelier/memory/lessons.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/lessons.md`
   - `.atelier/memory/voice.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/voice.md`
   - `.atelier/memory/campaigns/README.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/campaigns/README.md`

   (salon's `instincts.md` and `lessons.md` seeds mirror atelier's shape, so
   this stays a valid base even if atelier is never installed.)
4. tell the user:
   - which files were created and which were already present
   - memory is meant to be committed so the team shares it; if they prefer
     machine-local memory, add `.atelier/` to `.gitignore`
   - if atelier is also installed on this project, it reads and writes the
     same directory, and neither plugin will clobber the other's files. one
     gap to flag: if salon seeded the tree first and atelier is installed
     later, atelier's own memory-init stops the moment it sees the directory
     already exists, so it won't lay down its `glossary.md` or `decisions/`
     seeds. tell the user to seed those manually from atelier's own templates
     if they want them.

## notes

- do not create `templates/` in the project; project memory starts minimal.
- if `${CLAUDE_PLUGIN_ROOT}` is not set (running outside the installed
  plugin), fall back to the repo checkout's `memory/` directory.
- this command is idempotent: running it again after atelier has since
  initialized (or vice versa) only fills in whatever is still missing.
