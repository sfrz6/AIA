import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  championshipCountries,
  championshipDays,
  championshipEvents,
  championshipRiders,
  championshipRuns,
  championships,
  countries,
  riders,
} from "@/db/schema";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import type { Locale } from "@/lib/i18n/config";

export interface ChampionshipSummary {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly slug: string;
  readonly startDate: string;
  readonly location: string;
  readonly organizer: string | null;
  readonly status: "DRAFT" | "ACTIVE" | "COMPLETED";
  readonly isPublished: boolean;
  readonly countryCount: number;
  readonly confirmedRuns: number;
  readonly totalRuns: number;
}

/*
 * Correlated subqueries are written with literal table names and aliases.
 * Drizzle renders an interpolated column inside a `sql` template as a bare
 * column name, which inside a subquery binds to the subquery's own table and
 * silently returns the wrong count. Spelling the correlation out keeps it
 * unambiguous.
 */
const countryCountExpression = sql<number>`(
  select count(*)::int
  from championship_countries cc
  where cc.championship_id = championships.id
)`;

const runCountExpression = sql<number>`(
  select count(*)::int
  from championship_runs r
  join championship_events e on e.id = r.championship_event_id
  join championship_days d on d.id = e.championship_day_id
  where d.championship_id = championships.id
)`;

const confirmedRunCountExpression = sql<number>`(
  select count(*)::int
  from championship_runs r
  join championship_events e on e.id = r.championship_event_id
  join championship_days d on d.id = e.championship_day_id
  where d.championship_id = championships.id
    and r.status = 'CONFIRMED'
)`;

export async function listChampionships(options: {
  publishedOnly?: boolean;
} = {}): Promise<readonly ChampionshipSummary[]> {
  const db = getDb();
  return db
    .select({
      id: championships.id,
      name: championships.name,
      nameAr: championships.nameAr,
      slug: championships.slug,
      startDate: championships.startDate,
      location: championships.location,
      organizer: championships.organizer,
      status: championships.status,
      isPublished: championships.isPublished,
      countryCount: countryCountExpression,
      confirmedRuns: confirmedRunCountExpression,
      totalRuns: runCountExpression,
    })
    .from(championships)
    .where(options.publishedOnly ? eq(championships.isPublished, true) : undefined)
    .orderBy(desc(championships.startDate), asc(championships.name));
}

export interface ChampionshipDetail extends ChampionshipSummary {
  readonly sourceTemplateName: string | null;
  readonly days: readonly ChampionshipDayDetail[];
}

export interface ChampionshipDayDetail {
  readonly id: string;
  readonly dayNumber: number;
  readonly competitionDate: string;
  readonly events: readonly ChampionshipEventDetail[];
}

export interface ChampionshipEventDetail {
  readonly id: string;
  readonly eventType: EventTypeKey;
  readonly orderIndex: number;
  readonly runs: readonly ChampionshipRunDetail[];
}

export interface ChampionshipRunDetail {
  readonly id: string;
  readonly runNumber: number;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
  readonly status: "ENTRY_ORDER_PENDING" | "READY" | "IN_PROGRESS" | "REVIEW" | "CONFIRMED";
  readonly version: number;
}

