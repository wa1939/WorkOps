# Publication checklist

WorkOps is prepared as a self-hosted application, not a promise of a hosted service or a zero-configuration database. Publish only what you have independently verified.

## Use a clean source export

Run `npm run export:public -- ../WorkOps-public` from the reviewed checkout. The destination must not already exist. The export contains the current product source, public guides, licenses, synthetic screenshots and an integrity manifest. It omits Git history, credentials, private operations runbooks, internal planning/evidence, retired production helpers and automatic scheduler workflows.

Do **not** change an existing private repository's visibility as a substitute for this export. Removing a tracked credential or private document does not remove it from old commits, branches, tags, releases, artifacts or forks. Review any historical credential with its issuer and invalidate it where needed; no rotation is implied by this preparation.

## Before creating a public release

- [ ] Review `LICENSE`, `THIRD_PARTY_NOTICES.md`, `BRAND.md`, and the included font license. Confirm you have rights to distribute every asset and adaptation.
- [ ] Scan the exported tree for secrets and personal/organizational data. Classify test-vector findings explicitly; do not suppress whole directories or claim a clean scan merely because matches are in tests.
- [ ] Select the actual public repository URL. Update the repository entry in `src/lib/brand.ts`, clone/deploy links, issue/support references, and remove draft visibility notes. Do not advertise a nonexistent repository, demo, security mailbox or release.
- [ ] Run a clean `npm ci`, the documented tests, `npm run lint`, `npm run build`, and `npm run docs:check` in the exported tree. Record the exact dependency audit; zero critical findings does not mean zero vulnerabilities.
- [ ] Rehearse migrations on an empty, isolated PostgreSQL database, bootstrap the first administrator and workspace, sign in, and create/read back a task. Demo data is opt-in, synthetic and local-only.
- [ ] Exercise the Docker runner and its separate tools service. A successful image build alone does not prove database initialization or login.
- [ ] For Vercel, verify an actual project before claiming cloud support is end-to-end tested. A local run of the same build entry is not proof of serverless cold starts, database networking or platform plan limits.
- [ ] Confirm the homepage is indexable, private/auth/API areas are not, preview deployments are not indexed, and production canonical URLs are configured correctly.
- [ ] Configure and restore-test database backups before storing real work. No automated backup or scheduler is enabled by default.

## What is intentionally not published

Private historical runbooks, production identifiers, credentials, incident notes, internal reports, generated QA evidence and proprietary example scorecards do not belong in a redistributable product. Keep the original private history private and start the public repository from the reviewed export only after these gates are satisfied.
