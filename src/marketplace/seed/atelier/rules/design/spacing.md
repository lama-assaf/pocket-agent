# spacing

## the grid

use an 8px grid as default. 4px as the half-step for fine adjustments.

values in use: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96.

avoid: 5, 6, 7, 9, 10, 11, 13, 14, 15 (unless there's a specific reason).

## scale principle

distinct values should be perceptibly different. 16 vs 20 reads as different; 14 vs 16 often doesn't.

aim for 6-8 distinct spacing values across the whole product. if you have 20, you have drift.

## semantic spacing

spacing tokens get semantic names when used:

- inline (between siblings on a line): inline-xs, inline-sm, inline-md
- stack (between siblings stacked): stack-xs, stack-sm, stack-md, stack-lg
- inset (padding inside a container): inset-xs through inset-lg
- layout (between major sections): layout-sm, layout-md, layout-lg

names matter more than the values. values can shift. names hold the design system together.

## rhythm

similar elements get similar spacing. if a card has 16px padding in one section, every card has 16px padding unless there's a reason.

vertical rhythm: the gap between text blocks should be a function of the line-height, not a fixed pixel value. aim for 1-1.5x line-height between adjacent paragraphs.
