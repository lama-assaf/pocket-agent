---
name: data-viz-design
description: Design data visualizations including charts, graphs, and dashboards with attention to clarity, color use, and chart selection. Use whenever the user mentions data viz, charts, graphs, dashboards, analytics design, or needs to communicate numbers visually.
---

# data-viz-design

a good chart answers a question. a bad chart shows data.

## start with the question

before picking a chart type, name the question the viewer should be able to answer at a glance:

- composition: what makes up the whole? (pie, stacked bar, treemap)
- comparison: which is bigger? (bar, column)
- trend: how is it changing over time? (line, area)
- distribution: how is it spread? (histogram, box plot, density)
- relationship: how do two variables move together? (scatter, bubble)
- ranking: in what order? (bar, ordered list)
- flow: what becomes what? (sankey, funnel)

if you can't name the question, you don't need a chart. you might need a single number.

## defaults that work

### bar charts

- horizontal bars when labels are long
- start the axis at zero unless there's a strong reason not to
- order by value, not alphabetically, unless category order has meaning
- one color for one series; add color only when comparing series

### line charts

- thin lines, single color when one series; differentiated when multiple
- highlight the latest value or the value being discussed
- show the trend, not the noise (consider smoothing for very dense data)

### tables

- numbers right-aligned, words left-aligned
- monospace numbers (tabular figures) so columns align
- color or icons for delta from previous period
- sortable, with a default sort that matches the question

## color use

- one accent color for the focused series, neutral grays for context
- diverging palettes (red-to-green or similar) only when zero is meaningful
- sequential palettes (light to dark) for ordinal data
- categorical palettes for unordered categories; cap at 5-7 colors
- always provide a non-color cue (label, icon) so colorblind users aren't excluded

## what to avoid

- 3d charts
- pie charts with more than 4-5 slices
- dual y-axes (they invent correlations)
- starting bar axes above zero to exaggerate differences
- chart junk: gridlines that don't help, borders, drop shadows
- legends placed far from the data they label

## annotations

a good chart often has one piece of text on it that names the insight:

> "users who completed onboarding had 3x higher 30-day retention"

the chart is the proof. the annotation is the point.

## dashboards

- one job per dashboard. monitoring is not the same as exploration.
- the most important number, biggest, top-left.
- support context: time range, segment, comparison period.
- empty states for every chart (no data, loading, error).
