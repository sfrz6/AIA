import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  championshipCountries,
  championshipDays,
  championshipEvents,
  championshipRiders,
  championshipRuns,
  countries,
  riders,
  runScoreTargets,
  runScores,
  runScoringUnits,
  tieBreakEntries,
  tieBreakEntryScores,
  tieBreakRounds,
} from "@/db/schema";
import {
  aggregateChampionship,
  type ChampionshipTotals,
  type ConfirmedRun,
  type DayNumber,
  type StandingsScope,
  type StandingsSubject,
} from "@/domain/results";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import type { TieBreakRoundInput } from "@/domain/scoring/standings";
import type { Locale } from "@/lib/i18n/config";

/**
 * Loads every confirmed run of a championship with its recorded values.
 *
 * The status filter is the only thing that makes a run official: work in
 * progress is never visible to the results engine, so an unconfirmed score can
 * never reach the standings or the public page.
 */
export async function loadConfirmedRuns(
  championshipId: string,
): Promise<readonly ConfirmedRun[]> {
  const db = getDb();

  const rows = await db
    .select({
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      timeLimitSeconds: championshipRuns.timeLimitSeconds,
      championshipEventId: championshipEvents.id,
      eventType: championshipEvents.eventType,
      dayNumber: championshipDays.dayNumber,
      unitId: runScoringUnits.id,
      unitIndex: runScoringUnits.unitIndex,
      championshipCountryId: runScoringUnits.championshipCountryId,
      timeSeconds: runScoringUnits.timeSeconds,
      scoreId: runScores.id,
      championshipRiderId: runScores.championshipRiderId,
      positionInUnit: runScores.positionInUnit,
      targetIndex: runScoreTargets.targetIndex,
      points: runScoreTargets.points,
    })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .innerJoin(runScoringUnits, eq(runScoringUnits.runId, championshipRuns.id))
    .innerJoin(runScores, eq(runScores.runScoringUnitId, runScoringUnits.id))
    .innerJoin(runScoreTargets, eq(runScoreTargets.runScoreId, runScores.id))
    .where(
      and(
        eq(championshipDays.championshipId, championshipId),
        eq(championshipRuns.status, "CONFIRMED"),
      ),
    )
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
      asc(runScoringUnits.unitIndex),
      asc(runScores.positionInUnit),
      asc(runScoreTargets.targetIndex),
    );

  const runs = new Map<
    string,
    {
      meta: Omit<ConfirmedRun, "units">;
      units: Map<
        string,
        {
          unitIndex: number;
          championshipCountryId: string;
          timeSeconds: string | null;
          riders: Map<
            string,
            { championshipRiderId: string; positionInUnit: number; targets: (string | null)[] }
          >;
        }
      >;
    }
  >();

  for (const row of rows) {
    let run = runs.get(row.runId);
    if (!run) {
      run = {
        meta: {
          runId: row.runId,
          championshipEventId: row.championshipEventId,
          eventType: row.eventType as EventTypeKey,
          dayNumber: row.dayNumber as DayNumber,
          runNumber: row.runNumber,
          timeLimitSeconds: row.timeLimitSeconds,
        },
        units: new Map(),
      };
      runs.set(row.runId, run);
    }

    let unit = run.units.get(row.unitId);
    if (!unit) {
      unit = {
        unitIndex: row.unitIndex,
        championshipCountryId: row.championshipCountryId,
        timeSeconds: row.timeSeconds,
        riders: new Map(),
      };
      run.units.set(row.unitId, unit);
    }

    let rider = unit.riders.get(row.scoreId);
    if (!rider) {
      rider = {
        championshipRiderId: row.championshipRiderId,
        positionInUnit: row.positionInUnit,
        targets: [],
      };
      unit.riders.set(row.scoreId, rider);
    }

    rider.targets[row.targetIndex] = row.points;
  }

  return [...runs.values()].map((run) => ({
    ...run.meta,
    units: [...run.units.values()].map((unit) => ({
      unitIndex: unit.unitIndex,
      championshipCountryId: unit.championshipCountryId,
      timeSeconds: unit.timeSeconds,
      riders: [...unit.riders.values()].map((rider) => ({
        championshipRiderId: rider.championshipRiderId,
        positionInUnit: rider.positionInUnit,
        targets: rider.targets,
      })),
    })),
  }));
}

