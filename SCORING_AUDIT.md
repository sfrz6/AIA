# Scoring audit

This document maps the scoring logic implemented in this application to the
reference Excel workbook supplied with the project, and records every
inconsistency found in that workbook together with how it was resolved.

It is an engineering verification document, not user documentation.

- Reference workbook: `reference/نظام تسجيل النقاط فارغ لبطولة .xlsm` (24 sheets)
- Implementation: `src/domain/scoring/` and `src/domain/results/`
- Parity tests: `tests/time-penalty.parity.test.ts`, `tests/scoring-engine.test.ts`,
  `tests/standings.test.ts`, `tests/results-engine.test.ts`, `tests/entry-order.test.ts`

The workbook is the primary reference for Version 1 scoring. Where a formula is
unambiguous it is reproduced exactly. Where a formula is inconsistent with the
equivalent formula elsewhere in the same workbook, the intended behaviour is
derived from the consistent majority, documented below, and covered by a test.

---

## 1. The workbook at a glance

| Sheet | Role | Implemented as |
| --- | --- | --- |
| `Main Page` | Empty | Not applicable |
| `M. List` | Master list of 20 teams x 5 competitors, championship header, start date | `countries`, `riders`, `championship_riders`, `championships` |
| `IL` | Individual Lance, day 1 | Event type `INDIVIDUAL_LANCE` |
| `PL day 1` | Pair Lance, day 1 | `PAIR_LANCE` |
| `Team day 1` | Team Lance, day 1 | `TEAM_LANCE` |
| `IS` | Individual Sword, day 2 | `INDIVIDUAL_SWORD` |
| `PS day 2` | Pair Sword, day 2 | `PAIR_SWORD` |
| `Team day 2` | Team Sword, day 2 | `TEAM_SWORD` |
| ` Rings Peg Day 3` | Rings and Peg, lance, day 3 | `RINGS_AND_PEG_LANCE` |
| ` Lemon Peg Day 3` | Lemons and Peg, sword, day 3 | `LEMON_AND_PEG_SWORD` |
| `Relay (L)` | Relay Lance, day 3 | `RELAY_LANCE` |
| `Relay (S)` | Relay Sword, day 3 | `RELAY_SWORD` |
| `Ind Result (1..3)` | Individual day totals | `aggregateChampionship`, `RiderTotals.byDay` |
| `T.Team (1..3)` | Country day totals | `aggregateChampionship`, `CountryTotals.byDay` |
| `SUM DAY1..3` | Day standings plus the round of draws | `buildStandings` plus `tie_break_rounds` |
| `T Ind` | Overall individual totals | `RiderTotals.overall` |
| `Team Total` | Overall country totals | `CountryTotals.overall` |
| `SUMMARY` | Final standings plus the round of draws | `buildStandings` plus `tie_break_rounds` |

Every event sheet is laid out as 20 blocks of 5 rows (one block per team, one
row per competitor) followed by a totals row. The hidden column `A` carries an
index used by `VLOOKUP` into `M. List` to resolve the competitor's name.

---

## 2. Raw points

A referee awards one of four values per target. The workbook enforces this with
a list validation on every points column, for example `IL!E6:E10`:

```
"-,0,2,4,6"
```

`-` means the target was not attempted or not recorded. Excel's `SUM` ignores
it, so it behaves as zero in every total.

Implemented as `ALLOWED_TARGET_POINTS = [0, 2, 4, 6]` in
`src/domain/scoring/event-types.ts`, enforced in three places:

1. the referee interface offers exactly those four values plus a clear control,
2. the server action schema accepts only `0 | 2 | 4 | 6 | null`
   (`src/server/actions/runs.ts`),
3. a database check constraint `run_score_targets_points_check` rejects anything
   else, so an invalid value cannot be written even by a direct SQL statement.

A missing value is stored as `NULL` and scored as zero, matching the blank cell.

### Targets per rider per run

| Rule type | Targets | Maximum per rider |
| --- | --- | --- |
| Individual (lance, sword) | 1 | 6 |
| Pair, team, relay | 1 | 6 |
| Rings and Peg, Lemons and Peg | 3 | 18 |

The three target columns of ` Rings Peg Day 3` are `E`, `F`, `G`, summed by
`H6 =SUM(E6:G6)`. ` Lemon Peg Day 3` is identical.

