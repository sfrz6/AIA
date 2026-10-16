import { type Decimal, dec, ZERO, type Numeric } from "./decimal";
import { calculateTimePenalty } from "./penalty";

export interface StandingEntryInput {
  /** Stable identity of the competitor or country being ranked. */
  readonly key: string;
  readonly total: Numeric;
}

/**
 * One competitor's or country's result in a tie-break round (the "round of
 * draws" in the reference workbook).
 */
export interface TieBreakEntryInput {
  readonly key: string;
  /** Points scored in the tie-break round, before the time penalty. */
  readonly points: Numeric;
  /** Time recorded in the tie-break round, in seconds. */
  readonly timeSeconds: Numeric;
}

export interface TieBreakRoundInput {
  readonly timeLimitSeconds: Numeric;
  /** Penalty cap for the round, which is also the maximum scoreable points. */
  readonly maxPoints: Numeric;
  readonly entries: readonly TieBreakEntryInput[];
}

export interface TieBreakOutcome {
  readonly key: string;
  readonly points: Decimal;
  readonly timeSeconds: Decimal;
  readonly penalty: Decimal;
  readonly netPoints: Decimal;
  /** 1-based placing inside the tied group. */
  readonly placeInGroup: number;
}

export interface Standing {
  readonly key: string;
  readonly total: Decimal;
  /** Final rank, after any tie-break round has been applied. */
  readonly rank: number;
  /** Rank from the totals alone, before the tie-break round. */
  readonly baseRank: number;
  /** True when other entries share this entry's total. */
  readonly isTiedOnTotal: boolean;
  /**
   * True when this entry still shares its final rank with another entry, that
   * is, the tie is unresolved and a tie-break round is required.
   */
  readonly isTiedAfterTieBreak: boolean;
  readonly tieBreak: TieBreakOutcome | null;
}

function compareTieBreak(a: TieBreakOutcome, b: TieBreakOutcome): number {
  // Higher net points first, then the faster time.
  const byPoints = b.netPoints.comparedTo(a.netPoints);
  if (byPoints !== 0) return byPoints;
  return a.timeSeconds.comparedTo(b.timeSeconds);
}

/**
 * Scores a tie-break round. The round uses the same time penalty rule as the
 * main events: half a point per started second over the limit, capped at the
 * round maximum and never pushing the score below zero.
 */
export function scoreTieBreakRound(
  round: TieBreakRoundInput,
): ReadonlyMap<string, Omit<TieBreakOutcome, "placeInGroup">> {
  const result = new Map<string, Omit<TieBreakOutcome, "placeInGroup">>();
  for (const entry of round.entries) {
    const points = dec(entry.points);
    const timeSeconds = dec(entry.timeSeconds);
    const { penalty } = calculateTimePenalty({
      timeSeconds,
      timeLimitSeconds: round.timeLimitSeconds,
      rawPoints: points,
      maxUnitPoints: round.maxPoints,
    });
    result.set(entry.key, {
      key: entry.key,
      points,
      timeSeconds,
      penalty,
      netPoints: points.plus(penalty),
    });
  }
  return result;
}

export interface StandingsOptions {
  /**
   * Tie-break rounds that apply to these standings. Entries are matched to the
   * tied groups by key. Entries that do not belong to a tied group are ignored.
   */
  readonly tieBreak?: TieBreakRoundInput;
}

/**
 * Ranks entries by total, highest first.
 *
 * Equal totals share the lowest rank and the following rank is skipped, which
 * matches Excel's RANK.EQ used throughout the reference workbook. When a
 * tie-break round is supplied, every tied group is reordered by the tie-break
 * result and the group members receive consecutive ranks starting at the shared
 * base rank. Group members without a tie-break result keep the base rank, so an
 * incomplete tie-break never silently promotes or demotes a competitor.
 */
export function calculateStandings(
  entries: readonly StandingEntryInput[],
  options: StandingsOptions = {},
): readonly Standing[] {
  const prepared = entries.map((entry) => ({ key: entry.key, total: dec(entry.total) }));
  const sorted = [...prepared].sort((a, b) => b.total.comparedTo(a.total));

  const baseRanks = new Map<string, number>();
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    const previous = index > 0 ? sorted[index - 1]! : null;
    const rank =
      previous && previous.total.equals(current.total) ? baseRanks.get(previous.key)! : index + 1;
    baseRanks.set(current.key, rank);
  }

  const groups = new Map<number, string[]>();
  for (const entry of sorted) {
    const rank = baseRanks.get(entry.key)!;
    const bucket = groups.get(rank);
    if (bucket) bucket.push(entry.key);
    else groups.set(rank, [entry.key]);
  }

  const tieBreakScores = options.tieBreak ? scoreTieBreakRound(options.tieBreak) : null;
  const outcomes = new Map<string, TieBreakOutcome>();
  const finalRanks = new Map<string, number>();

  for (const [baseRank, keys] of groups) {
    if (keys.length === 1) {
      finalRanks.set(keys[0]!, baseRank);
      continue;
    }

    const scored = keys
      .map((key) => tieBreakScores?.get(key))
      .filter((value): value is Omit<TieBreakOutcome, "placeInGroup"> => value !== undefined);

    if (scored.length === 0) {
      for (const key of keys) finalRanks.set(key, baseRank);
      continue;
    }

    // Mirrors the workbook's COUNTIFS placing: an entry's place inside the
    // group is the number of group members that beat it, plus one. Entries with
    // an identical tie-break result stay tied.
    for (const entry of scored) {
      const withPlace: TieBreakOutcome = { ...entry, placeInGroup: 1 };
      const betterCount = scored.filter(
        (other) => compareTieBreak({ ...other, placeInGroup: 1 }, withPlace) < 0,
      ).length;
      outcomes.set(entry.key, { ...entry, placeInGroup: betterCount + 1 });
    }

    for (const key of keys) {
      const outcome = outcomes.get(key);
      finalRanks.set(key, outcome ? baseRank + outcome.placeInGroup - 1 : baseRank);
    }
  }

  const rankCounts = new Map<number, number>();
  for (const rank of finalRanks.values()) {
    rankCounts.set(rank, (rankCounts.get(rank) ?? 0) + 1);
  }

  return sorted
    .map<Standing>((entry) => {
      const baseRank = baseRanks.get(entry.key)!;
      const rank = finalRanks.get(entry.key)!;
      return {
        key: entry.key,
        total: entry.total,
        rank,
        baseRank,
        isTiedOnTotal: (groups.get(baseRank)?.length ?? 1) > 1,
        isTiedAfterTieBreak: (rankCounts.get(rank) ?? 1) > 1,
        tieBreak: outcomes.get(entry.key) ?? null,
      };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.total.comparedTo(a.total);
    });
}

/** Sums a list of decimal values, returning zero for an empty list. */
export function sumDecimals(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
}
