import { type Decimal, ZERO, type Numeric } from "@/domain/scoring/decimal";
import {
  scoreRun,
  type RunScoringInput,
  type RunScoringResult,
  type ScoringUnitInput,
} from "@/domain/scoring/engine";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import {
  calculateStandings,
  type Standing,
  type TieBreakRoundInput,
} from "@/domain/scoring/standings";

export type DayNumber = 1 | 2 | 3;
export type StandingsScope = "DAY_1" | "DAY_2" | "DAY_3" | "OVERALL";
export type StandingsSubject = "INDIVIDUAL" | "COUNTRY";

export function scopeForDay(day: DayNumber): StandingsScope {
  return day === 1 ? "DAY_1" : day === 2 ? "DAY_2" : "DAY_3";
}

export interface ConfirmedRun {
  readonly runId: string;
  readonly championshipEventId: string;
  readonly eventType: EventTypeKey;
  readonly dayNumber: DayNumber;
  readonly runNumber: number;
  readonly timeLimitSeconds: Numeric;
  readonly units: readonly ScoringUnitInput[];
}

export interface RiderTotals {
  readonly championshipRiderId: string;
  readonly championshipCountryId: string;
  /** Points contributed per competition day. */
  readonly byDay: ReadonlyMap<DayNumber, Decimal>;
  /** Points contributed per championship event. */
  readonly byEvent: ReadonlyMap<string, Decimal>;
  readonly overall: Decimal;
}

export interface CountryTotals {
  readonly championshipCountryId: string;
  /** Sum of the country's riders' contributions, per day. */
  readonly riderPointsByDay: ReadonlyMap<DayNumber, Decimal>;
  /** Pair, team and relay time faults charged to the country, per day. */
  readonly penaltiesByDay: ReadonlyMap<DayNumber, Decimal>;
  /** Rider points plus faults, per day. */
  readonly byDay: ReadonlyMap<DayNumber, Decimal>;
  readonly riderPointsOverall: Decimal;
  readonly penaltiesOverall: Decimal;
  readonly overall: Decimal;
}

export interface ChampionshipTotals {
  readonly riders: ReadonlyMap<string, RiderTotals>;
  readonly countries: ReadonlyMap<string, CountryTotals>;
  readonly runResults: ReadonlyMap<string, RunScoringResult>;
  readonly daysWithResults: readonly DayNumber[];
}

const DAYS: readonly DayNumber[] = [1, 2, 3];

function addTo<K>(map: Map<K, Decimal>, key: K, value: Decimal): void {
  map.set(key, (map.get(key) ?? ZERO).plus(value));
}

/**
 * Aggregates every confirmed run of a championship into rider and country
 * totals.
 *
 * Only runs passed in are counted, so the caller decides what is official. The
 * results engine itself never reads unconfirmed work in progress.
 *
 * Individual totals are the sum of each rider's contribution: the net score
 * after their own time penalty for individual, rings and peg, and lemons and
 * peg events, and the raw score for pair, team and relay events, whose penalty
 * belongs to the country. Country totals add the country's riders' points to
 * the pair, team and relay faults. This mirrors the reference workbook, where
 * the team sheets add the individual day totals to the pair and team fault
 * columns.
 */