---

## 3. Time penalty

Every event in the workbook uses the same formula, with two constants that
differ per event. Taken verbatim from `IL!G6`:

```
=IF((IF(F6-F$5<=0,0,IF(F6-F$5>12, -6, CEILING(-0.5*(F6-F$5),-0.5))))<(-E6),
    -E6,
    IF(F6-F$5<=0,0,IF(F6-F$5>12, -6, CEILING(-0.5*(F6-F$5),-0.5))))
```

Reading it outwards:

1. `excess = time - limit`, where the limit lives in row 5 of the time column.
2. `excess <= 0` gives no penalty.
3. `excess > capExcess` gives the fixed cap `-capPenalty`.
4. Otherwise `CEILING(-0.5 * excess, -0.5)`. Excel's `CEILING` rounds away from
   zero, so this charges **half a point for every started second** over the
   limit: 0.01 s over costs 0.5, exactly 1.00 s over costs 0.5, 1.01 s costs 1.0.
5. The whole result is then floored at `-rawPoints`, so a penalty can never push
   a score below zero.

### Constants per event

| Event | Time limit | `capExcess` | `capPenalty` | Workbook cells |
| --- | --- | --- | --- | --- |
| Individual Lance | 6.40 s | 12 | 6 | `IL!F5`, `IL!J5` |
| Individual Sword | 6.40 s | 12 | 6 | `IS!F5`, `IS!J5` |
| Pair Lance | 7.00 s | 24 | 12 | `PL day 1!F5`, `!I5` |
| Pair Sword | 7.00 s | 24 | 12 | `PS day 2!F5`, `!I5` |
| Team Lance | 7.00 s | 48 | 24 | `Team day 1!F5`, `!I5`, `!L5` |
| Team Sword | 7.00 s | 48 | 24 | `Team day 2!F5`, `!I5`, `!L5` |
| Rings and Peg | 7.00 s | 43 | 18 | ` Rings Peg Day 3!I5`, `!P5` |
| Lemons and Peg | 7.00 s | 43 | 18 | ` Lemon Peg Day 3!I5`, `!P5` |
| Relay Lance | 10.00 s | 48 | 24 | `Relay (L)!F5`, `!I5` |
| Relay Sword | 10.00 s | 48 | 24 | `Relay (S)!F5`, `!I5` |

`capPenalty` is in every case the maximum score the scoring unit could have
earned: 6 for one rider with one target, 12 for a pair, 24 for a team or relay
of four, and 18 for one rider with three targets. The implementation derives it
rather than hardcoding it:

```ts
maxUnitPoints = 6 * targetsPerRider * ridersPerScoringUnit
```

Time limits are **not** derived. They are stored per run on
`template_runs.time_limit_seconds` and copied to
`championship_runs.time_limit_seconds`, seeded from the table above. A future
championship can use different limits without touching code.

### Implementation

`calculateTimePenalty` in `src/domain/scoring/penalty.ts`:

```
excess   = max(0, time - limit)
penalty  = -min(0.5 * ceil(excess), maxUnitPoints, rawPoints)
```

This is algebraically identical to the workbook formula for every reachable
input, which `tests/time-penalty.parity.test.ts` proves with 1350 fixture rows
generated by a literal transcription of the Excel formula (including the
per-event `capExcess` and `capPenalty` constants) evaluated in exact decimal
arithmetic. See anomaly **A1** for the one place where the two expressions
differ before the zero floor is applied, and why that difference is unreachable.

### Decimal arithmetic

Scoring uses `decimal.js`, never IEEE-754 doubles. This is not a theoretical
concern. In binary floating point:

```
7.4 - 6.4 = 1.0000000000000009
```

`ceil` of that is 2, so a rider exactly 1.00 s over the 6.4 s limit would be
charged 1.0 points instead of 0.5. `tests/scoring-engine.test.ts` pins this
case. Scores and times are stored in PostgreSQL `NUMERIC` columns
(`numeric(4,1)` for points, `numeric(6,2)` for times and limits) and read back
as strings, so no value passes through a double at any point.

---

## 4. Who carries the penalty

This is the single most important structural rule in the workbook, and it is
not uniform across events.

### Individual events, Rings and Peg, Lemons and Peg

