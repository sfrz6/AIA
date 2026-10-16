import { type Decimal, dec, ZERO, type Numeric } from "./decimal";
import {
  getEventTypeDefinition,
  maxUnitPoints,
  penaltyAttributionOf,
  type EventTypeDefinition,
  type EventTypeKey,
} from "./event-types";
import { calculateTimePenalty, type TimePenaltyResult } from "./penalty";

export interface RiderScoreInput {
  readonly championshipRiderId: string;
  /** 1-based position of the rider inside the scoring unit. */
  readonly positionInUnit: number;
  /**
   * One entry per target the rider attempts in the run. `null` means the
   * referee has not recorded a value yet, or the rider did not present. Both
   * count as zero points, exactly like a blank cell in the workbook.
   */
  readonly targets: readonly (Numeric | null)[];
}

export interface ScoringUnitInput {
  /** 0-based index of the unit inside the country for this run. */
  readonly unitIndex: number;
  readonly championshipCountryId: string;
  /** Shared time for the unit in seconds, or `null` when not recorded yet. */
  readonly timeSeconds: Numeric | null;
  readonly riders: readonly RiderScoreInput[];
}

export interface RunScoringInput {
  readonly eventTypeKey: EventTypeKey;
  readonly timeLimitSeconds: Numeric;
  readonly units: readonly ScoringUnitInput[];
}

export interface RiderRunResult {
  readonly championshipRiderId: string;
  readonly championshipCountryId: string;
  readonly unitIndex: number;
  readonly positionInUnit: number;
  /** Sum of the rider's own targets, before any time penalty. */
  readonly rawPoints: Decimal;
  /**
   * The rider's score after any penalty that is attributed to the rider. For
   * pair, team and relay events this equals `rawPoints`, because the penalty
   * belongs to the country rather than to the rider.
   */
  readonly netPoints: Decimal;
  /** Value this run adds to the rider's individual standings. */
  readonly individualContribution: Decimal;
  /** True when every target has a recorded value. */
  readonly isComplete: boolean;
}

export interface ScoringUnitResult {
  readonly unitIndex: number;
  readonly championshipCountryId: string;
  /** Sum of the raw points of every rider in the unit. */
  readonly rawPoints: Decimal;
  readonly timeSeconds: Decimal | null;
  readonly penalty: Decimal;
  readonly penaltyDetail: TimePenaltyResult | null;
  /** `rawPoints + penalty`, never negative. */
  readonly netPoints: Decimal;
  readonly isComplete: boolean;
}

export interface CountryRunResult {
  readonly championshipCountryId: string;
  /** Sum of the individual contributions of the country's riders. */
  readonly riderPointsTotal: Decimal;
  /** Penalty attributed to the country (pair, team and relay events only). */
  readonly countryPenaltyTotal: Decimal;
  /** `riderPointsTotal + countryPenaltyTotal`. */
  readonly total: Decimal;
}

export interface RunScoringResult {
  readonly eventTypeKey: EventTypeKey;
  readonly definition: EventTypeDefinition;
  readonly units: readonly ScoringUnitResult[];
  readonly riders: readonly RiderRunResult[];
  readonly countries: readonly CountryRunResult[];
  /** True when every unit has a time and every target has a value. */
  readonly isComplete: boolean;
}

function sumTargets(targets: readonly (Numeric | null)[]): {
  total: Decimal;
  isComplete: boolean;
} {
  let total = ZERO;
  let isComplete = true;
  for (const target of targets) {
    if (target === null || target === undefined) {
      isComplete = false;
      continue;
    }
    total = total.plus(dec(target));
  }
  return { total, isComplete };
}

/**
 * Scores one run of one event for every participating country.
 *
 * This is a pure function: it reads only its input and returns a fresh result,
 * so it can be unit tested against the reference workbook without a database.
 */
