---
name: landing-copy
description: Write landing page copy including hero, sections, social proof, and ctas. Use whenever the user mentions landing page, landing copy, homepage copy, marketing site, hero section, or needs copy for a page designed to convert.
---

# landing-copy

a landing page does three jobs: get the visitor to understand what this is, believe it's for them, and take the next action.

## the anatomy

### hero (above the fold)

- headline: the one-line value prop
- subhead: one sentence that supports the headline with a bit more detail
- primary cta: the action you want the visitor to take
- secondary cta (optional): a lower-commitment action (learn more, see demo, read docs)
- visual: a product shot, illustration, or video that makes the abstract concrete

the hero must answer "what is this and is it for me?" without scrolling.

### problem section

show the visitor that you understand their situation. specific, recognizable, painful. one to three short paragraphs or bullets.

### solution section

how your product addresses the problem. introduce the principle first, then show the product.

### feature sections (2-4 of them)

each feature section makes one claim with one piece of supporting evidence (a screenshot, a quote, a number, a demo).

structure per section:

- claim (headline)
- explanation (one short paragraph)
- evidence (visual)
- (optional) sub-cta to the relevant deep page

### social proof

quotes, logos, numbers. specific over general. one quote is worth twenty logos if the quote is good.

quotes should be: a named person, a specific outcome, an honest voice.

### objection handling

what would stop a visitor from converting? answer it.

- common: pricing, integrations, security, migration cost, learning curve, support
- format: faq, comparison table, or short objection-and-response section

### final cta

repeat the primary action. lower friction this time if possible (e.g. "start free" instead of "talk to sales").

### footer

practical: navigation, legal, contact, social, status.

## the rules

- write in the audience's voice, not your team's
- each section is independently scannable
- headlines do most of the work; bodies are read by people already interested
- specific over abstract: "ship in days" beats "move faster"
- numbers and names over adjectives
- one cta per section; multiple ctas compete

## what to avoid

- "the future of X"
- "join thousands of teams" without a specific number
- hero copy that requires three reads
- corporate adverbs (truly, simply, easily, seamlessly)
- screenshots of dashboards full of fake data
- testimonials with no name or title
- carousels (most visitors see only the first slide)
- chat widgets that interrupt before the visitor has read anything

## output

```
hero
  headline: [option a, option b, option c]
  subhead: [option a, option b]
  primary cta: [option]
  secondary cta: [option]
  visual direction: [what's in the visual]

problem section
  headline: [option]
  body: [draft]

solution section
  headline: [option]
  body: [draft]
  visual direction: [what to show]

feature section 1
  claim: [option]
  body: [draft]
  evidence: [what supports it]

feature section 2 (and 3, 4)
  [same shape]

social proof
  quote candidates: [list]
  logo selection: [list]
  numbers worth using: [list]

objection handling
  objection: [response]

final cta
  headline: [option]
  body: [draft]
  cta: [option]
```

once you have all this, write a single rendered draft and a single revision pass on it.