The penalty reduces the rider's own score.

- `IL!H6 =E6+G6` (round 1 net), `IL!L6 =I6+K6` (round 2 net),
  `IL!M6 =H6+L6` (event total).
- ` Rings Peg Day 3!K6 =H6+J6`, `!R6 =O6+Q6`, `!S6 =K6+R6`.

So the rider's individual total already includes their own time faults.

### Pair events

The time belongs to the pair, and so does the penalty. `PL day 1!G6`:

```
=IF((...)<(-E6-E7), -(E6+E7), (...))
```

The floor is the **pair's combined points**, not one rider's.

Crucially, the rider's contribution to the individual standings excludes the
pair penalty. `PL day 1!K6 =E6+H6` is the rider's raw points across both rounds,
and that is what `Ind Result (1)!F6` reads. The pair penalty is totalled
separately at `PL day 1!L11 =G11+J11` and is charged to the country.

### Team and relay events

Same structure as pairs, with the whole squad as the unit.

- `Team day 1!N6 =E6+H6+K6` is the rider's raw points across the three runs, and
  that is what `Ind Result (1)!G6` reads.
- `Team day 1!O11 =G11+J11+M11` totals the three run penalties, charged to the
  country.
- `Team day 1!P11 =N11+O11` is the country's net total for the event.

### Pair composition

`PL day 1!G11 =G6+G8`. Only the formulas in the first and third rider rows of
each block feed the total, so the pairs are **entry positions 1 and 2**, and
**3 and 4**. The fifth row is the reserve and is not in a pair.

Implemented in `buildScoringUnits` (`src/domain/entry-order/index.ts`), which
slices the confirmed entry order into units of `ridersPerScoringUnit`. Because
the slice follows the confirmed order, changing a country's entry order before
a pair run changes who rides with whom, exactly as it does on paper.

### Implementation

`penaltyAttributionOf(ruleType)` returns `RIDER` for `INDIVIDUAL` and
`MULTI_TARGET`, and `COUNTRY` for `PAIR`, `TEAM` and `RELAY`. `scoreRun` in
`src/domain/scoring/engine.ts` then produces, per run:

- `RiderRunResult.individualContribution`, net for rider-attributed events and
  raw for country-attributed events,
- `CountryRunResult.countryPenaltyTotal`, zero for rider-attributed events.

---

## 5. Totals

### Individual day totals

| Day | Workbook | Components |
| --- | --- | --- |
| 1 | `Ind Result (1)!J6 =SUM(E6:G6)` | `IL!M` (net) + `PL day 1!K` (raw) + `Team day 1!N` (raw) |
| 2 | `Ind Result (2)!J6 =SUM(E6:G6)` | `IS!M` (net) + `PS day 2!K` (raw) + `Team day 2!N` (raw) |
| 3 | `Ind Result (3)!K6 =SUM(E6:H6)` | ` Rings Peg!S` (net) + ` Lemon Peg!S` (net) + `Relay (L)!K` (raw) + `Relay (S)!K` (raw) |

### Individual overall total

`T Ind!R6 =H6+L6+Q6`, where `H6 =SUM(E6:G6)` is day 1, `L6 =SUM(I6:K6)` is day 2
and `Q6 =SUM(M6:P6)` is day 3. Implemented as `RiderTotals.overall`.

### Country day totals

`T.Team (1)!I6 =E11+H8` where:

- `E11 =SUM(E6:E10)` is the sum of the country's riders' day 1 individual totals,
- `H8 =G6+G8+F8` is the country's total faults for the day, with
  `F8 =VLOOKUP(A11,'Team day 1'!A11:Q125,15,0)` reading `Team day 1!O` (the team
  fault total) and `G8 =VLOOKUP(A11,'PL day 1'!A11:M125,12,0)` reading
  `PL day 1!L` (the pair fault total).

Day 2 is identical against the day 2 sheets. Day 3 is
`T.Team (3)!G6 =E11+F8` with
`F8 =VLOOKUP(...,'Relay (L)'!...,12,0)+VLOOKUP(...,'Relay (S)'!...,12,0)`.
Rings and Peg and Lemons and Peg contribute no country fault, because their
penalties are already inside the riders' individual totals.

Implemented as `CountryTotals.byDay = riderPointsByDay + penaltiesByDay`.

