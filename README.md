# The Ladder

A skill ranking for four friends playing EA Sports FC 26 on one sofa.

**Live: https://almahroof.github.io/the-ladder/**

Players: Shadow, Yusuf, Jonathan, Nana Kojo.

The question it exists to answer is narrow and specific: **who is actually the
best at FC26?** Not who drafted the best teams, not who got the kindest run of
fixtures — who is best. Everything in here follows from taking that question
seriously.

---

## The problem

If four people play FIFA and keep a league table, the table mostly measures who
had the better teams. A 2–1 win with Real Madrid against Celtic says almost
nothing; the same scoreline the other way round says a lot. A plain league
table treats them identically.

The Ladder separates the two with three mechanisms.

### 1. The team handicap

Every rating change is adjusted by the gap between the two teams' release-day
overall ratings, at **20 Elo points per rating point**.

```
Adj_A = Elo_A + 20 × (TeamRating_A − TeamRating_B)
E_A   = 1 / (1 + 10^(−(Adj_A − Elo_B) / 400))
New_Elo_A = Elo_A + K × G × (S_A − E_A)
```

Fielding the stronger side raises your effective rating, so you are *expected*
to win and gain little for doing so — while your opponent gains a lot for
beating you.

A real example from the app, same two players in consecutive legs:

| Leg | Shadow's team | Opponent's team | Expected | Shadow wins |
|---|---|---|---|---|
| 1 | Man City (85) | Brighton (77) | 72% | **+6.8** |
| 2 | Brighton (77) | Man City (85) | 30% | **+16.8** |

Same players, same opponent, both wins — but winning with the weaker side paid
two and a half times more.

### 2. Two-leg fixtures with swapped teams

Every fixture is played twice. In leg 2 the two players swap teams. Over the
pair, team strength cancels out completely, and what is left is skill. The app
enforces the swap: leg 2 must use leg 1's teams reversed, and it checks this in
both directions so the order you enter the legs cannot defeat it.

### 3. Honest uncertainty

Twenty games per pairing is not enough to separate close players, and the app
says so rather than pretending otherwise. The skill ranking carries a 90% range
built by resampling the match log 600 times, and names a leader **only** when
their lowest plausible rating beats everyone else's highest. Until then it says
*"too close to call"* — and it will not crown anyone while a player still has
no matches at all, because beating a placeholder is not evidence.

---

## The two tables

**Tournament table** — the fun one. Win 3, draw 1, loss 0. Tiebreakers in order:
points, goal difference, goals for, head-to-head, Elo.

**Skill ranking** — the real one. Elo with the team handicap, carried across
seasons so the sample keeps growing.

**Head-to-head matrix** — the check on both. It exists to expose *cycles*: if A
beats B, B beats C and C beats A, then no ranking in a straight line is faithful
to what happened, and the app says so explicitly rather than leaving you to
notice.

---

## The rules

These are fixed, not settings. Locking them is what stops arguments.

| Rule | |
|---|---|
| Draws score | 0.5 in Elo, 1 point in the table |
| Extra time and penalties | Recorded as a draw whatever happened; the shoot-out winner is noted for fun only |
| Rage quit | A 3–0 loss for the quitter, unless they were already losing by more |
| Goal margin | Multiplier caps at ×1.75, so one thrashing cannot distort the ladder |
| Team ratings | Locked to release-day values for the whole season |
| Team pools | Drafted before the season, then immutable |
| The match log | Append-only — a correction is a new entry that supersedes an old one, never an edit |

Every rating is **recomputed from the match log** on load. Nothing is stored as
truth except the log itself, which is why a parameter can be retuned
retroactively without touching a single result.

---

## How a match night works

1. **Fixtures** — draw a round. Nobody picks their opponents or their teams.
2. **Play.**
3. **Match entry** — pick the fixture, tap the score. Everything else pre-fills.
   The rating impact appears before anything saves.