export function aggregateChampionship(runs: readonly ConfirmedRun[]): ChampionshipTotals {
  const runResults = new Map<string, RunScoringResult>();

  const riderByDay = new Map<string, Map<DayNumber, Decimal>>();
  const riderByEvent = new Map<string, Map<string, Decimal>>();
  const riderCountry = new Map<string, string>();

  const countryRiderPointsByDay = new Map<string, Map<DayNumber, Decimal>>();
  const countryPenaltiesByDay = new Map<string, Map<DayNumber, Decimal>>();
  const daysSeen = new Set<DayNumber>();

  for (const run of runs) {
    const input: RunScoringInput = {
      eventTypeKey: run.eventType,
      timeLimitSeconds: run.timeLimitSeconds,
      units: run.units,
    };
    const result = scoreRun(input);
    runResults.set(run.runId, result);
    daysSeen.add(run.dayNumber);

    for (const rider of result.riders) {
      riderCountry.set(rider.championshipRiderId, rider.championshipCountryId);

      let days = riderByDay.get(rider.championshipRiderId);
      if (!days) {
        days = new Map();
        riderByDay.set(rider.championshipRiderId, days);
      }
      addTo(days, run.dayNumber, rider.individualContribution);

      let events = riderByEvent.get(rider.championshipRiderId);
      if (!events) {
        events = new Map();
        riderByEvent.set(rider.championshipRiderId, events);
      }
      addTo(events, run.championshipEventId, rider.individualContribution);
    }

    for (const country of result.countries) {
      let points = countryRiderPointsByDay.get(country.championshipCountryId);
      if (!points) {
        points = new Map();
        countryRiderPointsByDay.set(country.championshipCountryId, points);
      }
      addTo(points, run.dayNumber, country.riderPointsTotal);

      let penalties = countryPenaltiesByDay.get(country.championshipCountryId);
      if (!penalties) {
        penalties = new Map();
        countryPenaltiesByDay.set(country.championshipCountryId, penalties);
      }
      addTo(penalties, run.dayNumber, country.countryPenaltyTotal);
    }
  }

  const riders = new Map<string, RiderTotals>();
  for (const [championshipRiderId, byDay] of riderByDay) {
    let overall = ZERO;
    for (const value of byDay.values()) overall = overall.plus(value);
    riders.set(championshipRiderId, {
      championshipRiderId,
      championshipCountryId: riderCountry.get(championshipRiderId) ?? "",
      byDay,
      byEvent: riderByEvent.get(championshipRiderId) ?? new Map(),
      overall,
    });
  }

  const countries = new Map<string, CountryTotals>();
  const countryIds = new Set([
    ...countryRiderPointsByDay.keys(),
    ...countryPenaltiesByDay.keys(),
  ]);
  for (const championshipCountryId of countryIds) {
    const riderPointsByDay = countryRiderPointsByDay.get(championshipCountryId) ?? new Map();
    const penaltiesByDay = countryPenaltiesByDay.get(championshipCountryId) ?? new Map();
    const byDay = new Map<DayNumber, Decimal>();
    let riderPointsOverall = ZERO;
    let penaltiesOverall = ZERO;

    for (const day of DAYS) {
      const points = riderPointsByDay.get(day) ?? ZERO;
      const penalty = penaltiesByDay.get(day) ?? ZERO;
      if (!riderPointsByDay.has(day) && !penaltiesByDay.has(day)) continue;
      byDay.set(day, points.plus(penalty));
      riderPointsOverall = riderPointsOverall.plus(points);
      penaltiesOverall = penaltiesOverall.plus(penalty);
    }

    countries.set(championshipCountryId, {
      championshipCountryId,
      riderPointsByDay,
      penaltiesByDay,
      byDay,
      riderPointsOverall,
      penaltiesOverall,
      overall: riderPointsOverall.plus(penaltiesOverall),
    });
  }

  return {
    riders,
    countries,
    runResults,
    daysWithResults: DAYS.filter((day) => daysSeen.has(day)),
  };
}

export interface StandingsRequest {
  readonly scope: StandingsScope;
  readonly subject: StandingsSubject;
  readonly tieBreak?: TieBreakRoundInput;
  /**
   * Competitors or countries that take part but have not scored yet. They are
   * ranked on zero rather than disappearing from the table.
   */
  readonly includeKeys?: readonly string[];
}

/** Builds one set of standings from aggregated totals. */
export function buildStandings(
  totals: ChampionshipTotals,
  request: StandingsRequest,
): readonly Standing[] {
  const day =
    request.scope === "OVERALL" ? null : (Number(request.scope.slice(-1)) as DayNumber);

  const entries = new Map<string, Decimal>();

  if (request.subject === "INDIVIDUAL") {
    for (const [key, rider] of totals.riders) {
      entries.set(key, day === null ? rider.overall : (rider.byDay.get(day) ?? ZERO));
    }
  } else {
    for (const [key, country] of totals.countries) {
      entries.set(key, day === null ? country.overall : (country.byDay.get(day) ?? ZERO));
    }
  }

  for (const key of request.includeKeys ?? []) {
    if (!entries.has(key)) entries.set(key, ZERO);
  }

  return calculateStandings(
    [...entries].map(([key, total]) => ({ key, total })),
    request.tieBreak ? { tieBreak: request.tieBreak } : {},
  );
}
