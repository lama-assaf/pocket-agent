---
name: component-spec
description: Write a complete component specification including api, states, variants, accessibility, and usage. Use whenever the user needs a component spec, component documentation, component api design, or is designing a new component for a design system.
---

# component-spec

a complete spec for one component. covers what it is, how to use it, what props it takes, every state it can be in, and how it behaves.

## structure

```
# [ComponentName]

## purpose
one sentence: what this component is for.

## when to use
specific scenarios where this is the right component.

## when not to use
common misuses, with alternatives.

## anatomy
labeled diagram (described in markdown) of the visible parts.

## props / api
| prop | type | default | required | description |

## variants
- size: [list]
- style: [list]
- state: [list]

## states
- default
- hover
- focus
- active
- disabled
- loading
- error
- empty
each with a one-line description of the visual and behavior.

## accessibility
- role
- keyboard interactions (key + behavior)
- aria attributes used and why
- focus management
- screen reader behavior

## composition
- what this component is made of (other components, primitives)
- what this component can contain (slots, children)

## examples
3-5 usage examples covering common cases.

## related components
- when to use [X] instead
- often paired with [Y]
```

## what to avoid

- describing visual style in prose. show tokens.
- inventing props you don't need yet.
- copying from other libraries without considering your own conventions.
- listing every possible variant when only three are commonly needed.
