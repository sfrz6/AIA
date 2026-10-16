import { type Decimal, dec, ZERO, type Numeric } from "./decimal";

export interface TimePenaltyInput {
  /** Recorded time for the scoring unit, in seconds. */
  readonly timeSeconds: Numeric;
  /** Time limit for the run, in seconds. Penalties start past this value. */
  readonly timeLimitSeconds: Numeric;
  /** Raw points the scoring unit actually earned in this run. */
  readonly rawPoints: Numeric;
  /** Highest score the scoring unit could have earned, which is the cap. */
  readonly maxUnitPoints: Numeric;
}

export interface TimePenaltyResult {
  /** Seconds over the limit, zero when the unit finished inside the limit. */
  readonly excessSeconds: Decimal;
  /** Penalty before the cap and the zero floor are applied. Negative or zero. */
  readonly uncappedPenalty: Decimal;
  /** Penalty actually applied. Negative or zero. */
  readonly penalty: Decimal;
  /** True when the event maximum limited the penalty. */
  readonly cappedByEventMaximum: boolean;
  /** True when the zero floor limited the penalty. */
  readonly cappedByZeroFloor: boolean;
}

/**
 * Time penalty for one scoring unit in one run.
 *
 * Workbook rule (identical in every scoring sheet, see SCORING_AUDIT.md):
 *
 *   excess  = time - limit
 *   penalty = 0                                     when excess <= 0
 *           = CEILING(-0.5 * excess, -0.5)          otherwise
 *   penalty = MAX(penalty, -maxUnitPoints)          event cap
 *   penalty = MAX(penalty, -rawPoints)              score may not go negative
 *
 * Excel's CEILING rounds away from zero, so a penalty of half a point is
 * charged for every *started* second over the limit: 0.01 s over costs 0.5,
 * exactly 1.00 s over costs 0.5, and 1.01 s over costs 1.0.
 */
export function calculateTimePenalty(input: TimePenaltyInput): TimePenaltyResult {
  const time = dec(input.timeSeconds);
  const limit = dec(input.timeLimitSeconds);
  const rawPoints = dec(input.rawPoints);
  const maximum = dec(input.maxUnitPoints);

  const rawExcess = time.minus(limit);
  if (rawExcess.lessThanOrEqualTo(0)) {
    return {
      excessSeconds: ZERO,
      uncappedPenalty: ZERO,
      penalty: ZERO,
      cappedByEventMaximum: false,
      cappedByZeroFloor: false,
    };
  }

  // Half a point per started second over the limit.
  const startedSeconds = rawExcess.ceil();
  const uncapped = startedSeconds.times("0.5").negated();

  const cappedByEventMaximum = uncapped.lessThan(maximum.negated());
  const afterEventCap = cappedByEventMaximum ? maximum.negated() : uncapped;

  const cappedByZeroFloor = afterEventCap.lessThan(rawPoints.negated());
  const penalty = cappedByZeroFloor ? rawPoints.negated() : afterEventCap;

  return {
    excessSeconds: rawExcess,
    uncappedPenalty: uncapped,
    penalty,
    cappedByEventMaximum,
    cappedByZeroFloor,
  };
}
