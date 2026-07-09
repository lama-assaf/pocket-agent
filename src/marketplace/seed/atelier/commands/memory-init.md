---
name: memory-init
description: seed per-project atelier memory (.atelier/memory/) in the current project
---

# /memory-init

seed the current project with atelier per-project memory.

## steps

1. determine the project root (the current working directory's repo root, or
   the cwd itself if not a git repo).
2. if `<project>/.atelier/memory/` already exists, report that memory is
   already initialized, list the files it contains, and STOP. never overwrite
   existing memory.
3. create the directory structure and copy seed content from the plugin:
   - `.atelier/memory/instincts.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/instincts.md`
   - `.atelier/memory/lessons.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/lessons.md`
   - `.atelier/memory/glossary.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/glossary.md`
   - `.atelier/memory/decisions/README.md` ← `${CLAUDE_PLUGIN_ROOT}/memory/decisions/README.md`
4. tell the user:
   - memory is seeded and which files were created
   - instincts.md is injected automatically once they replace the template
     examples with their own entries
   - memory is meant to be committed so the team shares it; if they prefer
     machine-local memory, add `.atelier/` to `.gitignore`

## notes

- do not create `templates/` in the project; project memory starts minimal.
- if `${CLAUDE_PLUGIN_ROOT}` is not set (running outside the installed plugin),
  fall back to the repo checkout's `memory/` directory.