export type TieBreakKey = `${StandingsScope}:${StandingsSubject}`;

export interface StoredTieBreakRound extends TieBreakRoundInput {
  readonly id: string;
  readonly scope: StandingsScope;
  readonly subject: StandingsSubject;
  readonly pegSizeCm: string;
}

/**
 * Loads the tie-break rounds recorded for a championship.
 *
 * For a country round the entry's points are the sum of the riders that took
 * part in the draw, which is how the reference workbook totals the team round.
 */
export async function loadTieBreakRounds(
  championshipId: string,
): Promise<ReadonlyMap<TieBreakKey, StoredTieBreakRound>> {
  const db = getDb();

  const rows = await db
    .select({
      roundId: tieBreakRounds.id,
      scope: tieBreakRounds.scope,
      subject: tieBreakRounds.subject,
      pegSizeCm: tieBreakRounds.pegSizeCm,
      timeLimitSeconds: tieBreakRounds.timeLimitSeconds,
      maxPoints: tieBreakRounds.maxPoints,
      entryId: tieBreakEntries.id,
      championshipRiderId: tieBreakEntries.championshipRiderId,
      championshipCountryId: tieBreakEntries.championshipCountryId,
      timeSeconds: tieBreakEntries.timeSeconds,
      scorePoints: tieBreakEntryScores.points,
    })
    .from(tieBreakRounds)
    .leftJoin(tieBreakEntries, eq(tieBreakEntries.tieBreakRoundId, tieBreakRounds.id))
    .leftJoin(tieBreakEntryScores, eq(tieBreakEntryScores.tieBreakEntryId, tieBreakEntries.id))
    .where(eq(tieBreakRounds.championshipId, championshipId));

  const rounds = new Map<
    TieBreakKey,
    {
      base: Omit<StoredTieBreakRound, "entries">;
      entries: Map<string, { key: string; points: number; timeSeconds: string }>;
    }
  >();

  for (const row of rows) {
    const key = `${row.scope}:${row.subject}` as TieBreakKey;
    let round = rounds.get(key);
    if (!round) {
      round = {
        base: {
          id: row.roundId,
          scope: row.scope as StandingsScope,
          subject: row.subject as StandingsSubject,
          pegSizeCm: row.pegSizeCm,
          timeLimitSeconds: row.timeLimitSeconds,
          maxPoints: row.maxPoints,
        },
        entries: new Map(),
      };
      rounds.set(key, round);
    }
    if (!row.entryId) continue;

    const subjectKey = row.championshipRiderId ?? row.championshipCountryId;
    if (!subjectKey || row.timeSeconds === null) continue;

    const existing = round.entries.get(row.entryId);
    const entry = existing ?? { key: subjectKey, points: 0, timeSeconds: row.timeSeconds };
    if (!existing) round.entries.set(row.entryId, entry);
    if (row.scorePoints !== null) entry.points += Number(row.scorePoints);
  }

  const result = new Map<TieBreakKey, StoredTieBreakRound>();
  for (const [key, round] of rounds) {
    result.set(key, {
      ...round.base,
      entries: [...round.entries.values()].map((entry) => ({
        key: entry.key,
        points: entry.points,
        timeSeconds: entry.timeSeconds,
      })),
    });
  }
  return result;
}

export interface DirectoryCountry {
  readonly championshipCountryId: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly countryName: string;
}

export interface DirectoryRider extends DirectoryCountry {
  readonly championshipRiderId: string;
  readonly riderName: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
}

export interface ChampionshipParticipantDirectory {
  readonly riders: ReadonlyMap<string, DirectoryRider>;
  readonly countries: ReadonlyMap<string, DirectoryCountry>;
}

