# Mobile QA harness

An autonomous UI check for `SparkyFitnessMobile`: it drives the real app in the
iOS Simulator, then decides whether the feature worked by reading the database
and the app's own log — never by reading the screen.

That split is the whole design. A UI test that asserts on screen text passes
whenever the app *renders* something plausible, which is exactly what a
mis-typed serving size or a timezone-shifted diary day does. So flows here are
deliberately dumb — they tap and type — and every verdict comes from an
**oracle**: a small Node script that queries the rows the flow should have
written.

## Safety

An autonomous agent tapping around this app will eventually press Delete,
"Remove SparkyFitness data from Apple Health", or Clear All History. Nothing
here may reach the developer's own stack, so the harness gets:

- its own Postgres container on **:55433** (`sparkyfitness-qa-db`),
- its own database (`sparkyfitness_qa`), dropped and recreated between runs,
- its own server process on **:3011**,
- a throwaway account, `qa-agent@sparky.invalid` (`.invalid` can never resolve,
  so a stray outbound email fails loudly instead of reaching a person),
- a fresh install of the app on every run, because `simctl install` over an
  existing install keeps the app's data — including a server URL that might
  point at production.

There is deliberately no code path from this harness to the real database. The
redirection works because `index.ts` calls `dotenv.config()`, and dotenv does
**not** overwrite variables already set in the environment: `qa-env.sh` exports
every key the developer's `.env` also defines, so the QA server cannot inherit
one by omission. Adding a new secret to `.env` means adding it there too.

## Prerequisites

