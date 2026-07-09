---
name: voice-extract
description: extract a brand voice guide from existing copy samples
---

# /voice-extract

turn 5-20 samples of existing copy into a documented voice guide. invokes brand-voice-extraction.

## what it does

reads all samples before drawing conclusions. analyzes:

- sentence rhythm (avg length, range, variation)
- vocabulary range and register
- signature words (appear often)
- banned words (visible by absence)
- point of view (we / you / first / third)
- figurative range (metaphors, humor)
- structural patterns (openings, arguments, endings)

produces a guide someone else can write in.

## how to use

```
/voice-extract
```

then share:

1. 5-20 pieces of copy that represent the voice well
2. (recommended) 2-5 pieces that miss the voice
3. (optional) notes on the audience

## output

a full voice guide: principles, sentence rhythm, vocabulary, POV, structural patterns, what's not there, yes/no examples, the test.

## what it doesn't do

- improvise a voice if you don't share samples
- write a voice you wish you had instead of the one you have
