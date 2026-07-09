---
name: release-narrative
description: Write release notes, what's new posts, and ship announcements that tell users what shipped in their terms. Use whenever the user mentions release notes, changelog, what's new, ship announcement, version notes, or needs to communicate what changed in a release.
---

# release-narrative

release notes are user-facing. they exist to help users get value from what shipped. write for them, not for the internal team.

## the structure

```
[version] — [date]

[one-sentence summary of the headline change in user value terms]

new
- [feature]: [what it does for the user, in their language]

improved
- [improvement]: [the before and after, concretely]

fixed
- [bug]: [the symptom, not the technical cause]

breaking changes (only when present)
- [thing]: [old behavior → new behavior, with migration step]

heads up (only when present)
- [anything that affects workflow even if not a breaking change]
```

## the rules

### order by user impact, not by ship order

the most important change to the most users goes first. internal ordering, alphabetical ordering, or ticket-number ordering all serve the team, not the reader.

### one sentence per item

if you need two sentences, the item is two items, or you're explaining instead of stating.

### user language

what the user sees and does. not what the database does.

- bad: "fixed null pointer exception in the auth middleware on token expiration"
- good: "fixed an issue where you'd get logged out unexpectedly during long sessions"

### specific over general

- bad: "improved performance"
- good: "dashboards with 1000+ rows now load in 1.2 seconds, down from 4 seconds"

### one verb tense across all items

usually past tense for what shipped. don't mix "added" and "you can now".

### no internal jargon

no jira ticket numbers in user-facing notes. no internal project codenames. no "as discussed in the #product channel".

### breaking changes get prominent treatment

if there's a breaking change, label it clearly, name the old and new behavior, and tell users exactly what to change.

## what not to include

- celebrating internal milestones in user-facing channels
- "we listened to your feedback" (just ship the fix)
- "exciting news" (the news is the news)
- every commit (release notes are not a git log)
- bugs nobody noticed (sometimes leave them out; sometimes mention them with context)

## the tone

calm. confident. specific. write like a colleague telling another colleague what happened, not like a marketing department.

if the brand voice is more playful, the structure stays the same; the diction relaxes a notch. don't sacrifice clarity for personality.

## output

```
[version] — [date]

[summary sentence]

new
- [items in user-impact order]

improved
- [items in user-impact order]

fixed
- [items in user-impact order]

breaking changes (if any)
- [items with migration steps]

heads up (if any)
- [items]
```

length depends on the release. a small patch may be three bullets. a major release with breaking changes may be a longer post with deep-link sections.

## what to avoid

- inflating tiny changes
- understating breaking changes
- using exclamation points to signal importance
- ending with "as always, thanks for using [product]"
- a post-mortem disguised as release notes (post-mortems are their own genre)
