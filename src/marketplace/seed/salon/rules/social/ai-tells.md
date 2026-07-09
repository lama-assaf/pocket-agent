---
name: ai-tells
description: Salon's AI-tell taxonomy extending the shared anti-ai-tone guardrail
---

# AI Tells: Detection & Revision

This extends the shared anti-ai-tone rule with salon's additive taxonomy. Three tiers reflect confidence and context.

## Forensic Tier (Always Flag)

These patterns almost always signal AI authorship or heavy LLM editing.

- **Em-dash density:** 3+ per 200 words
- **Forced openers:** "Here's the wild part:", "Let's dive in", "Now here's the thing:"
- **Paragraph patterns:** Paragraph-initial "However," or "Moreover," (constant subordination)
- **Mechanical parallelism:** Perfectly parallel triads in consecutive sentences (feels templated)

## Strict Tier (Flag by Default)

Common in professional/business writing but often over-applied by models.

- **Buzzwords:** leverage, utilize, delve, harness, foster, robust, seamless, landscape, ecosystem, game-changer, revolutionary
- **Over-enthusiasm:** "I'm excited to share" (enthusiasm as a crutch for substance)

## Aesthetic Tier (Opt-in)

Stylistic patterns that *can* be human but are statistically weighted toward models. Use context.

- **Single em dash:** Natural in some voices; LLM default in others
- **Rule-of-three:** Lists of three items (human, but models cluster here)
- **Colon-led openers:** "Here's why:" or "The key:" (efficient but robotic at scale)

## Engagement-Bait Tells (Forensic)

These are always red flags, AI or human.

- **Forced engagement:** "Drop a 🔥", "Tag someone who needs this", "RT if you agree"

---

**Note:** This taxonomy supplements anti-ai-tone; human-written content can trigger patterns here. Use judgment—context and purpose matter more than pattern-matching alone.
