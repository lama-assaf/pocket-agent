---
name: content-calendar
description: plan a content calendar tied to goals, audiences, and channels
---

# /content-calendar

build a content plan, not a list of dates. invokes content-calendar skill.

## what it does

ties every entry to a goal, audience, and channel. names an owner. surfaces gaps.

## how to use

```
/content-calendar
```

then provide:

1. period (month, quarter)
2. 1-3 goals for the period
3. audiences to reach
4. channels available
5. team capacity
6. content already in motion
7. brand voice (extracted or canonical)

## output

- themes (3-5 for the period) with why, audience, channels
- calendar by week, with named owner per piece
- per-channel view (blog, social, email, video)
- per-owner view
- gaps list (themes under-resourced, weeks over-booked)
- one-page summary for sharing

## rules it follows

- one goal per piece
- named owner (one person, not "team")
- plan to capacity, not ambition
- leave 20% open for news, opportunities, breathing room
- end-of-period review on the calendar

## what it doesn't do

- write the content
- guarantee distribution
- replace conversation with the people executing

## related

- `/voice-extract` — voice for the content
- `/messaging` — claims the content reinforces
- `/launch` — launch-driven content plans
- `/release` — release notes are content too
