import { and, asc, eq, gt, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import {
  championshipCountries,
  championshipDays,
  championshipEvents,
  championshipRiders,
  championshipRuns,
  championships,
  countries,
  riders,
  runEntryOrderItems,
  runEntryOrders,
  runRevisions,
  runScoreTargets,
  runScores,
  runScoringUnits,
} from "@/db/schema";
import {
  buildScoringUnits,
  inheritedEntryOrder,
  validateEntryOrder,
  type RosterMember,
} from "@/domain/entry-order";
import {
  allowedTargetPoints,
  getEventTypeDefinition,
  RIDERS_PER_COUNTRY_PER_RUN,
  type EventTypeDefinition,
  type EventTypeKey,
} from "@/domain/scoring/event-types";
import { scoreRun, type RunScoringInput, type ScoringUnitInput } from "@/domain/scoring/engine";
import { formatPoints } from "@/domain/scoring/decimal";
import type { Locale } from "@/lib/i18n/config";
import type { Principal } from "@/lib/auth/session";
import { ConcurrencyError, DomainError } from "@/server/actions/result";
import { recordAudit } from "./audit";
import { getRunContext, type RunContext } from "./championships";

export type RunStatus =
  | "ENTRY_ORDER_PENDING"
  | "READY"
  | "IN_PROGRESS"
  | "REVIEW"
  | "CONFIRMED";

/** Statuses in which a run has not actually started yet. */
const RUN_NOT_STARTED: readonly RunStatus[] = ["ENTRY_ORDER_PENDING", "READY"];

/**
 * Whether a run's entry order may still be recorded or changed.
 *
 * Not just before the run starts: a country can be late submitting its final
 * lineup, so the order stays editable through scoring too, right up until the
 * first score is actually saved. Once any time or target has been written,
 * re-materialising the scoring units would discard real data, so the order
 * locks there instead of at the stricter "not started yet" boundary.
 */
async function canEditEntryOrder(tx: Executor, run: { status: RunStatus; runId: string }): Promise<boolean> {
  if (RUN_NOT_STARTED.includes(run.status)) return true;
  if (run.status !== "IN_PROGRESS") return false;
  return !(await hasSavedScores(tx, run.runId));
}

/** True once any time or target has actually been saved for this run. */
async function hasSavedScores(tx: Executor, runId: string): Promise<boolean> {
  const [timedUnit] = await tx
    .select({ id: runScoringUnits.id })
    .from(runScoringUnits)
    .where(and(eq(runScoringUnits.runId, runId), isNotNull(runScoringUnits.timeSeconds)))
    .limit(1);
  if (timedUnit) return true;

  const [scoredTarget] = await tx
    .select({ id: runScoreTargets.id })
    .from(runScoreTargets)
    .innerJoin(runScores, eq(runScores.id, runScoreTargets.runScoreId))
    .where(and(eq(runScores.runId, runId), isNotNull(runScoreTargets.points)))
    .limit(1);
  return scoredTarget !== undefined;
}

export interface RunRosterRider {
  readonly championshipRiderId: string;
  readonly riderId: string;
  readonly fullName: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  readonly initialOrder: number | null;
}

export interface RunCountryEntryOrder {
  readonly championshipCountryId: string;
  readonly countryId: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly countryName: string;
  readonly roster: readonly RunRosterRider[];
  /** Order confirmed for the most recent earlier run, if any. */
  readonly previousOrder: readonly string[];
  /** Order confirmed for this run, empty when the country is not reviewed yet. */
  readonly confirmedOrder: readonly string[];
  readonly decision: "NO_CHANGE" | "CHANGED" | null;
  readonly confirmedByName: string | null;
  readonly confirmedAt: Date | null;
}

export interface RunEntryOrderState {
  readonly run: RunContext;
  readonly countries: readonly RunCountryEntryOrder[];
  readonly confirmedCount: number;
  readonly totalCount: number;
  readonly allConfirmed: boolean;
}

async function loadRoster(
  tx: Executor,
  championshipId: string,
): Promise<Map<string, RunRosterRider[]>> {
  const rows = await tx
    .select({
      championshipCountryId: championshipRiders.championshipCountryId,
      championshipRiderId: championshipRiders.id,
      riderId: riders.id,
      fullName: riders.fullName,
      rosterSlot: championshipRiders.rosterSlot,
      initialOrder: championshipRiders.initialOrder,
    })
    .from(championshipRiders)
    .innerJoin(
      championshipCountries,
      eq(championshipCountries.id, championshipRiders.championshipCountryId),
    )
    .innerJoin(riders, eq(riders.id, championshipRiders.riderId))
    .where(eq(championshipCountries.championshipId, championshipId))
    .orderBy(asc(championshipRiders.rosterSlot), asc(championshipRiders.initialOrder));

  const grouped = new Map<string, RunRosterRider[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.championshipCountryId);
    if (bucket) bucket.push(row);
    else grouped.set(row.championshipCountryId, [row]);
  }
  return grouped;
}

/**
 * The entry order confirmed for each country in the most recent run that comes
 * before `run` in competition order.
 *
 * Earlier runs are never rewritten, so this is a read of history: it answers
 * "what order did this country last ride in", which is what "no change" means.
 */
