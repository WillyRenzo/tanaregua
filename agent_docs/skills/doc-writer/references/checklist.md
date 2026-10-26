# Doc Writer Checklist

Use this checklist to write documentation that helps maintainers use code safely without repeating the code.

## Choose the Documentation Type

- [ ] Public function/class/module docs for exported contracts.
- [ ] README or setup docs for running and operating a project.
- [ ] Developer guide for workflow or architecture decisions.
- [ ] Inline comment for surprising local logic.
- [ ] Existing doc update instead of a new duplicate source.

## Read Before Writing

- [ ] Current implementation read.
- [ ] Relevant call sites read for actual usage.
- [ ] Tests read when they clarify edge cases.
- [ ] Existing docs checked for conflicts.
- [ ] Schema/OpenAPI/types checked if they are the source of truth.
- [ ] Behavior verified when docs and code appear to disagree.

## Docstring as Contract

- [ ] Purpose is stated in caller terms.
- [ ] Parameters include constraints not obvious from types.
- [ ] Return value explains null/empty/error differences.
- [ ] Side effects are named: DB writes, IO, cache, events, mutation.
- [ ] Exceptions or error codes are specific.
- [ ] Preconditions are stated when misuse is possible.
- [ ] Security or tenant assumptions are explicit when relevant.
- [ ] Implementation steps are omitted unless callers depend on them.

## README Essentials

- [ ] One short explanation of what the project/module does.
- [ ] Runtime/tool prerequisites.
- [ ] Install command.
- [ ] Configuration instructions without exposing secrets.
- [ ] Development run command.
- [ ] Build or production run command if applicable.
- [ ] Test command.
- [ ] Links to deeper docs instead of long duplicated sections.
- [ ] Troubleshooting only for common, real failures.

## Inline Comment Filter

Add a comment only when at least one is true:

- [ ] Code looks wrong but is deliberate.
- [ ] Domain rule is not obvious from names.
- [ ] Ordering matters and could be "simplified" incorrectly.
- [ ] Security/performance constraint is non-obvious.
- [ ] External system quirk forces an unusual choice.

Do not comment when:

- The next line already says the same thing.
- A better name would remove the need.
- The comment describes history rather than current reason.
- The comment is a TODO without owner/context.

## Language Conventions

- [ ] TypeScript/JavaScript: match project JSDoc style; rely on types for obvious shapes.
- [ ] Python: match PEP 257 and existing Google/NumPy/Sphinx style.
- [ ] Go: godoc starts with the symbol name.
- [ ] Java/C#: match existing XML or block doc style.
- [ ] Markdown docs match the project's heading and command style.

## Staleness Check

- [ ] Would an internal refactor force this doc to change? If yes, it may be too mechanical.
- [ ] Is a duplicated field list better replaced with a link to schema?
- [ ] Does every claimed error still exist?
- [ ] Does every setup command still work?
- [ ] Is this the single best place for the information?

## Final Output

Return the documentation in the target file/location. Include a short note only when useful:

- What was documented.
- Any behavior mismatch found.
- Any gap that needs user confirmation.
