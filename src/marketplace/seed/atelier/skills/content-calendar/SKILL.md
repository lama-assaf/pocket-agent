---
name: content-calendar
description: Plan a content calendar tied to product, brand, or marketing goals. Use when the user asks for a content plan, editorial calendar, content strategy, posting schedule, or wants to map content to themes and audiences over a period of time.
---

# content-calendar

plan content with intent. tie every entry to a goal, an audience, and a channel.

## what this skill does

builds a content calendar that's actually a plan, not a list of dates. each entry has: who it's for, what it's trying to do, where it goes, who owns it, and what counts as success.

## when to use

- a team is starting content from scratch
- existing content is happening but nobody can name why
- before a launch, to plan supporting content
- quarterly, to set the next cycle's themes

## inputs required

before building the calendar:

1. **goals** for the period (1-3 max; if more, the calendar will drift)
2. **audiences** the content needs to reach
3. **channels** available (owned, earned, paid; blog, social, email, video, podcast)
4. **team capacity** (writers, editors, designers; hours per week)
5. **content already in motion** (don't double-book)
6. **brand voice** (extracted or canonical; content without voice is just text)

if any of these are missing, surface that before planning. content calendars built on hope drift fast.

## the structure

```
period: [Q1 2026 / month / week — whatever fits]
goal 1: [specific, measurable]
goal 2: [optional]
goal 3: [optional]

themes (3-5 for the period)
  theme 1: [short label]
    why: [the bet this represents]
    audience: [primary]
    channels: [list]
    content count: [planned pieces]

calendar by week
  week 1
    [piece]: [title / topic, channel, owner, due date, status, goal it serves]
    [piece]: ...
  week 2
    ...

quality bar
  - every piece names its audience
  - every piece names its goal
  - every piece names its primary channel
  - every piece names its owner
  - every piece has a date

what's not in this calendar
  - content that doesn't tie to a goal
  - "let's just be present on platform X" without a why
  - reposts of last quarter's content with new dates
```

## the rules

1. **one goal per piece**: if a piece is supposed to drive signups AND build authority AND nurture leads, it'll do none of them well.

2. **named owner**: "marketing team" is not an owner. one person's name. accountability requires a name.

3. **less than you think**: most teams plan 2-3x more than they ship. plan to capacity, not to ambition.

4. **theme over topic**: a theme is a bet on what to teach or claim. a topic is a single piece. themes generate topics; topics don't accumulate into themes.

5. **don't fill weeks for the sake of filling**: a week with one strong piece beats a week with five mediocre ones. plan capacity, not cadence.

6. **leave 20% open**: news happens. opportunities show up. burnout happens. a fully-booked calendar can't absorb any of these.

7. **end-of-period review goes on the calendar**: if you don't schedule the review, it doesn't happen, and the next calendar is built on guesses.

## channel-specific guidance

### blog / longform

- 1-2 substantive pieces per week is plenty
- name the search intent or the share intent before drafting
- check past performance before committing to a topic

### social

- frequency depends on platform; resist the urge to match what others do
- if posting daily means posting filler, post less
- distinguish original content from reshare

### email

- frequency tied to subscriber expectation (set on signup)
- one primary CTA per email
- segment by audience, not by guess

### video

- highest production cost per unit; plan accordingly
- one good video > four mediocre ones
- platform-native vs. cross-platform: decide upfront

### podcast

- consistency matters more than frequency
- guest pipeline is a separate ops problem; build it before announcing
- transcripts and clips are content too; plan their lifecycle

## output

a full calendar in markdown with the structure above. plus:

- a one-page summary for sharing
- a per-channel view (what's on the blog this quarter, what's in email, etc.)
- a per-owner view (what each person is responsible for)
- gaps list (themes with too few pieces; weeks with too many)

## what this skill doesn't do

- write the content (that's downstream of the calendar)
- guarantee distribution (the calendar plans creation; promotion is a separate plan)
- replace conversation with the people who'll execute (review the draft with them)

## related

- voice-extract (voice for the content)
- messaging-architecture (the claims content should reinforce)
- launch-planning (launches generate content needs; align here)
- release-narrative (content that ships alongside product releases)