/** Full structure of one championship: days, events in order, and their runs. */
export async function getChampionshipDetail(
  championshipId: string,
): Promise<ChampionshipDetail | null> {
  const db = getDb();

  const [row] = await db
    .select({
      id: championships.id,
      name: championships.name,
      nameAr: championships.nameAr,
      slug: championships.slug,
      startDate: championships.startDate,
      location: championships.location,
      organizer: championships.organizer,
      status: championships.status,
      isPublished: championships.isPublished,
      sourceTemplateName: championships.sourceTemplateName,
      countryCount: countryCountExpression,
      confirmedRuns: confirmedRunCountExpression,
      totalRuns: runCountExpression,
    })
    .from(championships)
    .where(eq(championships.id, championshipId))
    .limit(1);

  if (!row) return null;

  const structure = await db
    .select({
      dayId: championshipDays.id,
      dayNumber: championshipDays.dayNumber,
      competitionDate: championshipDays.competitionDate,
      eventId: championshipEvents.id,
      eventType: championshipEvents.eventType,
      orderIndex: championshipEvents.orderIndex,
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      pegSizeCm: championshipRuns.pegSizeCm,
      timeLimitSeconds: championshipRuns.timeLimitSeconds,
      runStatus: championshipRuns.status,
      version: championshipRuns.version,
    })
    .from(championshipDays)
    .leftJoin(championshipEvents, eq(championshipEvents.championshipDayId, championshipDays.id))
    .leftJoin(championshipRuns, eq(championshipRuns.championshipEventId, championshipEvents.id))
    .where(eq(championshipDays.championshipId, championshipId))
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
    );

  const days = new Map<string, { detail: ChampionshipDayDetail; events: Map<string, ChampionshipEventDetail> }>();

  for (const entry of structure) {
    let day = days.get(entry.dayId);
    if (!day) {
      day = {
        detail: {
          id: entry.dayId,
          dayNumber: entry.dayNumber,
          competitionDate: entry.competitionDate,
          events: [],
        },
        events: new Map(),
      };
      days.set(entry.dayId, day);
    }
    if (!entry.eventId) continue;

    let event = day.events.get(entry.eventId);
    if (!event) {
      event = {
        id: entry.eventId,
        eventType: entry.eventType as EventTypeKey,
        orderIndex: entry.orderIndex ?? 0,
        runs: [],
      };
      day.events.set(entry.eventId, event);
    }
    if (!entry.runId) continue;

    (event.runs as ChampionshipRunDetail[]).push({
      id: entry.runId,
      runNumber: entry.runNumber ?? 0,
      pegSizeCm: entry.pegSizeCm ?? "0",
      timeLimitSeconds: entry.timeLimitSeconds ?? "0",
      status: entry.runStatus ?? "ENTRY_ORDER_PENDING",
      version: entry.version ?? 1,
    });
  }

  return {
    ...row,
    days: [...days.values()].map((day) => ({
      ...day.detail,
      events: [...day.events.values()],
    })),
  };
}

export interface ChampionshipCountryRecord {
  readonly championshipCountryId: string;
  readonly countryId: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly name: string;
  /** Start list position (team 1, team 2, ...), 0-based. */
  readonly orderIndex: number;
}

/**
 * A championship's countries, in start list order.
 *
 * This is the order the country was given on the Participants page, not
 * alphabetical, because it drives the display order everywhere countries are
 * listed: entry orders, scoring, round sheets and results.
 */
export async function listChampionshipCountries(
  championshipId: string,
  locale: Locale,
): Promise<readonly ChampionshipCountryRecord[]> {
  const db = getDb();
  const name = locale === "ar" ? countries.nameAr : countries.nameEn;
  return db
    .select({
      championshipCountryId: championshipCountries.id,
      countryId: countries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      name,
      orderIndex: championshipCountries.orderIndex,
    })
    .from(championshipCountries)
    .innerJoin(countries, eq(countries.id, championshipCountries.countryId))
    .where(eq(championshipCountries.championshipId, championshipId))
    .orderBy(asc(championshipCountries.orderIndex));
}

export interface ChampionshipRiderRecord {
  readonly championshipRiderId: string;
  readonly riderId: string;
  readonly fullName: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  readonly initialOrder: number | null;
  readonly championshipCountryId: string;
  readonly countryId: string;
  readonly iso2: string;
  readonly countryName: string;
}

