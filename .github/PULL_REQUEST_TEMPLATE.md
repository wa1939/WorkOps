## Summary

<!-- One or two sentences: what does this PR do? -->

## Motivation

<!-- Link the issue ("Fixes #123") or describe the workflow/problem behind the change. -->

## Changes

<!-- Bulleted list of the meaningful changes. Note anything intentional-but-surprising. -->

## How was this tested?

- [ ] `npm run lint`
- [ ] `npm run test:unit`
- [ ] `npm run test:e2e` (relevant specs)
- [ ] Manual testing — describe below

<!-- Manual test steps, environments, and accounts/roles exercised. -->

## Database migration included?

<!-- If yes: the migration was generated with `npm run db:migrate:dev`, the generated SQL has been reviewed, and it was applied to a local database only. Never db push / reset / --force. -->

- [ ] No migration
- [ ] Migration included and SQL reviewed

## UI change?

<!-- Include before/after screenshots for visible changes. -->

- [ ] No UI change
- [ ] Screenshots attached

## Checklist

- [ ] Docs updated where behavior or configuration changed (`docs/`)
- [ ] No secrets, credentials, or real user data committed
- [ ] Authorization enforced server-side (new/changed API routes check role and workspace permissions)
- [ ] Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, …)
