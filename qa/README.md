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
- its own fake AI provider on **:3012** (`qa-ai-stub.mjs`), so no scenario ever
  spends a token or sends a photograph to a third party,
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
| `setup/X.sh` | Optional. Start state the app cannot reach from inside itself. |
| `oracles/app-logs.mjs` | Runs for **every** scenario; fails on anything the app logged as ERROR. |

`setup/X.sh` runs between the reset and the flow, on the freshly created
database and the freshly installed app, and only when it exists — two scenarios
have one. It comes after the reset for the same reason the reset comes first at
all: whatever it seeds has to be the only thing there.

`flows/crawl.yaml` is the exception that proves the shape: it has no oracle of
its own because it has nothing to assert. It walks every screen a signed-in
account can reach from an empty database — 45 of them — and lets
`app-logs.mjs` alone decide, which buys crash coverage over the whole app for
the price of a flow. Its header lists the screens it cannot reach and what each
is waiting for; all of them need content created first.

`flows/content-crawl.yaml` is what creates it. It is a crawl *and* a scenario:
it makes a food, a diary entry, a custom exercise, a live workout with a logged
set, a saved preset, an activity and a medication through the UI, walking the
15 detail screens that content unlocks on the way, and it has a real oracle
(`oracles/content-crawl.mjs`) because everything it taps is a row being written
— a detail screen reached with the wrong numbers behind it is not the coverage
it looks like. The two flows are deliberately not merged: the empty-database
walk is its own start state, and it is the one that catches an empty-state
screen crashing.

`flows/fasting-and-cycle.yaml` is the third of the family, and it covers the
other reason a screen is out of reach: not missing content, but a feature the
account has not opted into. It starts a fast and switches cycle tracking on,
which is what makes FastingDetail, CycleOnboarding, CycleHub, CycleLogModal and
PregnancySetup exist at all, and its oracle reads back the fast's goal, the
period days onboarding seeds, the note the log modal saved and the pregnancy's
due date.

`flows/saved-meal.yaml` is the fourth, and it is gated on a chain rather than
on a single row: MealDetail needs a saved meal, FoodEntryAdd's logging face
needs that meal to be logged, and EditLoggedMeal needs the diary row the
logging created. So it stands on `lib/create-and-log-food.yaml` for an
ingredient, builds a meal out of it, logs the meal to a meal type it picks
rather than the one the clock offers, and bumps the servings on the entry. Its
oracle is the harness's widest single write: a meal saved across `meals` and
`meal_foods`, a log across `food_entry_meals` and a `food_entries` row per
ingredient, and a servings edit that has to rescale that component row while
leaving the loose entry beside it alone.

`flows/food-photo.yaml` is the fifth, and it is the only one whose start state
could not be produced through the UI at all. FoodPhotoFlow's Improve,
EstimateReview and LogEntry need two things a mobile-only account on a
simulator can never have: **a photograph**, on a device with no camera, and **an
AI provider**, which is configured in the web frontend. `setup/food-photo.sh`
seeds both — see the section below — and the flow then does the ordinary thing:
picks the photo, types a weight and a description, generates, reviews and logs.

Its oracle reads both ends. From the diary it takes the food, the variant and
the entry, checking that the estimate's macros survived unchanged and that the
serving size is the weight that was *typed* rather than the total the provider
returned. From the stub's request log it takes what the app actually sent — one
request, one image, the seeded photograph's exact dimensions, and the typed
weight and description inside the prompt. That second half is what makes this
more than a screenshot test: a screen that renders the description and then
drops it before the request is a bug no diary row can see.

`flows/suggested-workout.yaml` is the sixth, and the only one whose subject is
an *algorithm*. Nothing about a generated workout is decided on the client: the
muscles, the exercises, the sets, the reps, the rest and the estimated length
all come back from `POST /api/workout-recommendations/generate`, and the app
draws what it is handed. So it picks the Push split, starts the workout that
comes back, completes one set and ends it.

Three things it checks that no screen can show. **That the request survived**:
the client resolves Push to chest, shoulders and triceps and sends the muscles —
the server has no split vocabulary — so the muscles in the stored payload are
the only evidence the tap reached the wire. **That the plan is programming, not
a list**: every asked-for muscle is served, compounds are ordered ahead of
isolations, and every set carries reps and a rest length. **That the prescription
becomes a diary row the way it is supposed to**: sets are created empty and the
generator's numbers live on the client as gray placeholders until a set is
completed, so the flow types *nothing* — and the 10 reps that land on the one
completed set can only have come from the generator, while the seventeen
untouched rows stay null.