### Country overall total

`Team Total!P6 =H11+O8` where `H11 =SUM(H6:H10)` sums the riders' three-day
totals and `O8 =SUM(I8:N8)` sums six fault columns: pair lance, team lance,
pair sword, team sword, relay lance, relay sword. Implemented as
`CountryTotals.overall = riderPointsOverall + penaltiesOverall`.

### Only confirmed runs count

The workbook has no notion of a confirmed run; a cell counts the moment it is
typed. This application adds one. `loadConfirmedRuns`
(`src/server/services/results.ts`) filters on
`championship_runs.status = 'CONFIRMED'`, and it is the only function that feeds
the results engine. Work in progress therefore cannot reach the internal
standings or the public page.

---

## 6. Ranking

Individuals use `RANK.EQ` descending:

```
Ind Result (1)!K6 =RANK.EQ(J6,(J$6:J$105),0)
SUM DAY1!E6      =RANK.EQ(D6, $D$6:$D$124) + IFERROR(VLOOKUP(B6, $P$6:$X$16, 9, 0) - 1, 0)
T Ind!S6         =RANK.EQ(R6,(R$6:R$105),0)
```

Countries use `RANK` over a union of the 20 totals cells, which is the same
semantics:

```
T.Team (1)!L6   =RANK(I6,(I$6,I$12,I$18,...,I$120),0)
Team Total!Q6   =RANK(P8,(P$6,P$12,...,P$120),0)
```

Both are standard competition ranking: equal totals share the lowest rank and
the following rank is skipped (1, 2, 2, 4). Implemented in
`calculateStandings` (`src/domain/scoring/standings.ts`).

Competitors with no score rank last on zero rather than disappearing, matching
the workbook, where an empty row totals zero and is ranked. The results pages
pass `includeKeys` for this.

---

## 7. Tie-break rounds (the round of draws)

`SUM DAY1`, `SUM DAY2`, `SUM DAY3` and `SUMMARY` each carry two tie-break
blocks, labelled `INDIVIDUALS Round of draws` and `TEAM Round of draws`, ridden
at a **2.5 cm** peg (`SUMMARY!S5`, `SUMMARY!W20`).

### Individual block (`SUMMARY` rows 7 to 18)

| Column | Meaning |
| --- | --- |
| `P` | Competitor name |
| `Q` | Country |
| `R` | The shared rank the tied group holds |
| `S` | Points scored in the draw |
| `T` | Time, limit `T$5 = 6.4` |
| `U` | Time penalty, the standard formula with cap 12 / 6 |
| `V` | `=S+U`, the net draw score |
| `W` | Sort key |
| `X` | Place inside the group |

```
SUMMARY!W7 =IF(R7="", -1, (R7 * 100000) + (N(V7) * 1000) + (20 - N(T7)))
SUMMARY!X7 =IF(W7<0, "", COUNTIFS($R$7:$R$18, R7, $W$7:$W$18, ">" & W7) + 1)
```

The sort key orders by net draw points descending, then by time ascending (the
`20 - time` term). The place is the number of group members that beat the entry,
plus one, so two identical draw results stay tied.

The final rank is then `baseRank + placeInGroup - 1`, via
`+ IFERROR(VLOOKUP(name, tiebreakTable, 9, 0) - 1, 0)`. A competitor absent from
the tie-break table keeps the base rank, because `IFERROR` yields 0.

### Country block (`SUMMARY` rows 22 to 33)

Same shape, with `Q` as the group key, `R` to `U` as the four riders' draw
scores, `V` as their sum, `W` as the country's time (limit `W$21 = 7`), `X` as
the penalty, `Y = V + X`, `Z` the sort key and `AA` the place.

### Implementation

`scoreTieBreakRound` and `calculateStandings` in
`src/domain/scoring/standings.ts` reproduce this exactly: within a tied group,
order by net draw points descending then time ascending, assign consecutive
ranks from the shared base rank, leave identical results tied, and leave a
competitor with no draw result on the base rank.

Rounds are stored, not computed on the fly: `tie_break_rounds`,
`tie_break_entries` and `tie_break_entry_scores`. A round carries its own
`peg_size_cm`, `time_limit_seconds` and `max_points`, seeded from
`TIE_BREAK_DEFAULTS`, so the parameters are auditable data rather than code.
Saving a round is permission gated (`MANAGE_TIE_BREAKS`) and audited with the
complete before and after values, like any other scoring change.

