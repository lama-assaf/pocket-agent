---
name: spec-writing
description: Write a technical or feature specification covering behavior, states, edge cases, and acceptance criteria. Use whenever the user mentions spec, feature spec, technical spec, behavior spec, or needs a document that an engineer can implement against.
---

# spec-writing

a spec answers "how will this behave in every situation it could be in?" without describing implementation.

## the difference from a prd

a prd says why and what. a spec says how it behaves. the prd answers "should we build it?". the spec answers "what exactly are we building?".

## structure

```
# [feature name] spec

## overview
one paragraph: what this is, who uses it, what it lets them do.

## user-facing behavior

### entry points
how do users get here. list every path.

### primary flow
step by step, what the user does and what the system does back.

### states
- default
- loading
- empty
- partial (some data present, some missing)
- error
- success
- offline
for each, describe: what's shown, what's interactive, what changes when state changes.

### edge cases
list them explicitly:
- input outside expected range
- network failure mid-action
- concurrent edits
- expired auth
- permission boundaries
- very large inputs
- very small or zero inputs
- characters outside ascii
- timezone considerations

## data

### inputs
each field: name, type, validation, source.

### outputs
each piece of data the system produces or stores.

### persistence
what gets saved, where, for how long.

## permissions
who can see what.
who can do what.
how permission changes propagate.

## acceptance criteria

given/when/then statements that pass when the feature is correctly built:

given [precondition]
when [action]
then [expected result]

write enough of these to cover every state and every edge case.

## out of scope
explicit list of things adjacent that this spec does not address.

## open questions
what's not decided yet and who decides.
```

## rules

- specs are not implementation. don't dictate database choice or framework. do dictate behavior the user experiences.
- every behavior gets an acceptance criterion. if you can't write one, the behavior isn't specified.
- be boring. specs are read by people who need to implement, not be entertained.