4. **Confirm** — hand the phone to your opponent. They see the result and what
   it does to their rating, and tap Confirm. Disputed results are not saved.
5. **Export** at the end of the night, and commit the file.

Entry targets twenty seconds, which is why only the score is typed.

---

## Where the data lives

There is no server and no database. The repository *is* the database.

```
data/teams.json      the team catalogue with locked release-day ratings
data/season-1.json   season config, pools, fixtures and the match log
```

The committed file is the source of truth. The browser keeps a working copy in
`localStorage` as you enter results; **Export** downloads the updated file, and
committing it is what makes the results real for everyone else.

Git history then becomes the dispute record the rules ask for: you cannot
silently edit a past result, and all four players can see every change.

If someone else commits results while you still have unexported entries, the
app notices on load, says so, and keeps both copies. It will not quietly pick
one.

---

## Tuning the handicap

The 20-Elo-per-point conversion is a starting guess, and the **Insights** screen
is where it gets settled. After 40 matches it compares what the model expected
of the stronger-team side against what that side actually scored, sweeps for the
value that best fits the results, and offers to apply it. Applying re-rates the
whole season.

If the handicap is right, win rate by team tier sits near 50% across the board.
A tier consistently above or below is the clearest sign it needs moving.

---

## The screens

| Screen | |
|---|---|
| Dashboard | Both tables, season progress, recent results |
| Match entry | The thirteen inputs, live rating preview, save checks, confirmation |
| Head-to-head | The matrix, cycle detection, every meeting with its Elo swing |
| Insights | Upsets, streaks, win rate by tier, handicap calibration |
| Fixtures | The schedule, the draw, pairing coverage |
| Draft night | Snake draft with tier limits and undo |
| Setup & pools | Parameters, the fixed rules, pools, fairness check |

---

## Running it

```bash
npm install
npm run dev        # local, at http://localhost:5173
npm test           # 326 tests
npm run typecheck
npm run build      # typecheck + production build
```

Pushing to `main` deploys to GitHub Pages. The workflow runs the full test suite
first, so a broken ladder cannot reach the live site.

### Layout

```
src/engine/   pure, dependency-free, fully tested — no UI or storage imports
  elo.ts         rating maths and log replay
  teams.ts       catalogue and tier bands
  season.ts      config, pools, fairness, the season cap
  schedule.ts    round-robin fixture generation
  draft.ts       snake order and pick validation
  match.ts       match records, entry validation, rating preview
  tables.ts      the three tables
  confidence.ts  bootstrap resampling
  insights.ts    upsets, tiers, handicap calibration
  random.ts      seeded RNG — Math.random is never used in the engine
src/store/    load, persist, export, import
src/ui/       screens
```

Every random choice is seeded and reproducible, including the fixture draw and
the confidence bootstrap. A fixture list can be redrawn from its stored seed and
shown to be the one actually generated — which matters for a system whose job is
settling arguments.

---

## Before the season counts

Two things are still open. Both are in
[PLAN.md](PLAN.md#open-questions) in full.

**The team ratings are placeholders.** `data/teams.json` holds the illustrative
ratings from the design mockups, flagged in the app. They must be replaced with
real FC26 release-day values before the draft locks, because the handicap, the
tiers, the fairness check and the calibration all depend on them.

**Pool size.** Ten teams at three uses each gives exactly 30 slots for exactly
30 fixtures — it fits, but with no slack, so every team must be used all three
times and nobody can avoid one they have come to hate. Twelve gives room. The
setup screen flags this until it is decided.

---

## Source documents

- [`fc26-ranking-system-1.md`](fc26-ranking-system-1.md) — the full scope and rules
- [`fc26-ranking-system-app-screens-1.pdf`](fc26-ranking-system-app-screens-1.pdf) — the screen mockups
- [`PLAN.md`](PLAN.md) — build plan, deviations from the documents, open questions,
  and the bugs two code reviews caught