---

## 8. Anomalies found in the workbook

Each entry gives the cells, what is wrong, how the intended behaviour was
derived, and where the resolved behaviour is tested.

### A1. Rings and Peg, Lemons and Peg: cap threshold does not match the cap

**Cells** ` Rings Peg Day 3!J6` and `!Q6`, ` Lemon Peg Day 3!J6` and `!Q6`, and
every filled-down copy.

**What is wrong** The formula caps the penalty at `-18` only once the excess
passes **43** seconds. Every other event's threshold is exactly twice the cap
(12 for 6, 24 for 12, 48 for 24), which would make the threshold 36 here. For an
excess between 36 and 43 seconds the formula therefore computes a penalty
steeper than the stated cap, down to `-21.5`, and then jumps back to `-18`.

**Resolution** The implementation caps at the event maximum, which is `-18` from
36 seconds onward. This is observationally identical to the workbook for every
reachable input: the maximum raw score for the event is 18, and the zero floor
clamps the penalty to `-rawPoints` afterwards, so both readings produce the same
net score for every raw score from 0 to 18. The divergence is unreachable.

**Tested** `tests/time-penalty.parity.test.ts` includes excess values of 35.99,
36, 40, 43, 43.01 for both events at every raw score, asserting parity with the
literal Excel formula. `tests/scoring-engine.test.ts` pins the window explicitly.

### A2. Team Sword: a penalty floored at another team's score

**Cell** `Team day 2!J11`.

```
=IF((IF(I$11-I$5<=0,...))<(-H$11), -H$17, IF(...))
```

**What is wrong** The comparison tests team 1's raw points (`H$11`) but the value
returned is team 3's (`H$17`). When team 1's penalty exceeds its own score, the
sheet substitutes a different team's total. The equivalent cell on `Team day 1`
(`J11`) is correct and uses `-H11` in both places, as do the other 19 blocks on
`Team day 2`.

**Resolution** A copy error. The floor is the scoring unit's own raw points,
which is what the 19 consistent copies and the whole of `Team day 1` do.

**Tested** `tests/scoring-engine.test.ts`, "floors the pair penalty at the pair's
combined points" and "caps the team penalty at twenty four points".

### A3. Team Lance: hardcoded totals

**Cells** `Team day 1!E23 = 24` and `Team day 1!H23 = 20`.

**What is wrong** Team 3's totals row holds typed literals where the other 19
blocks hold `=SUM(E18:E22)` and `=SUM(H18:H22)`. Any score entered for team 3's
riders in runs 1 and 2 is ignored by the team total and by the penalty floor.

**Resolution** Totals are always computed. The application has no cell that can
be overwritten: run totals are derived from the stored target rows on every read.

**Tested** `tests/results-engine.test.ts` asserts country totals are the sum of
the stored rider contributions plus the stored faults.

### A4. Team Sword: stray penalty formulas in rider rows

**Cells** `Team day 2!M18`, `M19`, `M21`, `M22`.

```
=IF(L18-L$5<=0,0,IF(L18-L$5>48, -24, CEILING(-0.5*(L18-L$5),-0.5)))
```

**What is wrong** Two problems. They sit in rider rows rather than a totals row,
and they all read `L18` rather than their own row, so four rider rows display a
penalty copied from one cell. They also omit the zero floor entirely.

**Resolution** Inert: the day 2 country fault total is `O23 =G23+J23+M23`, which
reads only the totals rows, so these cells feed nothing. They are display noise.
The application has one penalty per scoring unit, attached to the unit.

### A5. Team Sword: absolute references that pin one team's time

**Cells** `Team day 2!G23`, `J11`, `J17`, `J23`, `J29`, `M17`, `M23`, `M29`.

**What is wrong** These use fully absolute references such as `F$23-F$5` and
`I$11-I$5` where the surrounding cells use relative ones. Copying any of them to
another block would compute that block's penalty from the pinned team's time.

**Resolution** Fill-down damage, not a rule. Each unit's penalty uses that unit's
own time, which is what the relative majority does.

### A6. Pair sheets: formulas filled into rows that no total reads