export async function listChampionshipRiders(
  championshipId: string,
  locale: Locale,
): Promise<readonly ChampionshipRiderRecord[]> {
  const db = getDb();
  const countryName = locale === "ar" ? countries.nameAr : countries.nameEn;
  return db
    .select({
      championshipRiderId: championshipRiders.id,
      riderId: riders.id,
      fullName: riders.fullName,
      rosterSlot: championshipRiders.rosterSlot,
      initialOrder: championshipRiders.initialOrder,
      championshipCountryId: championshipCountries.id,
      countryId: countries.id,
      iso2: countries.iso2,
      countryName,
    })
    .from(championshipRiders)
    .innerJoin(
      championshipCountries,
      eq(championshipCountries.id, championshipRiders.championshipCountryId),
    )
    .innerJoin(countries, eq(countries.id, championshipCountries.countryId))
    .innerJoin(riders, eq(riders.id, championshipRiders.riderId))
    .where(eq(championshipCountries.championshipId, championshipId))
    .orderBy(
      asc(championshipCountries.orderIndex),
      asc(championshipRiders.rosterSlot),
      asc(championshipRiders.initialOrder),
    );
}

/** Resolves a run to the championship it belongs to, with its context. */
export interface RunContext {
  readonly runId: string;
  readonly runNumber: number;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
  readonly status: "ENTRY_ORDER_PENDING" | "READY" | "IN_PROGRESS" | "REVIEW" | "CONFIRMED";
  readonly confirmedAt: Date | null;
  readonly version: number;
  readonly eventId: string;
  readonly eventType: EventTypeKey;
  readonly dayNumber: number;
  readonly competitionDate: string;
  readonly championshipId: string;
  readonly championshipName: string;
  readonly championshipLocation: string;
}

export async function getRunContext(runId: string): Promise<RunContext | null> {
  const db = getDb();
  const [row] = await db
    .select({
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      pegSizeCm: championshipRuns.pegSizeCm,
      timeLimitSeconds: championshipRuns.timeLimitSeconds,
      status: championshipRuns.status,
      confirmedAt: championshipRuns.confirmedAt,
      version: championshipRuns.version,
      eventId: championshipEvents.id,
      eventType: championshipEvents.eventType,
      dayNumber: championshipDays.dayNumber,
      competitionDate: championshipDays.competitionDate,
      championshipId: championships.id,
      championshipName: championships.name,
      championshipLocation: championships.location,
    })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .innerJoin(championships, eq(championships.id, championshipDays.championshipId))
    .where(eq(championshipRuns.id, runId))
    .limit(1);

  if (!row) return null;
  return { ...row, eventType: row.eventType as EventTypeKey };
}

/** Runs of a championship in competition order, used for run to run navigation. */
export async function listRunsInOrder(championshipId: string): Promise<
  readonly {
    id: string;
    dayNumber: number;
    orderIndex: number;
    runNumber: number;
    eventType: EventTypeKey;
    status: string;
  }[]
> {
  const db = getDb();
  const rows = await db
    .select({
      id: championshipRuns.id,
      dayNumber: championshipDays.dayNumber,
      orderIndex: championshipEvents.orderIndex,
      runNumber: championshipRuns.runNumber,
      eventType: championshipEvents.eventType,
      status: championshipRuns.status,
    })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(eq(championshipDays.championshipId, championshipId))
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
    );
  return rows.map((row) => ({ ...row, eventType: row.eventType as EventTypeKey }));
}

export async function getChampionshipBySlug(slug: string): Promise<ChampionshipSummary | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: championships.id,
      name: championships.name,
      nameAr: championships.nameAr,
      slug: championships.slug,
      startDate: championships.startDate,
      location: championships.location,
      organizer: championships.organizer,
      status: championships.status,
      isPublished: championships.isPublished,
      countryCount: countryCountExpression,
      confirmedRuns: confirmedRunCountExpression,
      totalRuns: runCountExpression,
    })
    .from(championships)
    .where(and(eq(championships.slug, slug), eq(championships.isPublished, true)))
    .limit(1);
  return row ?? null;
}
