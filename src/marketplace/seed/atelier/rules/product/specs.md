# specs

a spec answers "how does this behave in every situation?" without dictating implementation.

## what a spec includes

- entry points
- primary flow (step by step)
- states (default, loading, empty, partial, error, success, offline)
- edge cases (input ranges, network failures, concurrency, permissions)
- data (inputs, outputs, persistence)
- permissions (who sees, who does, propagation)
- acceptance criteria (given/when/then)
- out of scope
- open questions

## rules

- behavior, not implementation
- every behavior gets an acceptance criterion
- specs are not entertaining; they are clear
- one feature, one spec

## the test

a spec is complete when an engineer can implement it without asking the spec writer questions, except about open questions named in the spec.
