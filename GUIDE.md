# The Ladder — how to run a season

This is the practical companion to the [README](README.md). The README explains
*why* the system works the way it does; this explains *what to press*, in order,
from an empty repo to a finished season.

If you only need one thing: **enter results on match night, hit Export at the
end, and commit the file.** Everything else is setup you do once.

---

## Contents

1. [Getting it running](#1-getting-it-running)
2. [Season settings](#2-season-settings)
3. [Draft night](#3-draft-night)
4. [Drawing the fixtures](#4-drawing-the-fixtures)
5. [A match night](#5-a-match-night)
6. [Reading the tables](#6-reading-the-tables)
7. [Tuning the handicap](#7-tuning-the-handicap)
8. [Saving and sharing results](#8-saving-and-sharing-results)
9. [When something goes wrong](#9-when-something-goes-wrong)

---

## 1. Getting it running

CI builds on Node 22, so that is the safe version to use. The repo does not pin
one.

```bash
npm install
npm run dev        # http://localhost:5173
```

Other commands:

```bash
npm test           # the full suite
npm run typecheck  # types only
npm run build      # typecheck, then a production build
```

The live site is https://almahroof.github.io/the-ladder/ and redeploys on every
push to `main`.

**You do not need to run it locally to play.** One person opens the live site on
a phone, enters the night's results, exports at the end, and commits the file.
Running locally is for changing the code.

### The seven screens

| Screen | What it is for |
|---|---|
| **Dashboard** | Both tables, season progress, recent results |
| **Match entry** | Logging a result |
| **Head-to-head** | The matrix, and the cycles a single ranking hides |
| **Insights** | Upsets, streaks, win rate by tier, handicap calibration |
| **Fixtures** | The schedule and the draw |
| **Draft night** | Building the team pools |
| **Setup & pools** | Parameters, the fixed rules, and the fairness check |

Navigation is by URL hash, so back and forward work and any screen can be
bookmarked.

---

## 2. Season settings

**Setup & pools** → *Season settings*. Do this before the draft.

| Field | Default | What it does |
|---|---|---|
| Season name | `Season 1` | Display only |
| Draft locked on | *(empty)* | The date pools became immutable. Clearing it reopens them |
| Starting Elo | `1000` | Where everyone begins |
| K-factor | `24` | How fast ratings move |
| Team-gap conversion | `20` | **Elo per team-rating point** — the handicap |
| Goal-margin cap | `1.75` | Ceiling on the margin multiplier |
| Pool size | `10` | Teams each player drafts |
| Max uses per team | `3` | Fixtures, not matches — one fixture is both legs |

Below the fields, four numbers show the shape of the season. With four players
and the defaults:

| Pairings | Fixtures | Matches | Each player |
|---|---|---|---|
| 6 | 60 | 120 | 60 games |

**Changing a rating parameter replays every match.** Nothing is stored as truth
except the log, so a parameter can be retuned at any point and the whole history
re-rates. It does not alter a single result.

### What you cannot change

The *Season rules* card lists six rules that are fixed in code rather than
exposed as settings. Locking them is the point — it is what stops arguments:

- Draws score 0.5 in Elo, 1 point in the table
- Extra time and penalties count as a draw
- Two-leg fixtures, teams swapped in leg 2
- Team ratings locked to release-day values
- A rage quit is a 3–0 loss for the quitter
- The log is append-only; corrections never overwrite

### A note on pool size

Ten teams at three uses each is exactly 30 slots for exactly 30 fixtures. The
setup screen says so:

> 30 team-slots for 30 fixtures — an exact fit. Every team gets used all 3
> times, so changing one at match entry means changing another back later.

It works, but with no slack. Raising *Pool size* to 12, or *Max uses per team*
to 4, gives room to swap a team at entry time. See
[PLAN.md](PLAN.md#open-questions).

---

## 3. Draft night

**Draft night** builds each player's pool. Everyone should be in the room.

The status bar across the top tells you where you are — who is on the clock,
then *Snake draft · Round 1 of 10*, *Pick 1 of 40*, and *Max 2 tier-1 teams per
pool*.

**Pick order is a snake.** Shadow → Yusuf → Jonathan → Nana Kojo → Nana Kojo →
Jonathan → Yusuf → Shadow → … Whoever picks last in a round picks first in the
next, so nobody is permanently disadvantaged by drafting late.

To pick, click a team in the **Available teams** list on the left. It is grouped
by tier and shows release-day ratings. **Teams already drafted by anyone
disappear from the list** rather than being shown as unavailable, so what you
see is genuinely what is left.

A team still in the list can be dimmed for one of two reasons — hover to see
which:

- Your pool is full
- You already have your limit of tier-1 teams (default 2)

The **Draft board** on the right fills in as you go, with a highlighted slot for
whoever is on the clock.

**Undo** appears next to *Available teams* once at least one pick has been made,
and reverses the last pick.

### Locking

When all 40 picks are in, a **Ready to lock** card appears with the button
**Lock pools for the season**. The same button is at the bottom of *Setup &
pools*.

Locking stamps today's date into *Draft locked on* and makes the pools
immutable — *Pool size* and *Max uses per team* grey out, and teams can no
longer be added or removed.

Note the two buttons are not equally careful. The one on **Setup & pools** is
disabled while anything is outstanding, with *"Resolve the N pool problems
first."* underneath. The one on **Draft night** has no such guard — it is only
offered once the draft is complete, but it will lock whatever state the pools
are in. If in doubt, lock from Setup & pools.

To unlock, clear the *Draft locked on* field on *Setup & pools*. That field
gives you no warning; the warning is on **Draft night**, which says that
unlocking after matches have been played would invalidate the season. It means
it — pools are what fixtures were drawn against.

### If the pools are wrong

On **Setup & pools**, a **Pool problems** card lists everything outstanding. It
checks six things: a player with no pool, a pool belonging to someone not on the
ladder, a pool of the wrong size, the same team twice in one pool, a team in two
players' pools, and too many tier-1 teams. The **Pool fairness check** below it
shows teams per tier
and average rating per player — all four rows should look similar.

Neither card appears on Draft night. What you get there is a running `T1: n/2`
and an average rating per player on the draft board.

---

## 4. Drawing the fixtures

**Fixtures** → *Scheduler*. The pools must be **problem-free** first — the draw
takes each fixture's teams from them. Locking is not technically required, but
it is the right order: fixtures drawn against pools that can still change are
fixtures that can stop making sense.

The draw buttons also grey out once every round has been drawn, and *Re-draw*
is unavailable until at least one fixture exists.

Fill in **Session date** — it is stamped on the rounds you draw next. Use
`YYYY-MM-DD`, because the match log is replayed in date order and a date in
another format will sort wrongly.

Then:

| Button | What it does |
|---|---|
| **Draw next round** | One round — one fixture for every player |
| **Draw rest of season** | Every remaining round at once |
| **Re-draw unplayed rounds** | Keeps played rounds, redraws everything after the last one played |

Drawing a round at a time is the normal way to use it: you draw at the start of
a night, play, and draw again next time.

Every pairing meets before any pairing repeats. **Pairing coverage** on the
right shows progress toward the target for each of the six pairings.

### The seed

Every draw is seeded, and the seed is stored in the season file and shown under
*Draw seed*. Drawing more rounds reuses the existing seed; only **Re-draw
unplayed rounds** generates a fresh one. Because the seed is kept, a fixture
list can be regenerated later and shown to be the one actually drawn — which
matters for a system whose job is settling arguments.

### Reading the fixture list

Each row is one fixture — that is, two legs. *Teams (leg 1)* shows who fields
what in the first leg; **leg 2 swaps them**. The *L1* and *L2* columns fill in
as results are logged, and *Status* moves `scheduled` → `partial` → `played`.

---

## 5. A match night

### Before kick-off

Draw a round on **Fixtures**. Nobody picks their opponents or their teams.

### After each match

Go to **Match entry**. The form is thirteen numbered inputs, but you normally
only touch three of them.

| # | Input | |
|---|---|---|
| 1 | **Fixture** | Pre-filled with the next unplayed leg. Pick another if you played out of order |
| 2–3 | **Player A / Player B** | Locked, from the fixture |
| 4–5 | **Each player's team** | Locked, from the fixture. Leg 2 shows a *swapped* badge |
| 6–7 | **Goals** | ← **you type this.** Tap − and +. Score at the end of **normal time** |
| 8 | **Went to extra time / penalties** | Toggle |
| 9 | **Shoot-out winner** | Appears only if 8 is on. For fun and stats only |
| 10 | **Rage quit / abandoned** | Toggle |
| 11 | **Who quit** | Appears only if 10 is on |
| 12 | **Notes** | Optional |
| 13 | **Entering as** | Which of the two of you is holding the phone |

**Goals are always the score at the end of normal time.** Extra time and rage
quits are flags on top of that score, not replacements for it — the app works
out what actually gets recorded. A 2–2 that you won on penalties is entered as
2–2 with the toggle on, and goes into the ladder as a draw.

### What the app shows you before anything saves

**Rating impact preview** on the right shows the team ratings, the expected
result, the goal-margin multiplier, and exactly what each rating would become.

The handicap appears on **Player A's line only** — *"{A} Elo + handicap"*
against a plain *"{B} Elo"*. That is not a display quirk: only the *difference*
between the two sides feeds the expected score, so the whole team gap is written
onto one side and the arithmetic comes out the same.

**Checks before saving** shows six groups of
validation that must all pass: two different players both on the ladder with one
of them entering, each team in that player's pool, team use within the season
cap, leg 2 swapping leg 1's teams, a whole-number score from 0 to 20 with the
flags agreeing with it, and not already in the log.

### Confirming

1. Press **Send to {opponent} to confirm**. It is disabled until every check
   passes.
2. The panel turns blue: *"Hand the phone to {opponent}"*, with the score and
   what it does to **their** rating.
3. They press **Confirm** — and only then is anything saved.
4. If they disagree they press **Dispute**, which returns to the form.
   Disputed results are not saved.

After a save you get a confirmation line and the form advances to the next
unplayed leg.

### Corrections

The log is append-only. There is no edit button, by design. A correction is a
**new entry that supersedes an old one**, so the mistake and the fix are both in
git history and nobody can quietly rewrite a result.

**The app has no correction screen yet.** The engine supports it fully — an
entry carrying `correctsMatchId` replaces the one it names, and every rating
recomputes around it — but nothing in the UI sets that field. In practice a
correction today means adding the superseding entry to `data/season-1.json` by
hand and committing it, which at least puts the change in front of all four
players.

You cannot reach a double entry through the form anyway — the *Fixture*
dropdown only lists legs with no result yet. Behind it the engine refuses one
regardless, with *"Corrections need all four players to approve."*

### At the end of the night

**Export**, and commit the file. See [section 8](#8-saving-and-sharing-results).

---

## 6. Reading the tables

### Dashboard

- **Season progress** — matches played, fixtures drawn
- **Highest Elo** — the leader and the gap to second
- **Ranking confidence** — see below
- **Tournament table** — the fun one. Win 3, draw 1, loss 0. Tiebreakers in
  order: points, goal difference, goals for, head-to-head, Elo. Head-to-head
  only settles it when **exactly two** players are level; a three-way tie skips
  straight to Elo, because "who beat whom" has no single answer in a cycle
- **Skill ranking** — the real one. Elo with the handicap, carried across
  seasons, with a 90% range
- **Recent results** — newest first

### Why it says "too close to call"

The skill ranking's range comes from resampling the match log 600 times. The app
names a leader **only** when their lowest plausible rating beats everyone else's
highest, and will not crown anyone while a player still has no matches at all.
Twenty games per pairing is not enough to separate close players, and it says so
rather than pretending otherwise.

### Head-to-head

Each cell is the row player's record (W–D–L) and goal difference against the
column player. Click a cell to see every meeting with its Elo swing.

Its real job is **cycle detection**. If A beats B, B beats C and C beats A, then
no ranking in a straight line is faithful to what happened, and an amber panel
says so explicitly. Check it before declaring a winner.

### Insights

Upset rate, biggest win, longest unbeaten run, clean sheets, win rate by team
tier, and per-player detail. Small samples swing wildly — these are prompts to
look closer, not findings.

---

## 7. Tuning the handicap

20 Elo per team-rating point is a starting guess. **Insights** → *Handicap
calibration* is where it gets settled.

It needs **40 matches with a team-rating gap**. Only matches between differently
rated teams say anything about the handicap, so level match-ups do not count.
Until then it says *"Not enough data yet"* and shows progress toward the
threshold.

Once there, it compares what the model expected of the stronger-team side
against what that side actually scored, and gives a verdict:

| Headline | Meaning |
|---|---|
| *"{n} Elo per rating point looks right"* | Expected and actual agree; the conversion is doing its job |
| *"Stronger teams are winning more than the model expects"* | The handicap is not compensating enough; team strength is still leaking into the ratings |
| *"Stronger teams are winning less than the model expects"* | The handicap is over-compensating; using a better team is punished too hard |
| *"{n} is already the closest fit available"* | There is a gap, but no value of the conversion narrows it. What is left is noise, or something the handicap cannot model |

That last one matters: a gap between expected and actual is not automatically a
reason to move the dial. If the app says you are already at the closest fit,
leave it alone.

When a better value does exist, a **Use {n}** button appears. Pressing it
re-rates every match from the start of the log. It does not alter a single
result, and you can change it again at any time.

The cross-check is **Win rate by team tier used**: if the handicap is right
these sit near 50% across the board. A tier consistently above or below is the
clearest sign the conversion needs moving.

---

## 8. Saving and sharing results

**There is no server and no database. The repository is the database.**

```
data/teams.json      the team catalogue with locked release-day ratings
data/season-1.json   season config, pools, fixtures and the match log
```

As you enter results the browser keeps a working copy in `localStorage`. That
copy is private to that browser on that phone. **Export** downloads the updated
`season-1.json`, and committing it is what makes the results real for everyone
else.

So the loop is:

1. Enter results during the night
2. **Export** at the end — the button shows a dot while you have unexported work
3. Replace `data/season-1.json` with the downloaded file and commit it
4. Everyone else picks it up on their next load

Git history then becomes the dispute record: you cannot silently edit a past
result, and all four players can see every change.

### "The repo has moved on"

If the committed file changes while this browser still holds a working copy, the
app notices on load and says so. (It does not matter whether you had unexported
edits — any local copy built on an older commit trips it.)

It keeps working from **your** copy and does not touch the committed one, so
nothing is lost silently, and the warning survives further editing — it cannot
be dismissed by accident. What it will not do is merge the two; that is a
judgement only the people who played can make.

Export yours **before** pressing *Discard local*, or the entries made in that
browser are gone.

---

## 9. When something goes wrong

**The draw buttons are greyed out.** Either the *Pool problems* card on *Setup
& pools* has something in it, or every round has already been drawn. (*Re-draw
unplayed rounds* additionally needs at least one existing fixture.)

**A team is greyed out in the draft.** Your pool is full, or you are at your
tier-1 limit. Hover to see which. (A team someone else has drafted is not
greyed out — it is gone from the list.)

**"Send to confirm" is disabled.** Look at *Checks before saving* — one of the
six groups is red and names the problem.

**Leg 2 won't accept my teams.** Leg 2 must use leg 1's teams reversed. The app
checks this in both directions, so the order you enter the legs cannot defeat
it.

**The ratings look wrong after I changed a setting.** They are not stored; they
are recomputed from the log every load. Change the setting back and they return.

**A banner says the season file has problems.** Something in the committed file
or in this browser's copy had to be repaired. That covers anything from a field
defaulted because it was the wrong type, to a duplicate match id, to a row
dropped outright. The app names each one by position and carries on rather than
showing a wrong ladder.

Read the message. A row that was **dropped** says so — *"…so it is not counted
in any rating"* — and that one matters, because the ladder is now missing a
result. Fix the file and re-import.

**The app shows "The Ladder could not start."** Something made it fail while
drawing the screen. Press **Export this browser's copy** first — it downloads
whatever is stored locally so the results can be recovered by hand. *Discard it
and reload* stays disabled until you have, because discarding without a copy
cannot be undone.

---

## Where to go next

- [README.md](README.md) — why the system is built this way, and where the team
  ratings come from
- [PLAN.md](PLAN.md) — the build plan, deviations from the source documents, and
  the open questions
- [`fc26-ranking-system-1.md`](fc26-ranking-system-1.md) — the full scope and
  rules
