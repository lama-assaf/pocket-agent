# accessibility

target WCAG 2.2 AA. AAA when the product context demands it (healthcare, government, education).

## perceivable

- text contrast: 4.5:1 body, 3:1 large text and ui components
- non-text alternatives (alt text, aria-label) for meaningful images
- info not conveyed by color alone
- layout holds at 200% zoom
- captions or transcripts for video and audio

## operable

- keyboard reachability for every interactive element
- visible focus rings with 3:1 contrast against adjacent background
- focus order matches visual order
- no keyboard traps
- target size 24x24px AA, 44x44px AAA
- animations respect prefers-reduced-motion

## understandable

- heading hierarchy is correct (one h1, no skipped levels)
- form fields have visible labels (placeholder is not a label)
- error messages identify the field and the fix
- lang attribute set on html

## robust

- semantic html: button for buttons, a for links, ul for lists
- aria where html semantics fall short, not as a replacement
- aria attributes valid for their role

## what to avoid

- placeholder text used as the only label
- focus rings disabled because they don't fit the aesthetic
- modals that don't trap focus while open
- toast notifications that vanish before slow readers can finish them
- icons-only buttons without aria-label
- form errors that appear visually but aren't programmatically associated with their fields