**Cells** `PL day 1` and `PS day 2`, columns `G` and `J`, in the second, fourth
and fifth row of every block. For example `PL day 1!G10` floors at `-(E10+E11)`,
where `E11` is the block's **totals** row, not a rider.

**What is wrong** The pair penalty formula was filled down all five rows of each
block, but only rows 1 and 3 are summed (`G11 =G6+G8`). The copies in rows 2, 4
and 5 are meaningless, and the row 5 copy reaches into the totals row.

**Resolution** A pair event has exactly two pairs per country, formed from entry
positions 1 and 2 and positions 3 and 4. `buildScoringUnits` creates exactly two
units, so there is no equivalent of the stray rows.

**Tested** `tests/entry-order.test.ts`, "pairs riders one with two and three with
four" and "follows the confirmed order, so a change of order changes the pairs".

### A7. Country day total reads an empty cell

**Cells** `T.Team (1)!H8` and `T.Team (2)!H8`.

```
=G6+G8+F8
```

**What is wrong** `G6` is empty in every block. The column holds the pair fault
in `G8` and the team fault arrives in `F8`, so `G6` contributes nothing.

**Resolution** Treated as zero, which is what Excel does. The country day fault
is the pair fault plus the team fault. The individual events' penalties are
already inside the riders' day totals and must not be added again.

**Tested** `tests/results-engine.test.ts`, "charges pair and team faults to the
country, never to the rider".

### A8. Individual day results: two reference styles for the same column

**Cells** `Ind Result (1)!G6:G70` use
`INDEX('Team day 1'!$N$4:$N$125, MATCH(C6,'Team day 1'!$C$4:$C$125,0))`, while
`G71:G105` use direct references such as `='Team day 1'!N84`.

**What is wrong** The second form matches by row position instead of by
competitor, so inserting or re-sorting a row on the source sheet silently
attaches one competitor's score to another. The workbook's own macro
(`vbaProject.bin`) sorts each five-row block by column `B`, which is exactly the
operation that would break these references.

**Resolution** The application never matches on names or positions. Every score
row carries `championship_rider_id`, a foreign key to the participation row,
which in turn references the permanent `riders` identity. Re-ordering riders for
a run cannot move a score.

### A9. Scrambled lookup indices

**Cells** The hidden column `A` on most event sheets. For example `IL!A30:A34`
reads `27, 25, 28, 26, 29` where the visible positions are `1..5`;
`PS day 2!A8` and `A9` hold `4` and `3` against visible positions `3` and `4`;
`Relay (L)!A7:A9` hold `4, 3, 2`.

**What is wrong** The index column drives `VLOOKUP` into `M. List`, so these
rows display a different competitor's name from the one the position implies.

**Resolution** Same as A8: the lookup mechanism does not exist in this
application. The mapping from entry position to rider is the confirmed entry
order, stored as `run_entry_order_items` with an explicit position and rider id.

### A10. Team round of draws: three riders instead of four

**Cells** `SUMMARY!V22 =R22+S22+T22+U22` against `V23:V33 =R+S+T`. The same
pattern appears on `SUM DAY1`, `SUM DAY2` and `SUM DAY3`.

**What is wrong** The first row of the block sums four riders' draw scores; every
other row sums three. A team of four is what rides the draw, and the four
columns `R` to `U` exist for exactly that.

**Resolution** Four riders. The country tie-break stores one
`tie_break_entry_scores` row per rider who rode the draw, so the count is data
rather than a formula, and the interface offers the country's four active riders.

### A11. Team round of draws: the time limit slides down the block

**Cells** `SUMMARY!X23` onwards:
`=IF((IF(W23-W22<=0, ...)))`, where `W22` is the **previous country's recorded
time** rather than the limit. Only `X22` reads the header cell `W21 = 7`.

**What is wrong** An unanchored reference. Every country after the first would be
measured against its predecessor's time.

**Resolution** The limit is `W$21 = 7` for every entry. The implementation stores
`tie_break_rounds.time_limit_seconds` once per round and applies it to all
entries.

**Tested** `tests/standings.test.ts`, "scores the round with the standard time
penalty".

### A12. Team round of draws: an individual sized penalty cap

**Cells** `SUMMARY!X22` and its copies, and the same block on `SUM DAY1..3`.

