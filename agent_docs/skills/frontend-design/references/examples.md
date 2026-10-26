# Frontend Design Examples

Use these examples to calibrate design direction, accessibility, and output notes.

## Example 1: Developer API Pricing Section

### Input

"Build a pricing section for a developer API product. Dark UI is fine. Make it feel sharp, not startup-generic."

### Direction

Industrial / utilitarian:

- tabular figures
- tight grid
- high-contrast borders
- restrained accent
- no soft purple glow

### Strong Output Characteristics

```tsx
<section aria-labelledby="pricing-heading" className="pricing">
  <header className="pricing-header">
    <h2 id="pricing-heading">Pricing</h2>
    <p>Predictable request-based plans. No seat math.</p>
  </header>

  <div className="pricing-grid">
    <article className="plan" aria-labelledby="plan-pro">
      <p className="eyebrow">Recommended</p>
      <h3 id="plan-pro">Pro</h3>
      <p className="price">
        <span className="amount">$49</span>
        <span className="period">/month</span>
      </p>
      <ul>
        <li>2M requests included</li>
        <li>7-day log retention</li>
      </ul>
      <a className="plan-cta" href="/signup?plan=pro">Start Pro</a>
    </article>
  </div>
</section>
```

### Strong Design Note

```text
Direction: industrial/utilitarian, using tabular pricing, hairline borders, and
muted contrast so the API product feels precise rather than generic SaaS.
A11y: semantic section/article structure, labelled heading, CTA as link, and
"Recommended" appears as text rather than color-only state.
States: the same card structure can show disabled/unavailable plans without
changing layout.
```

### Why This Is Strong

- The direction is specific.
- The markup is semantic.
- The recommended plan is not color-only.
- It avoids generic AI patterns.

## Example 2: Empty State for a Dashboard

### Input

"Add an empty state when there are no reports."

### Strong Output Characteristics

- Heading tells the user what is empty.
- Body explains how reports appear.
- Primary action is available when the user has permission.
- No action is shown to users without permission.
- Illustration is decorative or has meaningful alt text.

```tsx
<section aria-labelledby="empty-reports-title" className="empty-state">
  <h2 id="empty-reports-title">No reports yet</h2>
  <p>Create your first report to track weekly account activity.</p>
  <button type="button">Create report</button>
</section>
```

### Why This Is Strong

- Empty is treated as a real state.
- It gives a next action.
- It can respect permissions.

## Example 3: Avoiding Generic Defaults

### Weak Direction

```text
Modern clean SaaS with Inter, purple gradient, rounded cards, and 01/02/03 steps.
```

### Strong Alternative

```text
Editorial data-room: serif display headings, compact comparison tables, strong
black/cream contrast, and restrained blue only for active controls.
```

### Why This Is Strong

- It has a point of view.
- It gives concrete visual decisions.
- It can still be accessible and maintainable.