export async function loadParticipantDirectory(
  championshipId: string,
  locale: Locale,
): Promise<ChampionshipParticipantDirectory> {
  const db = getDb();
  const countryName = locale === "ar" ? countries.nameAr : countries.nameEn;

  const rows = await db
    .select({
      championshipRiderId: championshipRiders.id,
      riderName: riders.fullName,
      rosterSlot: championshipRiders.rosterSlot,
      championshipCountryId: championshipCountries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      countryName,
    })
    .from(championshipCountries)
    .innerJoin(countries, eq(countries.id, championshipCountries.countryId))
    .leftJoin(
      championshipRiders,
      eq(championshipRiders.championshipCountryId, championshipCountries.id),
    )
    .leftJoin(riders, eq(riders.id, championshipRiders.riderId))
    .where(eq(championshipCountries.championshipId, championshipId))
    .orderBy(
      asc(championshipCountries.orderIndex),
      asc(championshipRiders.rosterSlot),
      asc(riders.fullName),
    );

  const riderMap = new Map<string, DirectoryRider>();
  const countryMap = new Map<string, DirectoryCountry>();

  for (const row of rows) {
    countryMap.set(row.championshipCountryId, {
      championshipCountryId: row.championshipCountryId,
      iso2: row.iso2,
      iso3: row.iso3,
      countryName: row.countryName,
    });
    if (!row.championshipRiderId || !row.riderName || !row.rosterSlot) continue;
    riderMap.set(row.championshipRiderId, {
      championshipRiderId: row.championshipRiderId,
      riderName: row.riderName,
      rosterSlot: row.rosterSlot,
      championshipCountryId: row.championshipCountryId,
      iso2: row.iso2,
      iso3: row.iso3,
      countryName: row.countryName,
    });
  }

  return { riders: riderMap, countries: countryMap };
}

export interface ChampionshipResults {
  readonly totals: ChampionshipTotals;
  readonly directory: ChampionshipParticipantDirectory;
  readonly tieBreaks: ReadonlyMap<TieBreakKey, StoredTieBreakRound>;
  readonly confirmedRunCount: number;
}

/**
 * Everything the results pages need, derived from confirmed data only.
 *
 * Results are always recomputed from the stored scores rather than cached, so a
 * correction to a confirmed run is reflected everywhere as soon as it commits
 * and no stale ranking number can survive anywhere in the system.
 */
export async function loadChampionshipResults(
  championshipId: string,
  locale: Locale,
): Promise<ChampionshipResults> {
  const [runs, directory, tieBreaks] = await Promise.all([
    loadConfirmedRuns(championshipId),
    loadParticipantDirectory(championshipId, locale),
    loadTieBreakRounds(championshipId),
  ]);

  return {
    totals: aggregateChampionship(runs),
    directory,
    tieBreaks,
    confirmedRunCount: runs.length,
  };
}

/** The most recently confirmed run, used as the "last confirmed" headline. */
export async function getLastConfirmedRun(championshipId: string): Promise<{
  runId: string;
  runNumber: number;
  eventType: EventTypeKey;
  dayNumber: number;
  confirmedAt: Date | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      eventType: championshipEvents.eventType,
      dayNumber: championshipDays.dayNumber,
      confirmedAt: championshipRuns.confirmedAt,
    })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(
      and(
        eq(championshipDays.championshipId, championshipId),
        eq(championshipRuns.status, "CONFIRMED"),
      ),
    )
    .orderBy(desc(championshipRuns.confirmedAt))
    .limit(1);

  if (!row) return null;
  return { ...row, eventType: row.eventType as EventTypeKey };
}

/**
 * The next run due to be scored: the first run in competition order that is
 * not yet confirmed. Shown to the public so a visitor at the competition
 * ground knows what is coming up without asking an official.
 */
export async function getNextRun(championshipId: string): Promise<{
  runId: string;
  runNumber: number;
  eventType: EventTypeKey;
  dayNumber: number;
  pegSizeCm: string;
  timeLimitSeconds: string;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      eventType: championshipEvents.eventType,
      dayNumber: championshipDays.dayNumber,
      pegSizeCm: championshipRuns.pegSizeCm,
      timeLimitSeconds: championshipRuns.timeLimitSeconds,
    })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(
      and(
        eq(championshipDays.championshipId, championshipId),
        sql`${championshipRuns.status} <> 'CONFIRMED'`,
      ),
    )
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
    )
    .limit(1);

  if (!row) return null;
  return { ...row, eventType: row.eventType as EventTypeKey };
}
