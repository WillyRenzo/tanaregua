# Frontend Design Anti-Patterns

Read this before finalizing UI work.

## 1. Generic AI Landing Page

Bad signs:

- Inter or Roboto by reflex.
- Purple/blue gradient wash.
- Rounded cards with no hierarchy.
- Decorative `01 / 02 / 03` labels that are not a real sequence.
- Big number plus small label hero without content reason.

Why it hurts:

- The UI looks interchangeable and unowned.

Do instead:

- Name a direction tied to audience and task.
- Make type, spacing, color, and shape support that direction.

## 2. Replacing the Design System

Bad signs:

- New buttons in a codebase with shared buttons.
- New spacing scale or palette.
- One-off form controls.

Why it hurts:

- The app becomes inconsistent and harder to maintain.

Do instead:

- Extend existing components and tokens.
- Customize layout and composition where appropriate, not core controls.

## 3. Div Soup

Bad signs:

- Clickable `div`s.
- Missing labels.
- Heading levels chosen only for size.
- Links implemented as buttons or buttons as links.

Why it hurts:

- Keyboard and assistive tech behavior breaks.

Do instead:

- Use semantic elements first.
- Style real controls instead of recreating them.

## 4. Happy-Path Only UI

Bad signs:

- No loading state.
- Empty list renders a blank area.
- Errors only show a red border.
- Long names overflow cards.

Why it hurts:

- Production data makes the UI feel broken.

Do instead:

- Design loading, empty, error, long content, and permission states with the first pass.

## 5. Color-Only Meaning

Bad signs:

- Status is only green/red.
- Recommended plan is only a colored border.
- Error depends only on red text.

Why it hurts:

- Users with color vision differences or low contrast settings lose meaning.

Do instead:

- Pair color with text, icon, shape, or label.

## 6. Desktop-First Squeeze

Bad signs:

- Layout is only checked at desktop width.
- Tables overflow mobile without plan.
- Primary action moves below unrelated content on small screens.

Why it hurts:

- The UI fails on common devices.

Do instead:

- Check narrow width while building.
- Decide stacking, truncation, and overflow behavior deliberately.

## 7. Invisible Focus

Bad signs:

- `outline: none` with no replacement.
- Focus blends into background.
- Custom controls cannot be reached by Tab.

Why it hurts:

- Keyboard users cannot operate the UI.

Do instead:

- Keep visible focus.
- Match existing project focus styles.

## 8. Decorative Motion as State

Bad signs:

- Animation is required to understand what happened.
- Motion ignores reduced-motion patterns.
- Loading spinner has no accessible status when needed.

Why it hurts:

- Some users miss or cannot tolerate the state change.

Do instead:

- Make state visible without motion.
- Respect reduced motion when the project does.
