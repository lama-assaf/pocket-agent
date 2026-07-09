---
name: naming-generation
description: Generate names for products, features, companies, or brands with rationale and availability checks. Use whenever the user needs a name, wants naming options, asks for product naming, company naming, feature naming, or wants help finding a name with the right meaning and that's actually available.
---

# naming-generation

a good name does work. it suggests what the thing is, it's easy to say and spell, and it's available.

## inputs

before generating:

1. what's being named (product / feature / company)
2. what it does (the literal function)
3. who it's for (the audience whose ear it has to land in)
4. what it should evoke (energy, register, archetype)
5. constraints (length, language, must-avoid, must-include)
6. availability requirements (domain, npm, app store, trademark, social handles)

if these aren't clear, generate broadly across categories. if they are, narrow.

## the five categories

generate 20-30 candidates across these:

### descriptive

literal description of what it does.

- examples: PayPal, JetBlue, General Motors
- strength: instantly clear
- weakness: hard to trademark, often unavailable, doesn't grow with the product

### suggestive

implies the function without stating it.

- examples: Stripe (clean lines, financial connection), Asana (Sanskrit for posture / steadiness)
- strength: clear enough but trademark-able
- weakness: requires a tiny leap

### evocative

mood, archetype, or imagery.

- examples: Patagonia, Amazon, Tesla
- strength: emotional resonance, room to grow
- weakness: requires marketing to fill in meaning

### invented

coined words, often based on roots or sounds.

- examples: Kodak, Zappos, Spotify
- strength: distinctive, available, trademark-strong
- weakness: harder to remember at first, requires repetition

### metaphor

borrows meaning from another domain.

- examples: Apple, Amazon, Twitter
- strength: rich associations, memorable
- weakness: associations are partly out of your control

## quality checks to run on the top candidates

- **pronunciation**: can a stranger say it correctly on first read?
- **spelling**: does the user need to hear it spelled out?
- **search collision**: what comes up on the first page of search results today?
- **domain availability**: which extensions are open (.com, .io, .co, etc.)
- **npm / app store availability**: if relevant to the product
- **trademark search**: is anything obviously conflicting in the same class
- **international**: does it mean something embarrassing or unintended in a major market language
- **negative associations**: what would a cynical reader assume

## output

```
candidate
  category: [descriptive / suggestive / evocative / invented / metaphor]
  meaning: [what it suggests and why]
  pronunciation: [easy / requires care]
  spelling: [easy / requires explanation]
  search collision: [clear / contested / blocked]
  domain status: [extensions found available]
  npm status: [taken / available]
  trademark concerns: [list or "none found"]
  vibe: [one line on how it feels]

[20-30 candidates]

top three recommendations
  1. [name] — [why]
  2. [name] — [why]
  3. [name] — [why]

one anti-recommendation
  [name] — [why this sounds good but has a fatal flaw]
```

## what to avoid

- names that are very close to an established brand in your category
- names that depend on a particular spelling people won't reproduce
- names with apostrophes or special characters
- names that work only in english if the audience is global
- names you have to explain
