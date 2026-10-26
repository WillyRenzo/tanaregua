# PR Writer Checklist

Use this before drafting a pull request title or description.

## Inputs

- [ ] Actual diff read from the correct base branch.
- [ ] Branch commits scanned.
- [ ] WIP/fixup/noisy commits identified.
- [ ] Pull request template checked.
- [ ] CONTRIBUTING or project workflow docs checked when present.
- [ ] Linked ticket or issue convention checked.
- [ ] Business/security docs checked when touched areas are sensitive.

## Title

- [ ] Describes the net change, not the branch name.
- [ ] Follows project convention if one exists.
- [ ] Uses Conventional Commit style when the project uses it.
- [ ] Scope is clear when helpful.
- [ ] Stays reasonably short for PR lists.
- [ ] Does not combine unrelated types unless the PR truly does.

Useful title patterns:

- `feat(checkout): support gift-card partial redemption`
- `fix(auth): reject expired refresh tokens consistently`
- `refactor(orders): extract pricing calculator`
- `docs(api): document webhook retry semantics`
- `test(billing): cover prorated downgrade refunds`

## Body: What and Why

- [ ] Leads with the problem or goal.
- [ ] Summarizes the net behavior/system change.
- [ ] Avoids a file-by-file list.
- [ ] Calls out intentional non-goals when the diff could look incomplete.
- [ ] Mentions business-rule impact when relevant.

## Body: How to Test

- [ ] Concrete commands are listed.
- [ ] Manual checks include expected outcomes.
- [ ] Test data, flags, or fixtures are named when needed.
- [ ] Unrun tests are explicitly called out.
- [ ] No test claim is invented.

## Body: Notes for Reviewers

Include only when useful:

- [ ] Risky area.
- [ ] Migration or rollout order.
- [ ] Feature flag behavior.
- [ ] Security or permission-sensitive path.
- [ ] Deliberate trade-off.
- [ ] Known out-of-scope follow-up.

Omit the section entirely when empty.

## Size and Clarity

- [ ] Body is roughly 200-400 words unless the template demands otherwise.
- [ ] Long details link to docs instead of bloating the PR.
- [ ] The reviewer can understand why this exists without reading the chat.
- [ ] The reviewer can verify without asking for commands.

## Final Check

- [ ] Title still matches the final diff.
- [ ] Body does not narrate commit-by-commit history.
- [ ] No first-person diary language.
- [ ] No "tested locally" without details.
- [ ] Template sections are preserved if present.
