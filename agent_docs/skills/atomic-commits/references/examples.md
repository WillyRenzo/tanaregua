# Atomic Commits Examples

## Example 1: A Feature Split in Dependency Order (Service Packages)

```
feat(backend/packages): add service packages sold on the order
    schema.prisma, migration, packages module, orders/finance/public-booking integration,
    e2e tests, contracts/openapi.json + frontend/src/lib/api/schema.d.ts
feat(backend/seed): add packages to the development demo
    demo-seed.ts + demo-seed.e2e-spec.ts
feat(frontend/packages): add the packages page and their use on the order
    queries, page, order detail, cash view, shared component, Playwright spec
feat(frontend/public-booking): show package balances in my appointments
    public queries + my-appointments
docs: document the rules and guarantees of service packages
    business-rules §6, architecture, README, roadmap
```

Why this split:

- The generated client (`schema.d.ts`) goes with the backend commit because the contract changed there.
- The panel commit compiles without the public page; the public page reuses the panel's shared component.
- Docs that explain the whole feature go last; a rule change caused by a fix would go with the fix instead.

## Example 2: Bug Fix With Its Rule

```
fix(frontend/brand): apply the primary color to the menu background
    brand.ts, brand.test.ts, brand.spec.ts, brand-settings hint,
    business-rules.md §10 (the rule changed because of this fix)
```

## Example 3: Partial File Across Two Commits

`queries.ts` has a hook for the panel commit and another for the public commit:

```bash
cp frontend/src/lib/queries.ts /tmp/queries.full.ts
# edit a copy to keep only the panel hook, then:
hash=$(git hash-object -w /tmp/queries.panel-only.ts)
git update-index --cacheinfo 100644,"$hash",frontend/src/lib/queries.ts
bash agent_docs/skills/atomic-commits/scripts/check-staged.sh frontend
```

The working tree still has the full file for the next commit.

## Example 4: Checking Merge Order Between Branches

```bash
git merge-tree --write-tree main feat/pacotes >/dev/null && echo ok
git merge-tree --write-tree feat/agenda-semana-mes feat/pacotes >/dev/null && echo ok
```

No conflicts in any order → merge the smallest first and the one with a migration last.