**What is wrong** The cap constants are `12` and `6`, which are the **individual**
values, even though four riders ride the country draw and the main team events
cap at `48` and `24`.

**Resolution** This one is **not** treated as an error. It is consistent across
all four summary sheets and across every row of each block, so it looks
deliberate rather than mis-filled, and inventing a sporting rule is out of scope.
The workbook value is reproduced, with the cap stored per round in
`tie_break_rounds.max_points` and seeded from `TIE_BREAK_DEFAULTS.COUNTRY`
(`src/domain/scoring/event-types.ts`). **If the federation confirms a different
cap for the country round of draws, it is a data change, not a code change.**
This is the one place in the scoring model where the workbook is ambiguous and
the ambiguity is deliberately left visible.

### A13. A dormant ordinal ranking block

**Cells** `Team Total!AO38:AQ52`, outside the print area and not referenced by
any other sheet.

```
AP38 =RANK(AO38,($AO$8:$AO$122),0)+COUNTIF($AO$8:AO38,AO38)-1
AQ38 =RANK(P36,($P$6:$P$124),0)+COUNTIF($P$6:P36,P36)-1
```

**What is wrong** This is a strict ordinal rank that breaks ties by sheet
position: the first tied row listed wins. It also disagrees with itself, since
`AO38 =P36` while the rank range starts at `$AO$8` against `$P$6`.

**Resolution** Not implemented, deliberately. Resolving a tie by storage order is
exactly what must not happen in official results. Ties are either resolved by a
recorded round of draws or reported as ties.

**Tested** `tests/standings.test.ts`, "leaves the tie in place when the tie-break
result is identical" and "reports an unresolved tie".

### A14. A stray formula in a foreign locale

**Cell** `T.Team (1)!AK1`:
`OFFSET($B$1;;;MAX($M$6:$M$125)+4;11)`.

**What is wrong** Semicolon argument separators, so Excel stores it as text, not
a formula. It is a leftover dynamic print range helper.

**Resolution** Ignored. Print layout is handled by dedicated print CSS and a
dedicated route.

### A15. Hidden columns imply a fixed run count

**Cells** `IS` hides columns `H` to `L` (the whole second round); `IL` hides `I`,
`J`, `L`; the day 3 sheets hide several score columns.

**What is wrong** Nothing is wrong, but it encodes one championship's shape into
the sheet: hiding the second round is how that championship recorded a one-round
individual sword event.

**Resolution** Run count, peg size and time limit per run are template data
(`template_runs`), copied into `championship_runs`. Nothing about them is
hardcoded, and a championship created from an edited template is unaffected
because it holds its own copy.

**Tested** The template snapshot behaviour is covered by the end to end suite.

---

## 9. Summary of deliberate differences from the workbook

| Area | Workbook | This application | Why |
| --- | --- | --- | --- |
| Identity | Names resolved by `VLOOKUP` and `INDEX/MATCH` | Foreign keys to a permanent rider registry | Names are not unique, not stable, and break under sorting (A8, A9) |
| Totals | Cells that can be overwritten | Derived from stored scores on every read | A typed-over total is invisible (A3) |
| Official results | Any typed cell counts | Only runs with status `CONFIRMED` | Work in progress must not leak into public results |
| Corrections | Overwrite the cell | Audited revision with before, after, reason, user and time | Official results must be traceable |
| Entry order | A macro that sorts rows in place | An immutable snapshot per run | An earlier run's order must never be rewritten |
| Arithmetic | Excel doubles | `decimal.js` and `NUMERIC` columns | A 1e-16 error changes a penalty by 0.5 points |
| Ties | Partly resolved by row order (A13) | Resolved by a recorded round of draws, or reported as tied | Storage order is not a sporting rule |
| Penalty cap threshold | 43 s for the peg events (A1) | The event maximum, from 36 s | Observationally identical, internally consistent |

---

## 10. How to re-verify

```bash
npm test                      # 1400+ assertions, including the Excel parity suite
npm run test -- time-penalty  # the parity fixtures on their own
```

The parity fixtures in `tests/fixtures/time-penalty.excel.json` are generated
from a literal transcription of the workbook formula. If a scoring constant ever
changes, regenerate them against the new workbook rather than editing the
expected values by hand.
