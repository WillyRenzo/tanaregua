---
name: frontend-design
description: Guides UI implementation toward distinctive, intentional design rather than generic defaults — component structure, visual hierarchy, and consistency with this project's design conventions. Use when building new UI, a page, a component, or reshaping existing interface.
---

# Frontend Design

Approach this like the design lead at a small studio that gives every
client a visual identity nobody would mistake for a template. The goal is
a specific, intentional point of view — not the statistical average of
what AI tools produce by default.

## Process

1. Check the project's frontend stack, component library, design tokens, styling method, and existing UI patterns before designing.
2. Commit to a specific aesthetic direction before markup: editorial, industrial, luxury, playful, dense data-forward, organic, retro-futuristic, or another deliberate fit.
3. Make typography, spacing, shape, and color serve that direction while staying inside the project's available system.
4. Use current idioms for the actual framework and version in the repo.
5. Build WCAG 2.2 AA basics from the first pass: semantic HTML, keyboard access, visible focus, contrast, labels, and non-color-only state.
6. Handle real states: loading, empty, error, long content, missing media, zero/one/many counts, and narrow screens.
7. Verify at mobile and desktop sizes before considering the UI complete.
8. Extend existing components and tokens instead of creating parallel controls.

<HARD-GATE>
Do not write generic "modern SaaS" markup. Before building, state the aesthetic direction and the screen's primary job. If an existing design system governs the area, the direction must fit inside it rather than replacing it.
</HARD-GATE>

## Avoid the current AI-design defaults

Unless the brief specifically asks for one of these, avoid: Inter,
Roboto, or Arial as the primary typeface; a purple gradient on a white
background; numbered markers (01 / 02 / 03) used as decoration rather
than because the content is a genuine sequence; and a big-number-with-
small-label hero paired with a gradient accent, used reflexively rather
than because it's genuinely the best fit for this content. These are the
patterns models reach for by default — naming them explicitly is what
keeps output from converging on them.

## What NOT to do

- Don't default to the generic, templated layout when the request calls
  for something distinctive — a landing page, hero section, or dashboard
  deserves an actual point of view, not interchangeable boilerplate.
- Don't skip loading/error/empty states because the happy path was
  requested — production UI needs all of them.
- Don't introduce a new styling approach (a different CSS methodology, a
  new component pattern) when the project already has an established one.
- Don't sacrifice accessibility for visual polish — they're not in
  tension if handled from the start.
- Don't hedge the aesthetic choice into blandness to be safe — a bold,
  coherent direction executed well beats a timid, evenly-balanced one.

## Output format

The component/page code, plus a short note on the design decisions made:
the aesthetic direction chosen and why, if it wasn't explicitly specified
by the user.

## References

- Read `references/checklist.md` when building or reviewing UI for direction, states, responsiveness, and accessibility.
- Read `references/examples.md` when you need a concrete design-note and component pattern.
- Read `references/anti-patterns.md` before finalizing to avoid generic AI defaults and accessibility regressions.