export function scoreRun(input: RunScoringInput): RunScoringResult {
  const definition = getEventTypeDefinition(input.eventTypeKey);
  const attribution = penaltyAttributionOf(definition.ruleType);
  const unitMaximum = maxUnitPoints(definition);
  const timeLimit = dec(input.timeLimitSeconds);

  const unitResults: ScoringUnitResult[] = [];
  const riderResults: RiderRunResult[] = [];
  const countryRiderPoints = new Map<string, Decimal>();
  const countryPenalties = new Map<string, Decimal>();
  let allComplete = true;

  for (const unit of input.units) {
    const riderRaw = unit.riders.map((rider) => ({
      rider,
      ...sumTargets(rider.targets),
    }));

    const unitRawPoints = riderRaw.reduce((acc, entry) => acc.plus(entry.total), ZERO);
    const targetsComplete = riderRaw.every((entry) => entry.isComplete);
    const hasTime = unit.timeSeconds !== null && unit.timeSeconds !== undefined;
    const unitComplete = targetsComplete && hasTime;
    if (!unitComplete) {
      allComplete = false;
    }

    const penaltyDetail = hasTime
      ? calculateTimePenalty({
          timeSeconds: unit.timeSeconds as Numeric,
          timeLimitSeconds: timeLimit,
          rawPoints: unitRawPoints,
          maxUnitPoints: unitMaximum,
        })
      : null;
    const penalty = penaltyDetail ? penaltyDetail.penalty : ZERO;

    unitResults.push({
      unitIndex: unit.unitIndex,
      championshipCountryId: unit.championshipCountryId,
      rawPoints: unitRawPoints,
      timeSeconds: hasTime ? dec(unit.timeSeconds as Numeric) : null,
      penalty,
      penaltyDetail,
      netPoints: unitRawPoints.plus(penalty),
      isComplete: unitComplete,
    });

    for (const entry of riderRaw) {
      // A rider-attributed penalty belongs to a unit of exactly one rider, so
      // the whole penalty lands on that rider. A country-attributed penalty is
      // kept off the rider and added once to the country total below.
      const riderPenalty = attribution === "RIDER" ? penalty : ZERO;
      const netPoints = entry.total.plus(riderPenalty);

      riderResults.push({
        championshipRiderId: entry.rider.championshipRiderId,
        championshipCountryId: unit.championshipCountryId,
        unitIndex: unit.unitIndex,
        positionInUnit: entry.rider.positionInUnit,
        rawPoints: entry.total,
        netPoints,
        individualContribution: netPoints,
        isComplete: entry.isComplete && (attribution === "COUNTRY" || hasTime),
      });

      countryRiderPoints.set(
        unit.championshipCountryId,
        (countryRiderPoints.get(unit.championshipCountryId) ?? ZERO).plus(netPoints),
      );
    }

    if (attribution === "COUNTRY") {
      countryPenalties.set(
        unit.championshipCountryId,
        (countryPenalties.get(unit.championshipCountryId) ?? ZERO).plus(penalty),
      );
    }
  }

  const countryIds = new Set<string>([...countryRiderPoints.keys(), ...countryPenalties.keys()]);
  const countries: CountryRunResult[] = [...countryIds].map((championshipCountryId) => {
    const riderPointsTotal = countryRiderPoints.get(championshipCountryId) ?? ZERO;
    const countryPenaltyTotal = countryPenalties.get(championshipCountryId) ?? ZERO;
    return {
      championshipCountryId,
      riderPointsTotal,
      countryPenaltyTotal,
      total: riderPointsTotal.plus(countryPenaltyTotal),
    };
  });

  return {
    eventTypeKey: input.eventTypeKey,
    definition,
    units: unitResults,
    riders: riderResults,
    countries,
    isComplete: allComplete && input.units.length > 0,
  };
}

/** Sums several run results into one event result, per rider and per country. */
export interface EventAggregate {
  readonly riderTotals: ReadonlyMap<string, Decimal>;
  readonly countryRiderTotals: ReadonlyMap<string, Decimal>;
  readonly countryPenaltyTotals: ReadonlyMap<string, Decimal>;
}

export function aggregateRuns(results: readonly RunScoringResult[]): EventAggregate {
  const riderTotals = new Map<string, Decimal>();
  const countryRiderTotals = new Map<string, Decimal>();
  const countryPenaltyTotals = new Map<string, Decimal>();

  for (const result of results) {
    for (const rider of result.riders) {
      riderTotals.set(
        rider.championshipRiderId,
        (riderTotals.get(rider.championshipRiderId) ?? ZERO).plus(rider.individualContribution),
      );
    }
    for (const country of result.countries) {
      countryRiderTotals.set(
        country.championshipCountryId,
        (countryRiderTotals.get(country.championshipCountryId) ?? ZERO).plus(
          country.riderPointsTotal,
        ),
      );
      countryPenaltyTotals.set(
        country.championshipCountryId,
        (countryPenaltyTotals.get(country.championshipCountryId) ?? ZERO).plus(
          country.countryPenaltyTotal,
        ),
      );
    }
  }

  return { riderTotals, countryRiderTotals, countryPenaltyTotals };
}
