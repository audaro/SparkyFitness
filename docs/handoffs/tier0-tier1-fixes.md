# Handoff — Tier 0 and Tier 1 audit fixes

*Written 2026-08-31. Source: six-agent audit at HEAD `60129351a`, main clean and green.*

Fix the eight items below. Everything here was verified against source or a live
command during the audit; nothing is a lead to re-investigate.

## Gate

Per-package `pnpm run validate` + the package test script for every package you
touch, green before each commit. One commit per numbered item. No AI attribution
in any commit message (root `AGENTS.md`). This fork never PRs to upstream.

---

## Tier 0 — live blast radius

### 1. Withings OAuth callback is unauthenticated and trusts `state` as the user id

`SparkyFitnessServer/routes/withingsRoutes.ts:67` — the only route in the file
with no `authMiddleware.authenticate`. At ~line 86 it does `const userId = state`
straight from the request body, then calls
`withingsService.exchangeCodeForTokens(userId, code, …)`. The comment above it
concedes the state parameter is never validated.

Anyone holding a Withings authorization code can bind that provider account to
an arbitrary user UUID.

Fix: add `authMiddleware.authenticate` (the browser is signed in when the
frontend posts the callback), take the user id from the authenticated request
rather than the body, and validate `state` against a value stored when
`/authorize` issued it. Do **not** just delete the `state` read — it is the only
CSRF binding the flow has, so replace it, don't drop it. Check `/authorize`
(same file, line 26) for where to persist the nonce.

Verify: an unauthenticated POST to `/api/withings/callback` returns 401, and a
signed-in callback with a mismatched `state` is rejected.

### 2. Four upstream security commits are unmerged

Cherry-pick rather than merging the 179-commit backlog:

- `a501b8f47` keep Withings token payloads out of logs — highest value
- `e27cc9d64` reject unsuccessful token responses before persisting
- `b243da939` discard Postgres clients after rollback failures (pool poisoning)
- `7a2703653` drop persisted checkout credentials in draft-release

Note `a501b8f47`/`e27cc9d64` touch the same Withings files as item 1 — do item 1
after these land, or resolve the overlap deliberately.

### 3. `GymProfilesScreen` has no `beforeRemove` guard

`SparkyFitnessMobile/src/screens/GymProfilesScreen.tsx` — Android hardware back
pops the screen out from under an in-progress edit. Zero `beforeRemove`
listeners in the file. The fix pattern already exists in `PickMusclesScreen`;
copy it. Carried unchanged through four consecutive handoffs.

---

## Tier 1 — CI blind spots, where silence reads as success

### 4. Root workspace config is in no path filter

`.github/workflows/ci-tests.yml` — add `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
`package.json` and `patches/**` to **both** `on:` `paths:` blocks and to the
`frontend`, `mobile` and `server` filters. Garmin is standalone Python outside
the workspace — leave its filter alone. Apply the same additions to
`schema-backup.yml` and `docs-test.yml`.

This is the exact twin of the `shared/**` hole closed by `60129351a`. It has
already fired: `23f36e6b9` touched only root `package.json` and `scripts/` and
produced zero workflow runs — `gh run list --commit 23f36e6b9` is empty.

### 5. Repo setting blocks Actions from opening PRs — **ask before doing this**

`gh api repos/audaro/SparkyFitness/actions/permissions/workflow` reports
`can_approve_pull_request_reviews: false`. Schema Backup pushes its branch and
then dies on *"GitHub Actions is not permitted to create or approve pull
requests"* (run `33336104513`). Same setting silently blocks
`nix-update-hashes.yml` and `sync-translations.yml`.

This changes repository permissions, so **get explicit approval before flipping
it**. Then: Settings → Actions → General → Workflow permissions → *Allow GitHub
Actions to create and approve pull requests*.

### 6. Garmin tests cannot fail CI

`.github/workflows/ci-tests.yml:393` — the pytest step has
`continue-on-error: true` and an `if [ -d tests ]` guard. `SparkyFitnessGarmin/tests`
exists and pytest runs; its result is discarded. Run the suite locally first,
then remove `continue-on-error`. Keep the directory guard.

### 7. `server-tests` has no `if:`, and editing the workflow can't smoke-test itself

Same file. `server-tests` (~line 157) declares `needs: changes` but no `if:`, so
`needs.changes.outputs.server` is a dead output — leftover from `f95e4ec16`
setting `if: false` and `758a6edf9` re-enabling by deleting the line instead of
restoring the condition. Either restore
`if: needs.changes.outputs.server == 'true'` or delete the dead `server` filter
and comment that the gate is intentionally unconditional. Pick one; the current
state is neither.

While in the file, add `.github/workflows/ci-tests.yml` to the `frontend`,
`mobile` and `garmin` filters — it is currently only in `migrations`, so a change
breaking those jobs' own config merges green.

Also fix `.github/workflows/README.md:20,25`, which still claims backend tests
are disabled with `if: false`.

### 8. Mobile test files are never type-checked

`SparkyFitnessMobile/tsconfig.json:20-28` excludes `__tests__`. Remove that entry
and fix the fallout. **Scope risk:** this may surface a large number of errors —
if it does, land items 1–7 first and report the count before starting, rather
than sinking the whole session into it.

---

## Open risks

- Items 1 and 2 overlap in the same Withings files; sequence them.
- Item 8 is the only one with unknown size. Everything else is bounded.
- Item 5 needs a human decision, not a code change.
- No independent second-opinion review is available (reviewer is on a free plan,
  down since 2026-08-24), so the self-review before each commit is the only
  check — be deliberate about it.
- Full ranked audit, including the ~32 items *below* this tier, is at
  `sparkyfitness-audit-2026-08-31.html` in the parent directory.