It also asserts, twice over, that the run never went to the network:
`importMissingMuscles` silently imports from free-exercise-db when a target
muscle has no local candidate, and it is not configurable. See the section
below.

Steps more than one scenario needs live in `flows/lib/` and are pulled in with
`runFlow` (`lib/boot.yaml`, `lib/create-and-log-food.yaml`,
`lib/grant-notifications.yaml`). Every trap in one of those cost a green run
that was doing something else entirely, so a copy would drift the moment one of
them is fixed.

`app-logs.mjs` is the cheapest broad coverage in the harness: `LogService.ts`
already writes structured entries into AsyncStorage and most screens are wrapped
in error boundaries that log on the way down, so every scenario gets
crash-and-exception coverage across features it never even visited.

Findings come in two grades, enforced by `oracles/lib/report.mjs`. `check()` is
a hard, evidence-backed assertion and fails the run; `observe()` is a soft
signal that is recorded and never gates. Without that split the report is 90%
noise by week two and stops being read.

## Seeding what the app cannot make

There are two setup scripts, and everything worth generalizing is in them.

**The photograph.** The simulator has no camera, so the only way a photo reaches
the app is the library, and the library only holds what `xcrun simctl addmedia`
put there. The file is a PNG generated in Node (`fixtures/food-photo.mjs`, a
hand-rolled deflate + CRC32 encoder) rather than a committed asset: this repo is
public, and a binary blob in it would be one more thing to explain. Its size,
646x482, is the fixture's own constant and the oracle asserts the uploaded image
matches it — which is how a run proves the app sent *this* photograph and not
one of the six stock ones every iOS runtime ships.

Picking it out of the grid is the interesting part, and the answer is dates, not
coordinates. The picker sorts newest first, the stock photographs carry 2011
EXIF dates, and `touch -t` stamps the seeded file 2019 — so it is always the
top-left cell. Re-running stacks more identical copies in front of it, which
changes nothing: same bytes, same date, same cell.

**The provider.** `isFoodPhotoAvailable` gates the whole photo mode on the
account having an AI service configured, and AI services are configured in the
web frontend — a mobile-only account can never get past it. `qa-ai-service.mjs`
signs in over the API and saves one, then re-reads it **from the database**
rather than trusting the response, because a setup step that silently half-works
produces a flow failure fifty steps later that looks like anything but.

The service it saves is `service_type: 'custom'`, which is the one provider type
whose `custom_url` the server posts to verbatim; everything else rewrites the
URL. `qa-env.sh` also exports `ALLOW_PRIVATE_NETWORK_AI=true`, without which the
server refuses a loopback provider both at save time and at dispatch time.

**Why stub the model at all.** A real model returns different numbers for the
same photograph on every run, so the oracle could only ever check that
*something* plausible was written — which is the class of assertion this harness
exists to avoid. The stub replaces the model and nothing else: the app, the
estimate route, the provider dispatch, the schema validation and the review form
are all the real thing, and the stub records every request it receives so the
oracle can assert on what the app actually sent.

It listens on 127.0.0.1 only, and it records requests it did not expect as well
as the ones it did — expo-dev-launcher port-scans localhost looking for a dev
server and hits it with a bare `GET /` every run. Those are reported as
observations, never as failures.

**The exercise catalog** (`setup/suggested-workout.sh`) is the other kind of
seeding: not something the app cannot reach, but something the *server* will go
and fetch if it is missing. A fresh QA database has zero exercises, and the
workout generator does not build a smaller workout when a target muscle has no
candidate — `importMissingMuscles` fetches one from free-exercise-db, downloads
its images and imports it, with the URL hardcoded and no env override. A run
without a catalog would therefore be online, dependent on a third party, and
different every time upstream changed.

So `fixtures/exercise-catalog.mjs` defines two exercises for each of the
seventeen canonical muscles — a compound and an isolation, `body only` so no gym
profile can rule them out — and `qa-exercise-catalog.mjs` creates all 34 through
the real API and then verifies from the database that every muscle is covered as
a *primary* mover, which is the only kind of cover the planner counts. The names
are invented (`QA Catalog chest 1`) rather than copied from a dataset: this repo
is public, and a workout built out of them could not have come from anywhere
else, which is what makes the oracle's "nothing was imported" check sharp.