async function loadPreviousOrders(
  tx: Executor,
  run: RunContext,
): Promise<Map<string, string[]>> {
  const rows = await tx
    .select({
      championshipCountryId: runEntryOrders.championshipCountryId,
      dayNumber: championshipDays.dayNumber,
      orderIndex: championshipEvents.orderIndex,
      runNumber: championshipRuns.runNumber,
      position: runEntryOrderItems.position,
      championshipRiderId: runEntryOrderItems.championshipRiderId,
    })
    .from(runEntryOrders)
    .innerJoin(championshipRuns, eq(championshipRuns.id, runEntryOrders.runId))
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .innerJoin(runEntryOrderItems, eq(runEntryOrderItems.runEntryOrderId, runEntryOrders.id))
    .where(
      and(
        eq(championshipDays.championshipId, run.championshipId),
        or(
          lt(championshipDays.dayNumber, run.dayNumber),
          and(
            eq(championshipDays.dayNumber, run.dayNumber),
            or(
              lt(
                championshipEvents.orderIndex,
                sql`(select ev.order_index from championship_events ev where ev.id = ${run.eventId})`,
              ),
              and(
                eq(
                  championshipEvents.orderIndex,
                  sql`(select ev.order_index from championship_events ev where ev.id = ${run.eventId})`,
                ),
                lt(championshipRuns.runNumber, run.runNumber),
              ),
            ),
          ),
        ),
      ),
    )
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
      asc(runEntryOrderItems.position),
    );

  // Rows arrive oldest first, so each country's later run overwrites the
  // earlier one and the last write wins, which is the most recent order.
  const latest = new Map<string, { key: string; order: string[] }>();
  for (const row of rows) {
    const key = `${row.dayNumber}.${row.orderIndex}.${row.runNumber}`;
    const current = latest.get(row.championshipCountryId);
    if (!current || current.key !== key) {
      latest.set(row.championshipCountryId, { key, order: [row.championshipRiderId] });
    } else {
      current.order.push(row.championshipRiderId);
    }
  }

  const result = new Map<string, string[]>();
  for (const [countryId, value] of latest) result.set(countryId, value.order);
  return result;
}

export async function getRunEntryOrderState(
  runId: string,
  locale: Locale,
): Promise<RunEntryOrderState | null> {
  const db = getDb();
  const run = await getRunContext(runId);
  if (!run) return null;

  const countryName = locale === "ar" ? countries.nameAr : countries.nameEn;

  const participating = await db
    .select({
      championshipCountryId: championshipCountries.id,
      countryId: countries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      countryName,
    })
    .from(championshipCountries)
    .innerJoin(countries, eq(countries.id, championshipCountries.countryId))
    .where(eq(championshipCountries.championshipId, run.championshipId))
    .orderBy(asc(championshipCountries.orderIndex));

  const [rosterByCountry, previousOrders, confirmed] = await Promise.all([
    loadRoster(db, run.championshipId),
    loadPreviousOrders(db, run),
    db
      .select({
        championshipCountryId: runEntryOrders.championshipCountryId,
        decision: runEntryOrders.decision,
        confirmedAt: runEntryOrders.confirmedAt,
        position: runEntryOrderItems.position,
        championshipRiderId: runEntryOrderItems.championshipRiderId,
      })
      .from(runEntryOrders)
      .leftJoin(runEntryOrderItems, eq(runEntryOrderItems.runEntryOrderId, runEntryOrders.id))
      .where(eq(runEntryOrders.runId, runId))
      .orderBy(asc(runEntryOrderItems.position)),
  ]);

  const confirmedByCountry = new Map<
    string,
    { decision: "NO_CHANGE" | "CHANGED"; confirmedAt: Date; order: string[] }
  >();
  for (const row of confirmed) {
    let entry = confirmedByCountry.get(row.championshipCountryId);
    if (!entry) {
      entry = { decision: row.decision, confirmedAt: row.confirmedAt, order: [] };
      confirmedByCountry.set(row.championshipCountryId, entry);
    }
    if (row.championshipRiderId) entry.order.push(row.championshipRiderId);
  }

  const countriesState = participating.map<RunCountryEntryOrder>((country) => {
    const entry = confirmedByCountry.get(country.championshipCountryId);
    return {
      ...country,
      roster: rosterByCountry.get(country.championshipCountryId) ?? [],
      previousOrder: previousOrders.get(country.championshipCountryId) ?? [],
      confirmedOrder: entry?.order ?? [],
      decision: entry?.decision ?? null,
      confirmedByName: null,
      confirmedAt: entry?.confirmedAt ?? null,
    };
  });

  const confirmedCount = countriesState.filter((country) => country.decision !== null).length;

  return {
    run,
    countries: countriesState,
    confirmedCount,
    totalCount: countriesState.length,
    allConfirmed: countriesState.length > 0 && confirmedCount === countriesState.length,
  };
}

export interface EventPrintRun {
  readonly runId: string;
  readonly runNumber: number;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
}

export interface EventPrintState {
  readonly eventId: string;
  readonly eventType: EventTypeKey;
  readonly dayNumber: number;
  readonly competitionDate: string;
  readonly championshipId: string;
  readonly championshipName: string;
  readonly championshipLocation: string;
  readonly championshipOrganizer: string | null;
  readonly runs: readonly EventPrintRun[];
  readonly countries: readonly RunCountryEntryOrder[];
}

/**
 * Everything the referee's printed round sheet needs for one whole event
 * (Individual Lance, Pair Lance, Team Lance, ...), consolidating every run
 * in it onto one sheet.
 *
 * The entry order shown is read from the event's first run only: later runs
 * in the same event no longer carry their own independent order (it is
 * locked once per event, inherited automatically — see
 * `propagateEntryOrderWithinEvent`), so there is exactly one roster to print
 * per country, with a scoring block per run alongside it.
 */
