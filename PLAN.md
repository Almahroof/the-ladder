# The Ladder — build plan

FC26 four-player skill ranking system for Shadow, Yusuf, Jonathan and Nana Kojo.

Source documents:

- [`fc26-ranking-system-1.md`](fc26-ranking-system-1.md) — the full scope and rules
- [`fc26-ranking-system-app-screens-1.pdf`](fc26-ranking-system-app-screens-1.pdf) — 12 screen mockups

This plan turns those into something buildable. Where it contradicts the source
documents, the contradiction is called out explicitly in
[Open questions](#open-questions) rather than silently resolved.

---

## 1. Constraints

Four friends, same sofa, same console. No budget, no ops, no accounts. The app
has to survive being opened on a phone at 11pm with one hand.

That rules out a server, and rules in a static site.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App | Vite + React + TypeScript | Builds to plain static files that GitHub Pages can serve |
| Styling | Tailwind | The mockups are a dark, dense, card-based UI |
| Elo engine | Plain TypeScript module, zero dependencies | Testable in isolation, as §12 of the spec asks |
| Tests | Vitest | Pinned to the worked examples in the documents |
| Data | JSON files in the repo, localStorage working copy | Git history *is* the append-only match log |
| Deploy | GitHub Actions → GitHub Pages | Push to `main`, the URL updates |

Python (`/home/jugram/ML`) is used only for one-off side scripts, such as
preparing the team-ratings data. It is not part of the app.

---

## 3. How data moves without a server

1. `data/teams.json` and `data/season-1.json` live in the repo. Anyone opening
   the URL sees the same ladder.
2. On match night **one device is the scorer**. It loads the committed JSON and
   appends new results to a working copy in `localStorage`.
3. At the end of the night, **Export** downloads the updated `season-1.json`.
   It gets committed to the repo — GitHub's web editor works fine from a phone.
4. Everyone else sees it on their next page load.

The git commit log becomes the dispute record that §4.7 and §5.3 ask for. You
cannot silently edit a past result; the history is public to all four players.

**Opponent confirmation** (field 13) is a pass-the-phone step: the result screen
shows the Elo impact, the opponent taps Confirm, and only then does it save.
Same guarantee as the mockup, no network required.

### Upgrade path, if exporting gets annoying

The data layer sits behind a single `Store` interface. A second implementation
can write match results straight to the repo through the GitHub Contents API,
using a fine-grained token pasted once per phone. Still no hosting. Deliberately
not built on day one.

---

## 4. Architecture

```
src/
  engine/        pure, dependency-free, fully tested
    elo.ts         rating maths and log replay
    teams.ts       catalogue and tier bands
    season.ts      config, pools, fairness and the season cap
    schedule.ts    round-robin fixture generation
    random.ts      seeded RNG, so every draw is reproducible
    tables.ts      tournament table, head-to-head matrix
    confidence.ts  bootstrap resampling for the "too close to call" label
  store/         load, save, export, import
  ui/            screens and components
data/
  teams.json     team catalogue with locked release-day ratings
  season-1.json  season config, pools, fixtures, match log
```

The engine never imports from `store` or `ui`. Every rating, table, streak and
form figure is **derived from the match log on load** — nothing is stored as
truth except the log itself. That is what makes retroactive parameter changes
safe, and it is why a correction is a new entry rather than an edit.

---

## 5. Milestones

### M1 — The engine ✅

`elo.ts`: expected score, goal-margin multiplier, rating update, outcome
resolution for extra time and rage quits, and `replayLog()` to rebuild every
rating from scratch. Unit tests pinned to §5.4, §6 and screen 04. No UI.

This is the part that has to be right; everything else is presentation.

### M2 — Data and season setup ✅

`teams.ts` and `season.ts`, plus `data/teams.json` and `data/season-1.json`.

- Tier derivation from ratings, with configurable bands
- Season config, and `scheduleShape()` for the size of a season
- `checkPoolFeasibility()` — can a pool actually cover the season?
- `poolFairness()` — the tier-count and average-rating table from screen 08
- `validatePools()` — every §3 rule, reported together rather than one at a time
- `teamUsage()` and the season cap

Tests reproduce screen 08's fairness table exactly, for all four pools.

### M3 — Fixtures ✅

`schedule.ts` and `random.ts`.

- `roundRobinCycle()` — circle method, so every pairing meets before any repeat
- `generateFixtures()` — seeded and reproducible, drawing teams least-used-first
  so the season cap holds, and alternating the Player A slot within a pairing
- `teamsForLeg()` — the §4.4 swap rule, encoded in exactly one place
- `pairingCoverage()`, `scheduleProgress()`, `upcomingFixtures()` — screen 10

All randomness is seeded; `Math.random` is not used anywhere in the engine. A
fixture list can be redrawn from its seed and shown to be the one that was
actually generated, which matters for a system meant to settle arguments.

### M4 — Match entry ✅ *(logic; UI pending)*

`match.ts`: the match record from §9, `validateEntry()` with every §5.3 check,
`previewEntry()` for the rating-impact panel, and `appendMatch()` for
append-only writes.

Three rules turned out to carry most of the risk, and all three were initially
got wrong — see [Review findings](#review-findings):

- The leg swap must be checked in **both directions** and against the fixture's
  player order, or the order of entry decides whether §4.4 is enforced at all.
- A correction must **release what it replaces** before usage and duplicates
  are evaluated, and must name the same leg of the same fixture.
- Team usage is **per season**; Elo is not (§10 carries it over).

The entry screens themselves (02–04) are still to build.

### M5 — The tables ✅ *(logic; UI pending)*

`tables.ts` and `confidence.ts`.

- `tournamentTable()` — win 3, draw 1, loss 0, with §7's tiebreakers, form,
  clean sheets and longest unbeaten run
- `headToHead()` and `headToHeadMatrix()` — screen 06, the table that shows
  cycles a single number hides
- `bootstrapConfidence()` — 600 resamples of the match log for the 90% range
  and the "too close to call" label
- `skillRanking()` and `dashboard()` — screens 05 and 01

Two things worth remembering here. Head-to-head can only settle a **two-way**
tie; used on three tied players it is not a transitive comparison and makes the
league order depend on the roster order. And a player with **no matches** has
no confidence band at all, only a placeholder — so nobody is crowned while
anyone is still unmeasured.

### M6 — The app ← *next*

Everything above is engine. Nothing is on screen yet.

Vite + React + Tailwind scaffold, the `Store` layer from section 3, then the
screens: dashboard, match entry, skill ranking, head-to-head, season setup, and
the phone layout from screen 11. Then the Pages workflow and a live URL.

### Later, once games have actually been played

Draft night (screen 09), Elo-over-time chart, insights (screen 07), and the
tuning exercise from §6 — after 40–60 matches, check whether 20 Elo per
team-rating point is actually the right constant.

---

## 6. Deviations from the source documents

**Fixtures are built before the strict v1 is finished.** The spec puts the
scheduler in v2, but match entry depends on fixtures for pre-fill, round and leg
numbers, and the Leg-2 swap rule. A strict v1 could not be used on a match
night, so M3 comes before M4.

**Confidence ships in v1.** The spec lists it as v3, but the v1 skill-ranking
table has a Confidence column and the whole project exists to be statistically
honest. The bootstrap described on screen 05 — 600 resamples of the match log —
runs in roughly 40ms at this data size. It is nearly free, so it ships early.

---

## Review findings

M4 and M5 were each reviewed independently after being written, and each review
found blocking bugs the tests had missed. All are fixed, each with a regression
test naming the bug. Recorded because the same traps will recur.

### M5

**The league order depended on the roster order, not on results.** Head-to-head
was applied inside three-way ties, making the comparator non-transitive — in a
cycle it claims a < b < c < a. `Array.sort` given an inconsistent comparator
returns an arbitrary order, so reordering `playerIds` reshuffled the table, and
it could place a player above someone who had beaten them — screens 01 and 06
contradicting each other from identical data. Head-to-head now resolves only
two-way ties; anything larger falls through to Elo.

**A retracted result still shaped the published confidence band.** `replayLog`
drops superseded entries itself, so the rating was right — but the bootstrap
drew from the raw array, resampling a scoreline all four players had struck
from the record and widening the band by ~29 Elo.

**The confidence band was lopsided.** The two ends were derived independently,
and because `1 - 0.9` is `0.09999999999999998`, the lower tail trimmed 29
samples where the upper trimmed 30 — a 90.17% band, biased against naming a
leader, which is exactly the judgement the label exists to make.

Also fixed: a tie for top rated went to whoever came first in `playerIds`,
reporting a player with no matches as top-rated in 100% of resamples; and
`dashboard(ctx, 0)` returned the entire log, because `slice(-0)` is `slice(0)`.

### M4

**The leg-2 swap could be defeated by listing the players the other way round.**
Teams were compared positionally against the leg-1 entry, so reversing both the
players *and* the teams looked identical to a correct swap — while in fact
neither player had swapped. §4.4 is the cleanest skill test in the whole system
and it was silently optional. Fixed by requiring the entry to follow the
fixture's player order, per §5.1 field 2.

**The swap was only enforced in one direction.** Entering leg 2 first, then leg
1, skipped the rule entirely. Now whichever leg is logged first fixes the
pairing and the other must reverse it.

**A correction bypassed the season cap.** A correction shares its fixture key
with the entry it replaces, which was mistaken for "this fixture already holds a
slot". The same root cause rejected legitimate corrections of friendlies.

Also fixed: team usage leaked across seasons; a correction could name any
unrelated match and silently delete it from the ratings; a non-participant could
enter and confirm a result; the preview for a correction included the entry it
was throwing away, so the opponent confirmed a wrong number; a failed fixture
draw emitted fixtures with empty team ids; and an odd `gamesPerPairing`
overshot the season by a full round.

## Open questions

These are genuine contradictions in the source documents, not preferences.
Each one needs a decision before the season starts.

### 1. The team usage cap leaves no slack

Screen 08 settles what a "use" means: Nana Kojo shows **9 uses after 18
matches**, so one use is one *fixture*, covering both legs. Not one match.

That makes the arithmetic exact. Each player appears in **30 fixtures**
(3 opponents × 10 fixtures each). A 10-team pool capped at 3 uses gives
**exactly 30 team-slots**. It fits — but with zero slack, which means every
team must be used the full three times and nobody can ever avoid a team they
have come to hate.

Proposed fix, which §3 already permits: **pool size 12, cap 3 uses**, for 36
slots against 30 fixtures. Screen 08 shows 10; that is the number to change.

`checkPoolFeasibility()` reports this rather than silently correcting it, so
the setup screen will show the warning until the number is changed. The
defaults in code stay at the documented 10.

**Status: unresolved, but no longer blocking. Decide before the draft.**

### 2. The Leg-2 swap contradicts the pool check

§5.3 requires both teams to be in the right player's pool, but §4.4 means that
in Leg 2 you field your *opponent's* team. Both cannot hold.

Proposed fix: make the check leg-aware. Leg 1 checks pool membership; Leg 2
checks only that the teams are the Leg 1 teams reversed.

`teamsForLeg()` already encodes the swap, and `poolOwnerOf()` answers whose
pool a team came from regardless of who is fielding it, so M4's validation can
be built on those rather than reimplementing the rule.

**Status: resolution ready, needs your sign-off before M4 ships.**

### 3. Rage quit while ahead

§5.1 field 11 says a 3–0 loss is recorded "unless they were already losing by
more, in which case the actual score stands". Read literally, someone who quits
while winning 2–0 has 0–3 recorded against them.

The engine implements that literal reading, and a test pins the behaviour.

**Status: implemented as written, needs confirmation.**

### 4. Extra time is cosmetic

Fields 8 and 9 can never change a rating. §5.3 requires a level normal-time
score before extra time can be flagged, and a level score is already a draw. The
toggle is pure flavour — worth knowing before building UI around it.

**Status: no action needed, just be aware.**

### 5. Team ratings are placeholders

`data/teams.json` holds the 40 clubs from the mockups with their illustrative
ratings, flagged `"placeholder": true`. These **must** be replaced with real
FC26 release-day values before the draft locks, since they feed the handicap
directly.

One consequence worth knowing: that catalogue contains only **two** tier-1
teams, so §3's "at most 2 from the top tier" rule can never actually fire. A
real catalogue with ~10 elite teams will make it bite.

**Status: unresolved. Blocks the season, not the build.**
