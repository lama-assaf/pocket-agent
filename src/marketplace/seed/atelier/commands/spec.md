---
name: spec
description: write a feature or technical specification
---

# /spec

write a spec that an engineer can implement against. invokes the spec-writing skill.

## what you'll get

a structured doc covering:

- entry points
- primary flow
- every state (default, loading, empty, partial, error, success, offline)
- edge cases (input ranges, network failure, concurrency, permissions)
- data inputs and outputs
- permissions
- acceptance criteria in given/when/then form
- out of scope
- open questions

## how to use

```
/spec [feature name]
```

then describe the feature. the command asks for what it needs.

## what it doesn't do

- dictate implementation (database, framework, library choices)
- repeat work better done in the prd (why and what)

a prd answers should we build it. a spec answers exactly how it behaves.