export async function getEventPrintState(
  eventId: string,
  locale: Locale,
): Promise<EventPrintState | null> {
  const db = getDb();

  const [eventRow] = await db
    .select({
      eventId: championshipEvents.id,
      eventType: championshipEvents.eventType,
      dayNumber: championshipDays.dayNumber,
      competitionDate: championshipDays.competitionDate,
      championshipId: championships.id,
      championshipName: championships.name,
      championshipLocation: championships.location,
      championshipOrganizer: championships.organizer,
    })
    .from(championshipEvents)
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .innerJoin(championships, eq(championships.id, championshipDays.championshipId))
    .where(eq(championshipEvents.id, eventId))
    .limit(1);
  if (!eventRow) return null;

  const runs = await db
    .select({
      runId: championshipRuns.id,
      runNumber: championshipRuns.runNumber,
      pegSizeCm: championshipRuns.pegSizeCm,
      timeLimitSeconds: championshipRuns.timeLimitSeconds,
    })
    .from(championshipRuns)
    .where(eq(championshipRuns.championshipEventId, eventId))
    .orderBy(asc(championshipRuns.runNumber));
  if (runs.length === 0) return null;

  const firstRunState = await getRunEntryOrderState(runs[0]!.runId, locale);
  if (!firstRunState) return null;

  return {
    eventId: eventRow.eventId,
    eventType: eventRow.eventType as EventTypeKey,
    dayNumber: eventRow.dayNumber,
    competitionDate: eventRow.competitionDate,
    championshipId: eventRow.championshipId,
    championshipName: eventRow.championshipName,
    championshipLocation: eventRow.championshipLocation,
    championshipOrganizer: eventRow.championshipOrganizer,
    runs,
    countries: firstRunState.countries,
  };
}

export interface EventPrintRiderValue {
  /** Raw points per target, formatted, in the same order as the round sheet's headings. */
  readonly targets: readonly (string | null)[];
  readonly netPoints: string;
}

export interface EventPrintUnitValue {
  readonly timeSeconds: string | null;
  readonly penalty: string;
  /** The unit's own net points — the figure shown for a pair, team or relay, where the penalty belongs to the unit rather than to one rider. */
  readonly netPoints: string;
}

export interface EventPrintRunValues {
  readonly runId: string;
  readonly runNumber: number;
  /** Keyed by championship rider id. */
  readonly ridersById: ReadonlyMap<string, EventPrintRiderValue>;
  /** Keyed by `${championshipCountryId}:${unitIndex}`, matching `scoreRun`'s own unit results. */
  readonly unitsByKey: ReadonlyMap<string, EventPrintUnitValue>;
}

export interface EventResultsPrintState extends EventPrintState {
  readonly runResults: readonly EventPrintRunValues[];
}

/**
 * Same shell as {@link getEventPrintState}, with each run's actual recorded
 * scores attached: the same round sheet layout, filled in rather than blank.
 *
 * Only meant for runs that are already confirmed (the results PDF only
 * offers a day once every run in it is), so every target is expected to have
 * a value; `scoreRun` is still the pure engine used for live scoring, so the
 * fault and net figures shown here are guaranteed to match what was
 * confirmed, not recomputed by a second implementation.
 */
export async function getEventResultsForPrint(
  eventId: string,
  locale: Locale,
): Promise<EventResultsPrintState | null> {
  const state = await getEventPrintState(eventId, locale);
  if (!state) return null;

  const runResults = await Promise.all(
    state.runs.map(async (run): Promise<EventPrintRunValues> => {
      const scoringState = await getRunScoringState(run.runId, locale);
      const countries = scoringState?.countries ?? [];

      const targetsByRiderId = new Map<string, readonly (string | null)[]>();
      for (const country of countries) {
        for (const unit of country.units) {
          for (const rider of unit.riders) {
            targetsByRiderId.set(rider.championshipRiderId, rider.targets);
          }
        }
      }

      const input: RunScoringInput = {
        eventTypeKey: state.eventType,
        timeLimitSeconds: run.timeLimitSeconds,
        units: countries.flatMap((country) =>
          country.units.map((unit) => ({
            unitIndex: unit.unitIndex,
            championshipCountryId: country.championshipCountryId,
            timeSeconds: unit.timeSeconds,
            riders: unit.riders.map((rider) => ({
              championshipRiderId: rider.championshipRiderId,
              positionInUnit: rider.positionInUnit,
              targets: rider.targets,
            })),
          })),
        ),
      };
      const result = scoreRun(input);

      return {
        runId: run.runId,
        runNumber: run.runNumber,
        ridersById: new Map(
          result.riders.map((rider) => [
            rider.championshipRiderId,
            {
              targets: (targetsByRiderId.get(rider.championshipRiderId) ?? []).map((value) =>
                value === null ? null : formatPoints(value),
              ),
              netPoints: formatPoints(rider.netPoints),
            },
          ]),
        ),
        unitsByKey: new Map(
          result.units.map((unit) => [
            `${unit.championshipCountryId}:${unit.unitIndex}`,
            {
              timeSeconds: unit.timeSeconds === null ? null : unit.timeSeconds.toFixed(2),
              penalty: formatPoints(unit.penalty),
              netPoints: formatPoints(unit.netPoints),
            },
          ]),
        ),
      };
    }),
  );

  return { ...state, runResults };
}

/**
 * Records a country's entry order decision for one run and lays out the run's
 * scoring units for that country.
 *
 * The stored order is a historical snapshot. Re-confirming before the run
 * starts replaces it along with the country's empty score rows; once scoring
 * has begun, the order is locked.
 */