That check is made twice, because one of them alone is not enough. Every
prescribed exercise must be one of the seeded rows — but an import that happened
and was then *not* prescribed would slip past that, and it would still mean the
next run produces a different workout. So the oracle also asserts the table still
holds exactly 34 rows, and that this run's slice of `server.log` contains no
`free-exercise-db` line (`setup/suggested-workout.sh` records the log's byte
offset first, because `server.log` outlives a single run).

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
`centerElement: true` before it is tapped. The same tap through the keyboard
lands on *buttons* too, and there it is quieter still: the meal builder's "Add
Food" sits under the letter keys, so the tap typed a `t` onto the end of the
meal name and the flow went on to assert a search screen it had never opened.

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

**Centring is not enough for the last field on a form.** Save sits at the bottom
of the food and activity forms and the numeric keypad covers the bottom third of
the screen, so a tap on Save presses whichever digit is at those coordinates: the
calories read `2122` and the form never saved at all, with the flow green until
a later selector missed. `hideKeyboard` does not work on this app ("Couldn't hide
the keyboard" — its input accessory is not a standard dismiss action). What does
is a tap on something inert: the food form's ScrollView is
`keyboardShouldPersistTaps="handled"`, so tapping a field's own *label* dismisses
the keypad, and the activity form has a "Done" accessory of its own.

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

**And so is any `Pressable` that wraps more than it presses.** RN's `Pressable`
and `TouchableOpacity` default to `accessible={true}`, which collapses the whole
subtree into one comma-joined label the same way: the active workout's set row
announced "Weight, Reps, Log set 1" as a single node, and `ActivityAddScreen`
wrapped its entire form in a keyboard-dismissing `Pressable`, so the snapshot
offered "Edit activity name, Date, Today, …, Activity notes" and not one of those
fields could be focused — by a flow or by a screen reader. Same one-line fix,
same reasoning: a wrapper whose only job is a tap-outside shortcut is not an
accessibility element.

**Text selectors are full-string and case-insensitive.** `"Reps"` matches the
`REPS` column header above the field, and the header comes first in the tree, so
the reps went nowhere and the set saved with a null. `rightOf:` does not save
you — it does not require vertical overlap, so it matched the header too. An
anchor that does (`below: "SET"`) or an explicit `index:` is the fix.

They are also *regexes* matched against the whole string, which bites on labels
that contain regex punctuation. A required field's `"Meal Name *"` never
matches itself — the pattern reads the asterisk as "zero or more spaces" — and
`"Description (optional)"` matches only the string without its parentheses.
`"Meal Name.*"` is the fix; the trap is that both selectors fail as "element
not found", which reads like the screen was wrong rather than the pattern.

**A pushed screen does not remove the one it was pushed over.** Modal honouring
is off, so the whole stack is one tree: the meal builder's "Add Food" and the
ingredient sheet's "Add Food" footer are both matchable while the sheet is on
top, and nothing separates them — they are the only two texts at their
respective depths, and no anchor lies between them. `index: 1` is the tap. The
sharper half of this trap is the *wait*: `extendedWaitUntil: visible: "Add
Food"` before that tap asserts nothing at all, because the builder underneath
has already satisfied it. Wait on something only the new screen has (its header
buttons) instead.

**A settings row is two nodes, and a picker announces the wrong one.** A row
whose control is a `Switch` matches its own title twice — once as the title
`Text`, once as the switch, which carries the same label so a screen reader can
say what it toggles — and the title comes first, so the switch is `index: 1`
and a tap on the title is silent. A `BottomSheetPicker` is the opposite trap:
its trigger *displays* the current value but is *labelled* with the sheet's
title, so the words on screen ("Standard Cycle") match nothing and the label
("Select Mode") matches the trigger and the sheet it opens.

**Assert on what a save destroys, not on what it leaves.** With modal honouring
off, the screen behind a modal is "visible" through it, so waiting for the hub
after saving the cycle log asserted nothing: a save that failed left the modal
up and the wait passed anyway. `extendedWaitUntil: notVisible:` on the modal's
own title is the assertion, because the modal dismisses itself only on a save
that came back clean. That is how the harness found a bug that had made the
cycle day's temperature unsaveable from mobile since it shipped.

**A system permission alert steals a tap for the screen behind it.** Starting a
live workout calls `ensureNotificationPermission()` one line before it navigates,
so iOS raises its prompt whenever it gets round to it — and the tap that clears
it also reaches the app underneath, where ActiveWorkout's "Add an Exercise" sits
exactly under the alert's Allow. That logged the exercise twice, opened the
exercise picker over the workout, and left the set values in a screen that was no
longer in front. Notification permission cannot be pre-granted the way camera or
photos can (`simctl privacy` has no such service, and neither does Maestro's iOS
permission list), so it is granted *deliberately* first, on Settings →
Notifications, before anything can be surprised by it. That is
`lib/grant-notifications.yaml`, shared by both flows that start a workout.

**The system photo picker is invisible to the driver.**
`PHPickerViewController` renders out of process, and the app's accessibility
tree shows it as one empty node the size of the screen — no cells, no labels,
nothing a selector can match, and `maestro hierarchy` with the picker plainly on
screen returns 8 KB of status bar. There is no app source to fix here (contrast
the bottom-sheet trap above), so `food-photo.yaml` taps it by coordinate, and
that is the only coordinate tap in the harness. What makes it stable is the
seeding rather than luck — see the section above. There is nothing to wait on
either: every selector reports the scanner underneath and is satisfied the
instant the sheet starts animating, so the flow uses the only sleep Maestro can
express, an `optional: true` wait on a string that can never match.

**An icon-only button announces its SF Symbol name, and that is not unique.**
An unlabelled `StepperInput` offers "add" and "remove" — which is what
`saved-meal.yaml` taps, on a pushed screen where the tab bar is gone. The photo
flow is a **modal**, so with modal honouring off the tab bar is still in the
tree and its centre button is "Add" too. The tap went to the tab bar's
coordinates, which on that screen is the full-width Save at the bottom: the
entry saved at one serving and the flow popped back to Home, then failed
looking for a button on a screen it had left. The fix is the one-line kind
again — that stepper now says what it steps — because a button VoiceOver reads
as "add", with no object, is a defect before it is a selector problem.

**`back` is not the pop gesture.** Maestro's iOS `back` swipes too briefly to
engage a native stack's interactive pop, and simply does nothing on a screen
with no back button to fall back on. An explicit
`swipe: {start: "2%, 50%", end: "95%, 50%", duration: 800}` is what a thumb
does, and it works. Reach for it only when a screen genuinely cannot be left by
tapping: `crawl.yaml` needed it once, for a settings screen that rendered a
headerless spinner to any account that had never configured it, and that turned
out to be the screen's bug rather than the flow's — the swipe went away with the
fix, which is the outcome to aim for.

**A landing signal has to be on screen, not merely on the screen.** Maestro
honours occlusion and the viewport even with modal honouring off, so an element
below the fold is "not visible" — and a wait for it fails on a screen that is
perfectly correct. `content-crawl.yaml` waits for ActiveWorkout by its
"End Workout" button, which works because the session it starts has one
exercise; `suggested-workout.yaml` starts a six-exercise session and the same
wait timed out with the screen fully drawn behind it. The fix is to land on
something structural that cannot scroll away — there, the header's per-exercise
progress segments (`header-segment`).

**Prefer the control that needs no aim.** Logging a set on ActiveWorkout means
finding one cell among three identical rows, which needs an anchor *and* an
index and is wrong the moment a card renders a fourth set. The rest bar's
"Complete Set" button acts on whichever set is active, so it takes no selector
argument at all — and the flow that uses it makes no assumption about layout.
When two controls do the same thing, take the one whose selector cannot become
ambiguous.

## Adding a scenario

1. Write `flows/X.yaml`, starting with `- runFlow: lib/boot.yaml` (fresh install
   → onboarding → connected to the QA server → Home).
2. Run it and watch: `bash qa/bin/qa-run.sh X`. Use
   `maestro studio` or `maestro hierarchy` when a selector will not match — the
   answer is usually that the element is behind the keyboard, or that the
   selector matches something on the screen *behind* the sheet.
3. If the scenario needs a start state the app cannot reach from inside itself,
   add `setup/X.sh`. Keep it loud: verify what it did from the database rather
   than from the response, because a setup step that half-works fails the flow
   fifty steps later looking like anything but.
4. Write `oracles/X.mjs` against `lib/db.mjs` (`query`, `qaAccount`, `lit`) and
   `lib/report.mjs`. Assert the values that were typed, the links between rows,
   and the calendar day — those are where the bugs actually are.
5. Prove the oracle can fail. Corrupting a value by hand
   (`qa_sql -c "UPDATE ..."`) and re-running just the oracle takes seconds, and
   an oracle that has never gone red is not yet evidence of anything.