- Docker running, with `postgres:18.3-alpine` already pulled. The harness never
  pulls (this machine's `credsStore: desktop` breaks image pulls entirely), so
  it pins the image the developer's own stack already runs.
- JDK 17+ for Maestro; `qa-env.sh` pins `/opt/homebrew/opt/openjdk@21`.
- Maestro at `~/.maestro/bin/maestro` (override with `MAESTRO_BIN`).
- A **Debug** simulator build of the app. Release is rejected up front: it has
  `__DEV__` false, which both disables the dev-only invariant throws and makes
  `serverUrl.ts` refuse the plain-HTTP localhost the QA server listens on.

  ```bash
  cd SparkyFitnessMobile
  xcodebuild -workspace ios/SparkyFitness.xcworkspace -scheme SparkyFitness \
    -configuration Debug -destination 'generic/platform=iOS Simulator' build
  ```

A Debug build loads its JS over the network, so a Metro dev server is required
too — `qa-up.sh` starts one on **:8082** and reuses a healthy one rather than
restarting it, since Metro's transform cache is worth more than the whole rest
of a run. Known rough edge: the dev client *discovers* a local dev server rather
than being told one, so if the developer's own Metro is also up on 8081 it is
not pinned which of the two serves a given run. Both serve the same working
tree, so the practical effect is limited to *when* the bundle was built — but a
run that behaves strangely right after an edit is worth checking here first.

## Running

```bash
bash qa/bin/qa-up.sh                     # bring up the QA Postgres + server
bash qa/bin/qa-run.sh custom-food-log    # reset, drive, assert
```

`qa-run.sh` is the whole loop, in this order for a reason: state is reset first
so a run cannot pass on the previous run's residue; the flow drives the app; the
oracles then decide. Oracles run **even when the flow failed** — "the tap never
landed" and "the tap landed and wrote the wrong row" are different bugs and must
not be collapsed into one red line.

Output lands in `qa/run/` (gitignored): `findings/*.json` for the machine-
readable verdict, `artifacts/` for the JUnit XML and the flow log, `server.log`
for the QA server.

The reset is the **whole database**, not the QA account. Deleting the account
leaves behind every row whose foreign key to `user` does not cascade — `foods`
among them — so a scenario that searches for a food by name would find the
previous run's copy and pass. The server rebuilds its schema at boot, so an
empty database is a valid start state; the cost is one server restart per run
(a full run is about 2m10s).

## Anatomy of a scenario

A scenario named `X` is up to three files:

| file | job |
| --- | --- |
| `flows/X.yaml` | Maestro flow. Taps and types. Asserts as little as possible. |
| `oracles/X.mjs` | The verdict. Queries the database for what should have been written. |
| `oracles/app-logs.mjs` | Runs for **every** scenario; fails on anything the app logged as ERROR. |

`flows/crawl.yaml` is the exception that proves the shape: it has no oracle of
its own because it has nothing to assert. It walks every screen a signed-in
account can reach from an empty database — 45 of them — and lets
`app-logs.mjs` alone decide, which buys crash coverage over the whole app for
the price of a flow. Its header lists the screens it cannot reach and what each
is waiting for; all of them need content created first, which is what the next
scenario is for.

`app-logs.mjs` is the cheapest broad coverage in the harness: `LogService.ts`
already writes structured entries into AsyncStorage and most screens are wrapped
in error boundaries that log on the way down, so every scenario gets
crash-and-exception coverage across features it never even visited.

Findings come in two grades, enforced by `oracles/lib/report.mjs`. `check()` is
a hard, evidence-backed assertion and fails the run; `observe()` is a soft
signal that is recorded and never gates. Without that split the report is 90%
noise by week two and stops being read.

## Traps, and why the code looks the way it does

Everything below cost real time to find, and each one produced a **green** run
while the app was doing something else entirely.

**`TEST_RUNNER_snapshotKeyHonorModalViews=false`** (`qa-env.sh`) is the single
least obvious line here. Without it Maestro sees a SparkyFitness screen as six
nodes — app icon, status bar, nothing else — and every selector fails as "not
visible" against a screen that is plainly showing the element. A full-screen
view in the app's window stack is marked `accessibilityViewIsModal`, which makes
UIKit hide every sibling from the accessibility snapshot, and XCUITest honours
that by default. `xcodebuild` forwards any `TEST_RUNNER_`-prefixed variable to
the XCTest runner with the prefix stripped, which is how it reaches the driver.

Its consequence shapes every flow: with modal honouring off, a sheet no longer
hides the screen behind it, so **selectors must be unambiguous against the whole
tree**. The two "Add Food" buttons in `custom-food-log.yaml` are told apart by an
anchor for this reason.

**expo-dev-menu** opens itself over the app on every launch
(`EXDevMenuShowsAtLaunch` defaults true), parks a floating button in its own
window, and offers a shake, a three-finger press and a ⌘-key as further ways in.
Combined with the flag above, the app's controls stay "visible" to a selector
while every tap lands on the menu in front of them — which is how a run ended up
back at the launcher having pressed "Go home". It is all preferences, so
`qa-run.sh` writes six of them with `simctl spawn defaults write` rather than
tapping anything. They must survive the first launch, which is why the install
is uninstall-then-install and flows must never use Maestro's `clearState`.

**The driver has no notion of the keyboard.** A field underneath it still reads
as on-screen and 100% visible, so a tap goes to whatever key occupies those
coordinates. Untreated, tapping Calories pressed the keypad's "5" and the value
went into the serving size, which saved as `505212` with the flow green the
whole way. Every field is therefore centred with `scrollUntilVisible` +
`centerElement: true` before it is tapped.

**Text selectors cannot address a form field.** An empty input exposes only its
placeholder, every numeric field placeholders `0`, and iOS keeps reporting that
placeholder in `hintText` after the field is filled — so one text selector
silently types every value into whichever field comes first. `below:` is no
better: it matches the next label, not the field under it. Hence the
`food-form-*` testIDs on `FoodForm` — the only pure test hook the harness has
added to app source. Everything else it has changed there was a real defect it
found on the way (see the bottom-sheet trap below).

**The first keystroke after a tap lands in the previously focused field**, so
each field tap is followed by `waitForAnimationToEnd`.

**The driver has no notion of the fold either.** The keyboard is only the most
obvious thing that covers a control. An element below the fold, behind the tab
bar, or under the floating "Talk to Sparky" button reads as on-screen and 100%
visible just the same, and the tap goes to whatever occupies its coordinates:
tapping the Exercise tab's "Create Exercise" tile from the top of that screen
silently pressed the tab bar, and the Settings row "Workout" opened the Add
sheet. `scrollUntilVisible` + `centerElement: true` is therefore the rule for
**every** off-screen target, not just form fields — and because it only scrolls
the way it is told, a screen is walked top to bottom.

**A bottom sheet used to be one opaque node.** `@gorhom/bottom-sheet` marks its
content container as a single accessibility element (`accessible`, labelled
"Bottom Sheet", role `adjustable`) by default, which collapses its whole
subtree: the Add sheet was plainly showing six buttons while the snapshot
offered one nameless node, and no selector could reach Measurements, Scan Food,
Workout, Activity or Log Workout. `accessible={false}` on `AddSheet` and
`ActionSheet` opts out and exposes the rows — which is what VoiceOver should
have been announcing all along, so this is a fix rather than a test hook. The
other ~18 sheets in `src/components` still have it; expect the same symptom the
first time a scenario needs one, and prefer the same one-line fix over pinning
coordinates (the reason the onboarding fields use relative selectors, above).

**`back` is not the pop gesture.** Maestro's iOS `back` swipes too briefly to
engage a native stack's interactive pop, and simply does nothing on a screen
with no back button to fall back on. An explicit
`swipe: {start: "2%, 50%", end: "95%, 50%", duration: 800}` is what a thumb
does, and it works. `crawl.yaml` needs it in exactly one place, for a screen
that has no way out at all — see below.

## Adding a scenario

1. Write `flows/X.yaml`, starting with `- runFlow: lib/boot.yaml` (fresh install
   → onboarding → connected to the QA server → Home).
2. Run it and watch: `bash qa/bin/qa-run.sh X`. Use
   `maestro studio` or `maestro hierarchy` when a selector will not match — the
   answer is usually that the element is behind the keyboard, or that the
   selector matches something on the screen *behind* the sheet.
3. Write `oracles/X.mjs` against `lib/db.mjs` (`query`, `qaAccount`, `lit`) and
   `lib/report.mjs`. Assert the values that were typed, the links between rows,
   and the calendar day — those are where the bugs actually are.
4. Prove the oracle can fail. Corrupting a value by hand
   (`qa_sql -c "UPDATE ..."`) and re-running just the oracle takes seconds, and
   an oracle that has never gone red is not yet evidence of anything.
