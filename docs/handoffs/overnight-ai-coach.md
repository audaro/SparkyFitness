# Handoff — overnight AI-coach run (2026-08-21 → 2026-08-22)

Branch: `feat/ai-coach` (29 commits ahead of `main`, all pushed to origin/audaro).
Blueprint: `~/fitness/AI-COACH-BLUEPRINT.md`. Run log + full detail:
`~/fitness/OVERNIGHT-RUN.md` (outside the repo; the append-only Log section there is
the authoritative narrative, including every second-opinion review reconciliation).

## What shipped (by milestone)

- **M0–M4** (earlier in the run): workout-preset programming + interactive proposal
  card with accept/undo/edit, weekly workout planning, meal templates + weekly meal
  plans, goal presets/plans, medications + dosing schedules, symptoms, check-in
  corrections — each as a chat tool action set with golden tests.
- **M5** — `coach_profiles` table (`1c7e1885`) + `sparky_manage_coach_profile` intake
  interview, coaching prompt fragments, progression rules, context cache with
  invalidation, prompt-injection hardening (`bca39b7a`).
- **M7.5** — MCP parity golden for the coach profile + MCP docs section + README
  client-setup section (`0118541a`).
- **M7.1** — `get_frequent_sets` usual-routine mining (`ca629e36`, hardened in
  `763ffae5` and `7bf33fcc`).
- **M7.4** — `get_grocery_list` weekly shopping list from active meal plans
  (`826e0307`, hardened in `7bf33fcc`: per-date plan bounds + diary-generation
  ingredient scaling).
- **M7.3** — weekly report `## Training` section: per-day volume, PRs, plan adherence
  (`ea77d830`).
- **M6.1 (server half)** — `POST /api/chat/quick-log`: one-shot logging through the
  core tool profile, Zod body, `{text, actions:[{toolName, summary}]}` response,
  honest-failure guard, supertest coverage (`abbd377d`, `987a8894`).

## Gate status

Server gate (`pnpm run validate && pnpm test`) green at every commit — final run
3646 passed / 2 skipped. Docs build green where docs content changed. Frontend/mobile
untouched tonight except earlier-run commits, gated then. Known pre-existing local
failure: mobile healthconnect `dataTransformation` sleep test is TZ-dependent
(passes under `TZ=UTC` as in CI, fails in local PT) — not from this branch.

## Exact next steps

1. **Quick-log frontend** (M6.1 UI + M6.2 voice): build the Diary quick-log bar
   against `POST /api/chat/quick-log`. Success signal per action is the summary's
   `✅ ` prefix; render undo where a tool summary carries an id. Promote
   `SparkyFitnessServer/schemas/chatSchemas.ts:quickLogRequestSchema` into
   `shared/src/schemas/api/` when the frontend consumes it.
2. **Live E2E**: add an AI provider key, sign up via UI, exercise the new tools in
   real chat (everything so far is mock/golden + live-DB-smoke verified, not
   live-LLM verified).
3. **Product decisions** before wiring crons: M7.2 plateau watchdog, M6.3 morning
   brief, cron-delivered weekly report — all message users unprompted; opt-in UX
   first. Also the delegated-identity scoping question (see risks).

## Open risks / decisions (full list in OVERNIGHT-RUN.md "Deferred for morning")

- **Delegated-identity scoping** (review round 20): chat and quick-log resolve the AI
  service by the *active* user but run tools as the *authenticated* actor — in
  switched-user mode a parent logs to their own diary. Pre-existing chat-wide
  convention; decide once whether that is the intended delegation semantics.
- Coach-profile prompt scope is coaching-category-only (reviewer wanted universal);
  alias targets are not verified up front; goal-name uniqueness has no DB index —
  all deliberate calls documented with rationale in the run log.
- `docs/handoffs/` is outside `docs/content/` and does not ship on the docs site.
