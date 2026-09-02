# Chat-reply accessibility check and QA baseline — 2026-09-02

Follow-on to `exercise-function-overhaul.md`. This session closed the last
open question from that work (whether VoiceOver reads Sparky's replies),
cleaned up the tooling the investigation left behind, reran every Maestro
scenario on the cleaned simulator, and fixed the DevVault sync that turned
out never to have run.

## What shipped

| Commit | Area | Change |
| --- | --- | --- |
| `d929f334f` | mobile, qa | Chat proposal card driven on device (`workout-proposal` scenario); three defects it found fixed; sub-minute duration floor. |
| `c6fa95735` | docs | Exercise-function handoff closed out. |
| `e553a60b4` | docs | Why XCUITest misses wrapped chat replies, in `qa/README.md`, the mobile guide and the handoff; VoiceOver risk struck. |
| `4713244b5` | qa | Flow and oracle comments say precisely why the reply is unseen. |
| `87ba06325` | docs | Exercise handoff gate table: all four Maestro scenarios green. |

All pushed to the fork's `main`. CI Tests ran green on `e553a60b4`; the
later commits touch only `docs/` and `qa/`, which the workflow's path
filter skips by design.

## The VoiceOver finding

The simulator cannot run VoiceOver, and every external accessibility client
tried on iOS 26.5 (the macOS AX bridge, idb, Accessibility Inspector) fails
even against SpringBoard. The finding rests on the library's code plus one
experiment:

- `react-native-enriched-markdown` is a UIAccessibility container that
  builds one labelled element per paragraph, with heading/link/image traits.
- A paragraph that wraps is given an `accessibilityPath` (a rect per line)
  and **no** `accessibilityFrame`. XCUITest's snapshot drops zero-frame
  elements; VoiceOver navigates the element list and outlines by path.
- Proof: with the stub's acknowledgement shortened to the one-line
  "Saved it.", that text appeared in `maestro hierarchy`; the two-line
  replies on the same screen did not.

Conclusion: VoiceOver reads the replies; the gap is the UI-test driver's.
No app change is needed. The flow rule stands: never assert reply text in
Maestro; wait on the user bubble and `id: chat-send`, and let the oracle
read the reply from `sparky_chat_history`.

## Gate status

| Gate | Result |
| --- | --- |
| Mobile `pnpm run validate` | green at `d929f334f` (unchanged since) |
| Mobile jest `--runInBand` | 389 suites, 6335 tests, all passing at `d929f334f` |
| Maestro `workout-proposal` | PASS (1m 57s), 19/19 oracle checks, at `4713244b5` |
| Maestro `ux-walk` | PASS (4m 2s), at `4713244b5` |
| Maestro `ux-walk-2` | PASS (4m 40s), at `4713244b5` |
| Maestro `food-photo` | PASS (2m 35s), 18/18 oracle checks, at `4713244b5` |
| Second-opinion review | not run: codex reviewer is down (see `~/.claude/CLAUDE.md`) |

Every Maestro run notes the same two WARNING log entries (timezone bootstrap
before onboarding has saved a server). They are logged on every reset run
and are expected.

## Environment: what was changed and what was reverted

The investigation touched the machine outside the repo. All of it is undone:

- Simulator `com.apple.Accessibility` defaults (`AccessibilityEnabled`,
  `ApplicationAccessibilityEnabled`, `AutomationEnabled`, and the
  `AuditInspectionModeEnabled` key Accessibility Inspector wrote) were
  deleted and the simulator rebooted; the domain is back to stock, and all
  four scenarios were rerun green on it.
- `idb-companion` (Homebrew) and the `facebook/fb` tap were removed, the
  scratch `fb-idb` virtualenv deleted, Accessibility Inspector quit.

Outside the repo, two things were changed on purpose and are NOT to be
reverted:

- `~/DevVault` had 46 unpushed commits: Obsidian Git had every interval at 0
  and had never committed or pushed anything. Its auto commit-and-sync
  interval is now 10 minutes (only effective while Obsidian is open), the
  backlog is pushed, and both `~/.claude/CLAUDE.md` and
  `~/DevVault/AGENTS.md` now say sessions must `git push` after committing
  to the vault.
- Memory (`exercise-function-overhaul-shipped.md`) and the DevVault gotcha
  `maestro-cannot-see-native-markdown-text` record the VoiceOver mechanism
  and the green baseline.

## Open risks

- **No independent review** ran on the ~2k-line mobile diff from the
  overhaul (`d929f334f` and earlier); the codex reviewer is down. When it is
  back, point it at `0adf526c6..d929f334f`.
- **VoiceOver was not exercised on a physical device.** The evidence is the
  library's accessibility code plus the one-line-reply experiment, which is
  strong but indirect. A five-minute check on an iPhone with VoiceOver on
  would make it direct.

## Exact next step

Nothing is blocked. Before changing the exercise or chat flows, run
`bash qa/bin/qa-run.sh <name>` for `ux-walk`, `ux-walk-2`,
`workout-proposal` and `food-photo`; all four pass at `4713244b5` on a
simulator with stock accessibility defaults.