export async function confirmCountryEntryOrder(
  tx: Executor,
  actor: Principal,
  input: {
    runId: string;
    championshipCountryId: string;
    decision: "NO_CHANGE" | "CHANGED";
    order?: readonly string[];
  },
  options?: { readonly internal?: boolean },
): Promise<void> {
  const run = await getRunContext(input.runId);
  if (!run) throw new DomainError("Run not found.", "NOT_FOUND");
  if (!(await canEditEntryOrder(tx, run))) {
    throw new DomainError(
      "Scores have already been saved for this run, so its entry order can no longer be changed.",
      "CONFLICT",
    );
  }
  if (!options?.internal && run.runNumber > 1) {
    throw new DomainError(
      "The entry order can only be set once per event, before its first run. Later runs in the same event carry it over automatically.",
      "CONFLICT",
    );
  }

  const [country] = await tx
    .select({ id: championshipCountries.id, championshipId: championshipCountries.championshipId })
    .from(championshipCountries)
    .where(eq(championshipCountries.id, input.championshipCountryId))
    .limit(1);
  if (!country || country.championshipId !== run.championshipId) {
    throw new DomainError("This country does not take part in this championship.", "NOT_FOUND");
  }

  const rosterByCountry = await loadRoster(tx, run.championshipId);
  const roster = rosterByCountry.get(input.championshipCountryId) ?? [];
  const rosterMembers: RosterMember[] = roster.map((member) => ({
    championshipRiderId: member.championshipRiderId,
    rosterSlot: member.rosterSlot,
    initialOrder: member.initialOrder,
  }));

  const previousOrders = await loadPreviousOrders(tx, run);
  const previousOrder = previousOrders.get(input.championshipCountryId) ?? null;

  const order =
    input.decision === "NO_CHANGE"
      ? inheritedEntryOrder(previousOrder, rosterMembers)
      : (input.order ?? []);

  const invalid = validateEntryOrder(rosterMembers, order, RIDERS_PER_COUNTRY_PER_RUN);
  if (invalid) throw new DomainError(invalid.message, "VALIDATION");

  const existing = await tx
    .select({ id: runEntryOrders.id })
    .from(runEntryOrders)
    .where(
      and(
        eq(runEntryOrders.runId, input.runId),
        eq(runEntryOrders.championshipCountryId, input.championshipCountryId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await tx.delete(runEntryOrders).where(eq(runEntryOrders.id, existing[0].id));
  }

  const [created] = await tx
    .insert(runEntryOrders)
    .values({
      runId: input.runId,
      championshipCountryId: input.championshipCountryId,
      decision: input.decision,
      confirmedByUserId: actor.userId,
    })
    .returning({ id: runEntryOrders.id });
  if (!created) throw new DomainError("The entry order could not be saved.", "UNEXPECTED");

  await tx.insert(runEntryOrderItems).values(
    order.map((championshipRiderId, index) => ({
      runEntryOrderId: created.id,
      position: index + 1,
      championshipRiderId,
    })),
  );

  await materialiseCountryScoringUnits(tx, run, input.championshipCountryId, order);

  await recordAudit(tx, actor, {
    action: "ENTRY_ORDER_CONFIRMED",
    entityType: "run_entry_order",
    entityId: created.id,
    championshipId: run.championshipId,
    before: previousOrder ? { order: previousOrder } : null,
    after: { decision: input.decision, order },
  });

  await refreshRunReadiness(tx, run);
  await propagateEntryOrderWithinEvent(tx, actor, run);
}

/**
 * Once every country has confirmed the entry order for an event's first run,
 * the same order is copied into that event's later runs (Run 2, Run 3): a
 * country's lineup can only change once per event, not before every run
 * inside it. A later run that has already started is left alone — its own
 * order was locked in when its scoring began, same as any other run.
 *
 * Re-saving the first run's order (while it is still editable) re-runs this
 * and overwrites the later runs' carried-over order with the new one, the
 * same way a single run's own re-confirmation replaces its prior order.
 */
async function propagateEntryOrderWithinEvent(
  tx: Executor,
  actor: Principal,
  firstRun: RunContext,
): Promise<void> {
  if (firstRun.runNumber !== 1) return;

  const complete = await allCountriesHaveConfirmed(tx, firstRun.championshipId, firstRun.runId);
  if (!complete) return;

  const laterRuns = await tx
    .select({
      id: championshipRuns.id,
      status: championshipRuns.status,
    })
    .from(championshipRuns)
    .where(
      and(
        eq(championshipRuns.championshipEventId, firstRun.eventId),
        gt(championshipRuns.runNumber, 1),
      ),
    )
    .orderBy(asc(championshipRuns.runNumber));

  if (laterRuns.length === 0) return;

  const participatingCountries = await tx
    .select({ id: championshipCountries.id })
    .from(championshipCountries)
    .where(eq(championshipCountries.championshipId, firstRun.championshipId));

  for (const laterRun of laterRuns) {
    if (!(await canEditEntryOrder(tx, { status: laterRun.status, runId: laterRun.id }))) continue;
    for (const country of participatingCountries) {
      await confirmCountryEntryOrder(
        tx,
        actor,
        { runId: laterRun.id, championshipCountryId: country.id, decision: "NO_CHANGE" },
        { internal: true },
      );
    }
  }
}

/**
 * Every run id in the same event as `runId`, including `runId` itself.
 *
 * Confirming a run's entry order can silently change a sibling run's status
 * too (see `propagateEntryOrderWithinEvent`), so a caller revalidating pages
 * after a confirmation needs every sibling's own page, not just the run that
 * was directly confirmed.
 */
export async function listEventRunIds(runId: string): Promise<readonly string[]> {
  const db = getDb();
  const run = await getRunContext(runId);
  if (!run) return [runId];

  const rows = await db
    .select({ id: championshipRuns.id })
    .from(championshipRuns)
    .where(eq(championshipRuns.championshipEventId, run.eventId));

  return rows.map((row) => row.id);
}

/**
 * Creates the empty score rows for one country in one run, from its confirmed
 * entry order. Any previous rows for that country in that run are removed, so
 * re-confirming the order before the run starts leaves no stale scores behind.
 */
async function materialiseCountryScoringUnits(
  tx: Executor,
  run: RunContext,
  championshipCountryId: string,
  order: readonly string[],
): Promise<void> {
  const definition = getEventTypeDefinition(run.eventType);

  await tx
    .delete(runScoringUnits)
    .where(
      and(
        eq(runScoringUnits.runId, run.runId),
        eq(runScoringUnits.championshipCountryId, championshipCountryId),
      ),
    );

  const units = buildScoringUnits(order, definition.ridersPerScoringUnit);

  for (const unit of units) {
    const [createdUnit] = await tx
      .insert(runScoringUnits)
      .values({
        runId: run.runId,
        championshipCountryId,
        unitIndex: unit.unitIndex,
        timeSeconds: null,
      })
      .returning({ id: runScoringUnits.id });
    if (!createdUnit) throw new DomainError("The run could not be prepared.", "UNEXPECTED");

    for (const rider of unit.riders) {
      const [createdScore] = await tx
        .insert(runScores)
        .values({
          runId: run.runId,
          runScoringUnitId: createdUnit.id,
          championshipRiderId: rider.championshipRiderId,
          positionInUnit: rider.positionInUnit,
        })
        .returning({ id: runScores.id });
      if (!createdScore) throw new DomainError("The run could not be prepared.", "UNEXPECTED");

      await tx.insert(runScoreTargets).values(
        Array.from({ length: definition.targetsPerRider }, (_, targetIndex) => ({
          runScoreId: createdScore.id,
          targetIndex,
          points: null,
        })),
      );
    }
  }
}

/**
 * Whether every participating country has recorded an entry order decision.
 *
 * Counted fresh inside the caller's transaction, because this is the condition
 * that actually gates starting a run. The stored status is only a label for the
 * interface: two countries confirming at the same moment each commit without
 * seeing the other, so neither would observe the run becoming complete.
 */
async function allCountriesHaveConfirmed(
  tx: Executor,
  championshipId: string,
  runId: string,
): Promise<boolean> {
  // Literal aliases: Drizzle renders an interpolated column inside a `sql`
  // template as a bare name, which a subquery would resolve against its own
  // table.
  const [counts] = await tx
    .select({
      total: sql<number>`(
        select count(*)::int from championship_countries cc
        where cc.championship_id = ${championshipId}
      )`,
      confirmed: sql<number>`(
        select count(*)::int from run_entry_orders eo
        where eo.run_id = ${runId}
      )`,
    })
    .from(championshipRuns)
    .where(eq(championshipRuns.id, runId));

  const total = counts?.total ?? 0;
  const confirmed = counts?.confirmed ?? 0;
  return total > 0 && confirmed >= total;
}

/** Moves a run between pending and ready as countries are reviewed. */
async function refreshRunReadiness(tx: Executor, run: RunContext): Promise<void> {
  if (!RUN_NOT_STARTED.includes(run.status)) return;

  const complete = await allCountriesHaveConfirmed(tx, run.championshipId, run.runId);
  const nextStatus: RunStatus = complete ? "READY" : "ENTRY_ORDER_PENDING";

  if (nextStatus !== run.status) {
    await tx
      .update(championshipRuns)
      .set({
        status: nextStatus,
        updatedAt: new Date(),
        version: sql`${championshipRuns.version} + 1`,
      })
      .where(eq(championshipRuns.id, run.runId));
  }
}

export interface RunScoringRider {
  readonly runScoreId: string;
  readonly championshipRiderId: string;
  readonly riderName: string;
  readonly positionInUnit: number;
  readonly targets: readonly (string | null)[];
}

export interface RunScoringUnit {
  readonly runScoringUnitId: string;
  readonly championshipCountryId: string;
  readonly unitIndex: number;
  readonly timeSeconds: string | null;
  readonly riders: readonly RunScoringRider[];
}

export interface RunScoringCountry {
  readonly championshipCountryId: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly countryName: string;
  readonly units: readonly RunScoringUnit[];
}

export interface RunScoringState {
  readonly run: RunContext;
  readonly eventType: EventTypeKey;
  readonly countries: readonly RunScoringCountry[];
}

export async function getRunScoringState(
  runId: string,
  locale: Locale,
): Promise<RunScoringState | null> {
  const db = getDb();
  const run = await getRunContext(runId);
  if (!run) return null;

  const countryName = locale === "ar" ? countries.nameAr : countries.nameEn;

  const rows = await db
    .select({
      runScoringUnitId: runScoringUnits.id,
      unitIndex: runScoringUnits.unitIndex,
      timeSeconds: runScoringUnits.timeSeconds,
      championshipCountryId: championshipCountries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      countryName,
      runScoreId: runScores.id,
      championshipRiderId: runScores.championshipRiderId,
      positionInUnit: runScores.positionInUnit,
      riderName: riders.fullName,
      targetIndex: runScoreTargets.targetIndex,
      points: runScoreTargets.points,
    })
    .from(runScoringUnits)
    .innerJoin(
      championshipCountries,
      eq(championshipCountries.id, runScoringUnits.championshipCountryId),
    )
    .innerJoin(countries, eq(countries.id, championshipCountries.countryId))
    .innerJoin(runScores, eq(runScores.runScoringUnitId, runScoringUnits.id))
    .innerJoin(championshipRiders, eq(championshipRiders.id, runScores.championshipRiderId))
    .innerJoin(riders, eq(riders.id, championshipRiders.riderId))
    .innerJoin(runScoreTargets, eq(runScoreTargets.runScoreId, runScores.id))
    .where(eq(runScoringUnits.runId, runId))
    .orderBy(
      asc(championshipCountries.orderIndex),
      asc(runScoringUnits.unitIndex),
      asc(runScores.positionInUnit),
      asc(runScoreTargets.targetIndex),
    );

  const countryMap = new Map<
    string,
    {
      record: Omit<RunScoringCountry, "units">;
      units: Map<string, { unit: Omit<RunScoringUnit, "riders">; riders: Map<string, { rider: Omit<RunScoringRider, "targets">; targets: (string | null)[] }> }>;
    }
  >();

  for (const row of rows) {
    let country = countryMap.get(row.championshipCountryId);
    if (!country) {
      country = {
        record: {
          championshipCountryId: row.championshipCountryId,
          iso2: row.iso2,
          iso3: row.iso3,
          countryName: row.countryName,
        },
        units: new Map(),
      };
      countryMap.set(row.championshipCountryId, country);
    }

    let unit = country.units.get(row.runScoringUnitId);
    if (!unit) {
      unit = {
        unit: {
          runScoringUnitId: row.runScoringUnitId,
          championshipCountryId: row.championshipCountryId,
          unitIndex: row.unitIndex,
          timeSeconds: row.timeSeconds,
        },
        riders: new Map(),
      };
      country.units.set(row.runScoringUnitId, unit);
    }

    let rider = unit.riders.get(row.runScoreId);
    if (!rider) {
      rider = {
        rider: {
          runScoreId: row.runScoreId,
          championshipRiderId: row.championshipRiderId,
          riderName: row.riderName,
          positionInUnit: row.positionInUnit,
        },
        targets: [],
      };
      unit.riders.set(row.runScoreId, rider);
    }

    rider.targets[row.targetIndex] = row.points;
  }

  return {
    run,
    eventType: run.eventType,
    countries: [...countryMap.values()].map((country) => ({
      ...country.record,
      units: [...country.units.values()].map((unit) => ({
        ...unit.unit,
        riders: [...unit.riders.values()].map((rider) => ({
          ...rider.rider,
          targets: rider.targets,
        })),
      })),
    })),
  };
}

export interface RunScorePayload {
  readonly units: ReadonlyArray<{ runScoringUnitId: string; timeSeconds: string | null }>;
  readonly scores: ReadonlyArray<{ runScoreId: string; targets: ReadonlyArray<number | null> }>;
}

function assertValidPayload(payload: RunScorePayload, definition: EventTypeDefinition): void {
  for (const unit of payload.units) {
    if (unit.timeSeconds === null) continue;
    const value = Number(unit.timeSeconds);
    if (!Number.isFinite(value) || value < 0 || value > 9999) {
      throw new DomainError("A recorded time is not valid.", "VALIDATION");
    }
  }
  for (const score of payload.scores) {
    if (score.targets.length !== definition.targetsPerRider) {
      throw new DomainError("A rider has the wrong number of scores for this event.", "VALIDATION");
    }
    for (const [index, target] of score.targets.entries()) {
      if (target === null) continue;
      const allowedPoints = allowedTargetPoints(definition, index);
      if (!(allowedPoints as readonly number[]).includes(target)) {
        const last = allowedPoints[allowedPoints.length - 1];
        const rest = allowedPoints.slice(0, -1).join(", ");
        throw new DomainError(`A score must be ${rest ? `${rest} or ` : ""}${last}.`, "VALIDATION");
      }
    }
  }
}

/**
 * Checks that every identifier in a payload belongs to this run.
 *
 * Identifiers arrive from the browser, so they are never trusted: a unit or
 * score row from another run, or from another championship, is rejected rather
 * than written.
 */
async function assertPayloadBelongsToRun(
  tx: Executor,
  runId: string,
  payload: RunScorePayload,
): Promise<void> {
  const unitIds = payload.units.map((unit) => unit.runScoringUnitId);
  const scoreIds = payload.scores.map((score) => score.runScoreId);

  if (unitIds.length > 0) {
    const found = await tx
      .select({ id: runScoringUnits.id })
      .from(runScoringUnits)
      .where(and(eq(runScoringUnits.runId, runId), inArray(runScoringUnits.id, unitIds)));
    if (found.length !== new Set(unitIds).size) {
      throw new DomainError("This score sheet does not match the run.", "CONFLICT");
    }
  }

  if (scoreIds.length > 0) {
    const found = await tx
      .select({ id: runScores.id })
      .from(runScores)
      .where(and(eq(runScores.runId, runId), inArray(runScores.id, scoreIds)));
    if (found.length !== new Set(scoreIds).size) {
      throw new DomainError("This score sheet does not match the run.", "CONFLICT");
    }
  }
}

async function writePayload(
  tx: Executor,
  runId: string,
  payload: RunScorePayload,
): Promise<void> {
  const now = new Date();

  for (const unit of payload.units) {
    await tx
      .update(runScoringUnits)
      .set({ timeSeconds: unit.timeSeconds, updatedAt: now })
      .where(
        and(eq(runScoringUnits.id, unit.runScoringUnitId), eq(runScoringUnits.runId, runId)),
      );
  }

  for (const score of payload.scores) {
    for (const [targetIndex, points] of score.targets.entries()) {
      await tx
        .update(runScoreTargets)
        .set({ points: points === null ? null : points.toFixed(1) })
        .where(
          and(
            eq(runScoreTargets.runScoreId, score.runScoreId),
            eq(runScoreTargets.targetIndex, targetIndex),
          ),
        );
    }
    await tx.update(runScores).set({ updatedAt: now }).where(eq(runScores.id, score.runScoreId));
  }
}

/** True when every unit has a time and every target has a value. */
export async function isRunComplete(tx: Executor, runId: string): Promise<boolean> {
  const [row] = await tx
    .select({
      missingTimes: sql<number>`(
        select count(*)::int from run_scoring_units u
        where u.run_id = ${runId} and u.time_seconds is null
      )`,
      missingPoints: sql<number>`(
        select count(*)::int
        from run_score_targets t
        join run_scores s on s.id = t.run_score_id
        where s.run_id = ${runId} and t.points is null
      )`,
      unitCount: sql<number>`(
        select count(*)::int from run_scoring_units u where u.run_id = ${runId}
      )`,
    })
    .from(championshipRuns)
    .where(eq(championshipRuns.id, runId));

  if (!row || row.unitCount === 0) return false;
  return row.missingTimes === 0 && row.missingPoints === 0;
}

async function loadRunForUpdate(
  tx: Executor,
  runId: string,
  expectedVersion: number,
): Promise<{ status: RunStatus; version: number; championshipId: string; eventType: EventTypeKey }> {
  const run = await getRunContext(runId);
  if (!run) throw new DomainError("Run not found.", "NOT_FOUND");
  if (run.version !== expectedVersion) throw new ConcurrencyError();
  return {
    status: run.status,
    version: run.version,
    championshipId: run.championshipId,
    eventType: run.eventType,
  };
}

/**
 * Bumps the run's version under the version the caller read.
 *
 * The conditional update is the actual concurrency guard: if another operator
 * committed a change between the read and this write, zero rows match and the
 * transaction is rolled back with a clear conflict message.
 */
async function bumpVersion(
  tx: Executor,
  runId: string,
  expectedVersion: number,
  extra: Partial<{ status: RunStatus; confirmedAt: Date | null; confirmedByUserId: string | null }> = {},
): Promise<void> {
  const updated = await tx
    .update(championshipRuns)
    .set({
      ...extra,
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(eq(championshipRuns.id, runId), eq(championshipRuns.version, expectedVersion)),
    )
    .returning({ id: championshipRuns.id });

  if (updated.length === 0) throw new ConcurrencyError();
}

export async function startRun(
  tx: Executor,
  actor: Principal,
  runId: string,
  expectedVersion: number,
): Promise<void> {
  const run = await loadRunForUpdate(tx, runId, expectedVersion);
  if (!RUN_NOT_STARTED.includes(run.status)) {
    throw new DomainError("This run has already started.", "CONFLICT");
  }
  // Gated on a fresh count rather than on the stored status, so a run whose
  // last two countries were confirmed concurrently can still be started.
  if (!(await allCountriesHaveConfirmed(tx, run.championshipId, runId))) {
    throw new DomainError(
      "Every country must confirm its entry order before the run can start.",
      "CONFLICT",
    );
  }

  await bumpVersion(tx, runId, expectedVersion, { status: "IN_PROGRESS" });
  await recordAudit(tx, actor, {
    action: "RUN_STARTED",
    entityType: "championship_run",
    entityId: runId,
    championshipId: run.championshipId,
    after: { status: "IN_PROGRESS" },
  });
}

export async function saveRunScores(
  tx: Executor,
  actor: Principal,
  input: { runId: string; expectedVersion: number; payload: RunScorePayload },
): Promise<{ complete: boolean; status: RunStatus }> {
  const run = await loadRunForUpdate(tx, input.runId, input.expectedVersion);
  if (run.status !== "IN_PROGRESS" && run.status !== "REVIEW") {
    throw new DomainError(
      "Scores can only be entered while the run is in progress. Use the correction workflow for a confirmed run.",
      "CONFLICT",
    );
  }

  const definition = getEventTypeDefinition(run.eventType);
  assertValidPayload(input.payload, definition);
  await assertPayloadBelongsToRun(tx, input.runId, input.payload);
  await writePayload(tx, input.runId, input.payload);

  const complete = await isRunComplete(tx, input.runId);
  const status: RunStatus = complete ? "REVIEW" : "IN_PROGRESS";
  await bumpVersion(tx, input.runId, input.expectedVersion, { status });

  await recordAudit(tx, actor, {
    action: "RUN_SCORES_SAVED",
    entityType: "championship_run",
    entityId: input.runId,
    championshipId: run.championshipId,
    after: { complete, units: input.payload.units.length, riders: input.payload.scores.length },
  });

  return { complete, status };
}

export async function confirmRun(
  tx: Executor,
  actor: Principal,
  input: { runId: string; expectedVersion: number },
): Promise<void> {
  const run = await loadRunForUpdate(tx, input.runId, input.expectedVersion);
  if (run.status === "CONFIRMED") {
    throw new DomainError("This run is already confirmed.", "CONFLICT");
  }
  if (run.status !== "REVIEW" && run.status !== "IN_PROGRESS") {
    throw new DomainError("This run has not been scored yet.", "CONFLICT");
  }
  if (!(await isRunComplete(tx, input.runId))) {
    throw new DomainError(
      "Enter every score and time before confirming the run.",
      "VALIDATION",
    );
  }

  await bumpVersion(tx, input.runId, input.expectedVersion, {
    status: "CONFIRMED",
    confirmedAt: new Date(),
    confirmedByUserId: actor.userId,
  });

  await recordAudit(tx, actor, {
    action: "RUN_CONFIRMED",
    entityType: "championship_run",
    entityId: input.runId,
    championshipId: run.championshipId,
    after: { status: "CONFIRMED" },
  });
}

/** Snapshot of a run's recorded values, stored on both sides of a correction. */
export interface RunSnapshot {
  readonly units: ReadonlyArray<{
    unitIndex: number;
    championshipCountryId: string;
    timeSeconds: string | null;
    riders: ReadonlyArray<{
      championshipRiderId: string;
      positionInUnit: number;
      targets: readonly (string | null)[];
    }>;
  }>;
}

export async function snapshotRun(tx: Executor, runId: string): Promise<RunSnapshot> {
  const rows = await tx
    .select({
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
    .from(runScoringUnits)
    .innerJoin(runScores, eq(runScores.runScoringUnitId, runScoringUnits.id))
    .innerJoin(runScoreTargets, eq(runScoreTargets.runScoreId, runScores.id))
    .where(eq(runScoringUnits.runId, runId))
    .orderBy(
      asc(runScoringUnits.unitIndex),
      asc(runScores.positionInUnit),
      asc(runScoreTargets.targetIndex),
    );

  const units = new Map<
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
  >();

  for (const row of rows) {
    let unit = units.get(row.unitId);
    if (!unit) {
      unit = {
        unitIndex: row.unitIndex,
        championshipCountryId: row.championshipCountryId,
        timeSeconds: row.timeSeconds,
        riders: new Map(),
      };
      units.set(row.unitId, unit);
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

  return {
    units: [...units.values()].map((unit) => ({
      unitIndex: unit.unitIndex,
      championshipCountryId: unit.championshipCountryId,
      timeSeconds: unit.timeSeconds,
      riders: [...unit.riders.values()],
    })),
  };
}

/**
 * Corrects a run that has already been confirmed.
 *
 * Confirmation is not irreversible, but it is traceable: the complete before
 * and after values, the reason, the user and the time are written as a
 * revision in the same transaction as the change itself. The run stays
 * confirmed, so the standings recompute from the corrected values as soon as
 * the transaction commits.
 */
export async function correctConfirmedRun(
  tx: Executor,
  actor: Principal,
  input: {
    runId: string;
    expectedVersion: number;
    payload: RunScorePayload;
    reason: string;
  },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new DomainError(
      "A reason is required when correcting a confirmed run.",
      "VALIDATION",
      { reason: "A reason is required when correcting a confirmed run." },
    );
  }

  const run = await loadRunForUpdate(tx, input.runId, input.expectedVersion);
  if (run.status !== "CONFIRMED") {
    throw new DomainError("This run is not confirmed, so it does not need a correction.", "CONFLICT");
  }

  const definition = getEventTypeDefinition(run.eventType);
  assertValidPayload(input.payload, definition);
  await assertPayloadBelongsToRun(tx, input.runId, input.payload);

  const before = await snapshotRun(tx, input.runId);
  await writePayload(tx, input.runId, input.payload);
  const after = await snapshotRun(tx, input.runId);

  if (!(await isRunComplete(tx, input.runId))) {
    throw new DomainError(
      "A confirmed run must keep a score and a time for every rider.",
      "VALIDATION",
    );
  }

  const [previous] = await tx
    .select({ maximum: sql<number>`coalesce(max(${runRevisions.revisionNumber}), 0)::int` })
    .from(runRevisions)
    .where(eq(runRevisions.runId, input.runId));

  await tx.insert(runRevisions).values({
    runId: input.runId,
    revisionNumber: (previous?.maximum ?? 0) + 1,
    reason,
    changedByUserId: actor.userId,
    changedByName: actor.name,
    beforeData: before,
    afterData: after,
  });

  await bumpVersion(tx, input.runId, input.expectedVersion);

  await recordAudit(tx, actor, {
    action: "RUN_CORRECTED",
    entityType: "championship_run",
    entityId: input.runId,
    championshipId: run.championshipId,
    reason,
    before,
    after,
  });
}

export interface RunRevisionRecord {
  readonly id: string;
  readonly revisionNumber: number;
  readonly reason: string;
  readonly changedByName: string;
  readonly createdAt: Date;
  readonly beforeData: unknown;
  readonly afterData: unknown;
}

export async function listRunRevisions(runId: string): Promise<readonly RunRevisionRecord[]> {
  return getDb()
    .select({
      id: runRevisions.id,
      revisionNumber: runRevisions.revisionNumber,
      reason: runRevisions.reason,
      changedByName: runRevisions.changedByName,
      createdAt: runRevisions.createdAt,
      beforeData: runRevisions.beforeData,
      afterData: runRevisions.afterData,
    })
    .from(runRevisions)
    .where(eq(runRevisions.runId, runId))
    .orderBy(asc(runRevisions.revisionNumber));
}

/** Loads a run's recorded values in the shape the scoring engine expects. */
export async function loadRunScoringUnits(
  tx: Executor,
  runId: string,
): Promise<readonly ScoringUnitInput[]> {
  const snapshot = await snapshotRun(tx, runId);
  return snapshot.units.map((unit) => ({
    unitIndex: unit.unitIndex,
    championshipCountryId: unit.championshipCountryId,
    timeSeconds: unit.timeSeconds,
    riders: unit.riders.map((rider) => ({
      championshipRiderId: rider.championshipRiderId,
      positionInUnit: rider.positionInUnit,
      targets: rider.targets.map((value) => (value === null ? null : value)),
    })),
  }));
}
