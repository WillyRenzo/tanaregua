# Conventional Commits Examples

Messages in the current format: English, ASCII only. Commits before 28/10/2026 are in
Portuguese and stay as they are.

## Feature With Body

```
feat(backend/packages): add service packages sold on the order

A package has sessions per service, a price and a validity in days. It is
sold as an order item (identified client) and each session pays for a
service in a later order of the same client, consumed only on close.

- balance enforced by the database: append-only movements applied by a
  trigger, CHECK from 0 to the amount bought, no UPDATE/DELETE for the app
- refund within the validity, up to the amount paid, with a reason, as a
  cash outflow (requires orders:void)
```

## Bug Fix With Body

```
fix(frontend/brand): apply the primary color to the menu background

The panel menu and the public page top bar stayed TaNaRegua brown even
with the barbershop colors set. The background now uses the primary
color, darkened only as much as needed for the light menu text at 70%
opacity to keep AA contrast.
```

## Quoting UI Text or a Business Rule

```
feat(frontend/painel): show the barbershop plan and the upgrade prompt

Settings show the current plan. FeatureGate shows the feature when the
plan includes it and "Disponivel no plano X" otherwise (business-rules
section 12). UX only: the API refuses with plan-upgrade-required.
```

## Short Titles

```
feat(backend/seed): add packages to the development demo
feat(frontend/public-booking): show package balances in my appointments
feat(frontend/agenda): add week and month views and a professional filter
docs: document the rules and guarantees of service packages
chore: add the tdd and commit skills
```

## Breaking Change

```
feat(backend/auth)!: require a barbershop scope in the refresh token

BREAKING CHANGE: tokens issued before this deploy can no longer be
refreshed; users must sign in again.
```

## Heredoc

```bash
git commit -F - <<'EOF'
fix(backend/orders): block closing an order with no items

An empty order created a R$ 0 cash entry and cluttered the report.
EOF
```
