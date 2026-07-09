---
name: remember
description: append a note to this project's shared memory (lessons.md, or instincts.md with --instinct)
---

# /remember

save a note into the current project's shared `.atelier/memory/`, the same
directory atelier reads and writes, so a lesson or instinct saved here is
visible to both plugins.

usage:

- `/salon:remember <note>`: append a dated entry to `lessons.md`
- `/salon:remember --instinct <note>`: add a standing rule to `instincts.md`

## steps

1. read the note from $ARGUMENTS. if $ARGUMENTS starts with `--instinct`,
   strip that flag and target `instincts.md`; otherwise target `lessons.md`.
   if the remaining note is empty, ask the user what to remember and stop.
2. if `<project>/.atelier/memory/` does not exist, create the directory and
   the target file first (empty file with just a `# lessons` or `# instincts`
   heading; do not run the full memory-init seeding).
3. append to the target file:
   - lessons.md entry format:

     ## YYYY-MM-DD — [short label you derive from the note]

     [the note, lightly edited for clarity]

   - instincts.md entry format (one bullet at the end of the file):

     - **[2-4 word label]**: [the note as a directly applicable rule]

4. use today's real date. keep the user's meaning; fix only grammar.
5. confirm to the user what was written and to which file.
