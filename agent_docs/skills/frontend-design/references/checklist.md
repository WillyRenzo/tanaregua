# Frontend Design Checklist

Use this checklist when building or reviewing UI.

## Project Fit

- [ ] Framework and version identified.
- [ ] Existing component library checked.
- [ ] Styling approach identified: Tailwind, CSS modules, CSS-in-JS, plain CSS, design system.
- [ ] Tokens for color, spacing, radius, shadow, and typography checked.
- [ ] Existing layout primitives reused where appropriate.
- [ ] New component does not create a parallel button/input/card system.

## Direction

- [ ] Aesthetic direction named before markup.
- [ ] Direction fits the audience and screen's primary job.
- [ ] Typography choices support the direction.
- [ ] Palette and shape language are deliberate.
- [ ] Generic defaults are avoided unless the brief or design system requires them.
- [ ] The design note can explain why the direction fits.

## Hierarchy and Layout

- [ ] One clear primary action when the screen has a task.
- [ ] Hierarchy comes from typography, spacing, grouping, and affordances.
- [ ] Layout works at narrow mobile width.
- [ ] Layout works at desktop width.
- [ ] Long text wraps without breaking the layout.
- [ ] Lists handle zero, one, and many items.
- [ ] Missing images or avatars have a planned fallback.

## States

- [ ] Loading state prevents layout collapse.
- [ ] Empty state explains what happened and gives a useful next action.
- [ ] Error state includes recovery path.
- [ ] Disabled state communicates why when needed.
- [ ] Active/selected/current state is not color-only.
- [ ] Form validation errors are tied to fields.

## Accessibility Baseline

- [ ] Uses semantic HTML: `button`, `a`, `nav`, `main`, headings, labels.
- [ ] Keyboard order is logical.
- [ ] Focus is visible.
- [ ] Dialogs/menus have expected Escape/Enter behavior when relevant.
- [ ] Normal text contrast is at least 4.5:1.
- [ ] Large text and meaningful UI chrome contrast is at least 3:1.
- [ ] Touch targets meet at least 24x24px; primary/frequent controls prefer about 44x44px.
- [ ] Images have alt text or empty alt when decorative.
- [ ] Motion respects existing reduced-motion patterns.

## Stack Notes

React / Next.js:

- [ ] Server/client component boundary is respected.
- [ ] Shared components are composed instead of reimplemented.
- [ ] Forms connect labels, help text, and errors with accessible relationships.

Vue / Svelte:

- [ ] Existing SFC and scoped/global style conventions are followed.
- [ ] Transitions match project patterns.

Tailwind:

- [ ] Project tokens and spacing scale are used.
- [ ] Arbitrary values are rare and intentional.

CSS modules/plain CSS:

- [ ] Existing variables are reused.
- [ ] New class names match local naming style.

## Delivery Note

When useful, include:

- Direction chosen and why.
- Accessibility/state checks handled.
- Any intentional deviation from existing patterns.
