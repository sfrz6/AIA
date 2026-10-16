import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import {
  championshipCountries,
  championshipDays,
  championshipEvents,
  championshipRiders,
  championshipRuns,
  championshipTemplates,
  championships,
  riders,
  templateDays,
  templateEvents,
  templateRuns,
} from "@/db/schema";
import {
  ACTIVE_RIDERS_PER_COUNTRY,
  RESERVE_RIDERS_PER_COUNTRY,
  type EventTypeKey,
} from "@/domain/scoring/event-types";
import type { Principal } from "@/lib/auth/session";
import { DomainError } from "@/server/actions/result";
import { recordAudit } from "./audit";
import { listRunsInOrder } from "./championships";

export const CHAMPIONSHIP_DAYS = 3;

export interface SquadInput {
  readonly countryId: string;
  readonly riders: ReadonlyArray<{
    readonly riderId: string;
    readonly rosterSlot: "ACTIVE" | "RESERVE";
    /** 1 to 4 for an active rider, null for the reserve. */
    readonly initialOrder: number | null;
  }>;
}

export interface CreateChampionshipInput {
  readonly templateId: string;
  readonly name: string;
  readonly nameAr: string | null;
  readonly startDate: string;
  readonly location: string;
  readonly organizer: string | null;
  readonly squads: readonly SquadInput[];
}

/**
 * Builds a URL safe identity for the public results page.
 *
 * Arabic and other non Latin names collapse to nothing under a strict ASCII
 * filter, so a date based fallback keeps every championship addressable.
 */
export function slugify(name: string, startDate: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return base || `championship-${startDate}`;
}

async function uniqueSlug(tx: Executor, candidate: string): Promise<string> {
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const value = suffix === 0 ? candidate : `${candidate}-${suffix + 1}`;
    const [clash] = await tx
      .select({ id: championships.id })
      .from(championships)
      .where(eq(championships.slug, value))
      .limit(1);
    if (!clash) return value;
  }
  throw new DomainError("Could not create a unique public address for this championship.");
}

/** Adds whole days to a calendar date without crossing a time zone. */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) throw new DomainError("The start date is not valid.", "VALIDATION");
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/**
 * Validates one country's squad.
 *
 * The competition model is four active riders plus one reserve. Active or
 * reserve belongs to the participation, not to the rider, so the same rider can
 * be active here and reserve in the next championship.
 *
 * A squad may also be left completely empty, meaning the riders have not been
 * decided yet. The entry order screen already refuses to prepare a run for a
 * country with an incomplete roster, so an empty squad is safe to store and
 * can be filled in later from the Participants page, any time before that
 * country takes part in a run. A squad that is neither empty nor complete is
 * rejected, because a half picked roster has no sensible meaning.
 */
export function validateSquad(squad: SquadInput): void {
  if (squad.riders.length === 0) return;

  const active = squad.riders.filter((rider) => rider.rosterSlot === "ACTIVE");
  const reserve = squad.riders.filter((rider) => rider.rosterSlot === "RESERVE");

  if (active.length !== ACTIVE_RIDERS_PER_COUNTRY) {
    throw new DomainError(
      `Each country needs exactly ${ACTIVE_RIDERS_PER_COUNTRY} active riders.`,
      "VALIDATION",
    );
  }
  if (reserve.length !== RESERVE_RIDERS_PER_COUNTRY) {
    throw new DomainError(
      `Each country needs exactly ${RESERVE_RIDERS_PER_COUNTRY} reserve rider.`,
      "VALIDATION",
    );
  }

  const orders = new Set<number>();
  for (const rider of active) {
    if (rider.initialOrder === null || rider.initialOrder < 1 || rider.initialOrder > ACTIVE_RIDERS_PER_COUNTRY) {
      throw new DomainError("Each active rider needs a starting position.", "VALIDATION");
    }
    if (orders.has(rider.initialOrder)) {
      throw new DomainError("Two active riders share the same starting position.", "VALIDATION");
    }
    orders.add(rider.initialOrder);
  }
  for (const rider of reserve) {
    if (rider.initialOrder !== null) {
      throw new DomainError("A reserve rider has no starting position.", "VALIDATION");
    }
  }

  const riderIds = new Set(squad.riders.map((rider) => rider.riderId));
  if (riderIds.size !== squad.riders.length) {
    throw new DomainError("A rider appears twice in the same squad.", "VALIDATION");
  }
}

/** Confirms every nominated rider is registered under the country it is entered for. */
async function assertRidersBelongToCountry(tx: Executor, squad: SquadInput): Promise<void> {
  const riderIds = squad.riders.map((rider) => rider.riderId);
  if (riderIds.length === 0) return;

  const rows = await tx
    .select({ id: riders.id })
    .from(riders)
    .where(and(inArray(riders.id, riderIds), eq(riders.countryId, squad.countryId)));

  if (rows.length !== riderIds.length) {
    throw new DomainError(
      "A selected rider is not registered under this country.",
      "VALIDATION",
    );
  }
}

interface TemplateStructure {
  readonly name: string;
  readonly days: ReadonlyArray<{
    dayNumber: number;
    events: ReadonlyArray<{
      eventType: EventTypeKey;
      orderIndex: number;
      runs: ReadonlyArray<{ runNumber: number; pegSizeCm: string; timeLimitSeconds: string }>;
    }>;
  }>;
}

/**
 * Reads a template's structure for copying.
 *
 * The championship gets its own copy of every day, event and run, so editing or
 * archiving the template afterwards can never change a championship that
 * already exists.
 */
async function readTemplateStructure(
  tx: Executor,
  templateId: string,
): Promise<TemplateStructure> {
  const [template] = await tx
    .select({
      id: championshipTemplates.id,
      name: championshipTemplates.name,
      isArchived: championshipTemplates.isArchived,
    })
    .from(championshipTemplates)
    .where(eq(championshipTemplates.id, templateId))
    .limit(1);

  if (!template) throw new DomainError("Template not found.", "NOT_FOUND");
  if (template.isArchived) {
    throw new DomainError("This template is archived and cannot be used.", "CONFLICT");
  }

  const rows = await tx
    .select({
      dayNumber: templateDays.dayNumber,
      eventId: templateEvents.id,
      eventType: templateEvents.eventType,
      orderIndex: templateEvents.orderIndex,
      runNumber: templateRuns.runNumber,
      pegSizeCm: templateRuns.pegSizeCm,
      timeLimitSeconds: templateRuns.timeLimitSeconds,
    })
    .from(templateDays)
    .leftJoin(templateEvents, eq(templateEvents.templateDayId, templateDays.id))
    .leftJoin(templateRuns, eq(templateRuns.templateEventId, templateEvents.id))
    .where(eq(templateDays.templateId, templateId))
    .orderBy(asc(templateDays.dayNumber), asc(templateEvents.orderIndex), asc(templateRuns.runNumber));

  const days = new Map<
    number,
    Map<string, { eventType: EventTypeKey; orderIndex: number; runs: Array<{ runNumber: number; pegSizeCm: string; timeLimitSeconds: string }> }>
  >();

  for (const row of rows) {
    let day = days.get(row.dayNumber);
    if (!day) {
      day = new Map();
      days.set(row.dayNumber, day);
    }
    if (!row.eventId || !row.eventType) continue;

    let event = day.get(row.eventId);
    if (!event) {
      event = {
        eventType: row.eventType as EventTypeKey,
        orderIndex: row.orderIndex ?? 1,
        runs: [],
      };
      day.set(row.eventId, event);
    }
    if (row.runNumber === null || row.pegSizeCm === null || row.timeLimitSeconds === null) continue;
    event.runs.push({
      runNumber: row.runNumber,
      pegSizeCm: row.pegSizeCm,
      timeLimitSeconds: row.timeLimitSeconds,
    });
  }

  const structure: TemplateStructure = {
    name: template.name,
    days: [...days.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([dayNumber, events]) => ({
        dayNumber,
        events: [...events.values()].sort((a, b) => a.orderIndex - b.orderIndex),
      })),
  };

  const eventCount = structure.days.reduce((total, day) => total + day.events.length, 0);
  if (eventCount === 0) {
    throw new DomainError("This template has no events and cannot be used.", "VALIDATION");
  }
  for (const day of structure.days) {
    for (const event of day.events) {
      if (event.runs.length === 0) {
        throw new DomainError("An event in this template has no runs.", "VALIDATION");
      }
    }
  }

  return structure;
}

export async function createChampionshipFromTemplate(
  tx: Executor,
  actor: Principal,
  input: CreateChampionshipInput,
): Promise<{ id: string; slug: string }> {
  if (input.squads.length < 2) {
    throw new DomainError("Select at least two participating countries.", "VALIDATION");
  }

  const countryIds = new Set(input.squads.map((squad) => squad.countryId));
  if (countryIds.size !== input.squads.length) {
    throw new DomainError("A country is selected twice.", "VALIDATION");
  }

  for (const squad of input.squads) {
    validateSquad(squad);
    await assertRidersBelongToCountry(tx, squad);
  }

  const structure = await readTemplateStructure(tx, input.templateId);
  const slug = await uniqueSlug(tx, slugify(input.name, input.startDate));

  const [championship] = await tx
    .insert(championships)
    .values({
      name: input.name,
      nameAr: input.nameAr,
      startDate: input.startDate,
      location: input.location,
      organizer: input.organizer,
      slug,
      status: "DRAFT",
      isPublished: false,
      sourceTemplateId: input.templateId,
      sourceTemplateName: structure.name,
      createdByUserId: actor.userId,
    })
    .returning({ id: championships.id, slug: championships.slug });

  if (!championship) throw new DomainError("The championship could not be created.", "UNEXPECTED");

  for (let dayNumber = 1; dayNumber <= CHAMPIONSHIP_DAYS; dayNumber += 1) {
    const [day] = await tx
      .insert(championshipDays)
      .values({
        championshipId: championship.id,
        dayNumber,
        competitionDate: addDays(input.startDate, dayNumber - 1),
      })
      .returning({ id: championshipDays.id });
    if (!day) throw new DomainError("The championship could not be created.", "UNEXPECTED");

    const templateDay = structure.days.find((entry) => entry.dayNumber === dayNumber);
    if (!templateDay) continue;

    for (const event of templateDay.events) {
      const [created] = await tx
        .insert(championshipEvents)
        .values({
          championshipDayId: day.id,
          eventType: event.eventType,
          orderIndex: event.orderIndex,
        })
        .returning({ id: championshipEvents.id });
      if (!created) throw new DomainError("The championship could not be created.", "UNEXPECTED");

      await tx.insert(championshipRuns).values(
        event.runs.map((run) => ({
          championshipEventId: created.id,
          runNumber: run.runNumber,
          pegSizeCm: run.pegSizeCm,
          timeLimitSeconds: run.timeLimitSeconds,
          status: "ENTRY_ORDER_PENDING" as const,
        })),
      );
    }
  }

  for (const [index, squad] of input.squads.entries()) {
    const [participant] = await tx
      .insert(championshipCountries)
      .values({ championshipId: championship.id, countryId: squad.countryId, orderIndex: index })
      .returning({ id: championshipCountries.id });
    if (!participant) throw new DomainError("The championship could not be created.", "UNEXPECTED");

    if (squad.riders.length > 0) {
      await tx.insert(championshipRiders).values(
        squad.riders.map((rider) => ({
          championshipCountryId: participant.id,
          riderId: rider.riderId,
          rosterSlot: rider.rosterSlot,
          initialOrder: rider.initialOrder,
        })),
      );
    }
  }

  await recordAudit(tx, actor, {
    action: "CHAMPIONSHIP_CREATED",
    entityType: "championship",
    entityId: championship.id,
    championshipId: championship.id,
    after: {
      name: input.name,
      startDate: input.startDate,
      location: input.location,
      organizer: input.organizer,
      template: structure.name,
      countries: input.squads.length,
    },
  });

  return championship;
}

/**
 * Replaces one country's squad.
 *
 * Refused once the country has ridden, because its entry orders and scores
 * reference the participation rows that would be removed.
 */
export async function replaceSquad(
  tx: Executor,
  actor: Principal,
  input: { championshipId: string; championshipCountryId: string; squad: SquadInput },
): Promise<void> {
  validateSquad(input.squad);
  await assertRidersBelongToCountry(tx, input.squad);

  // The correlation is written literally: an interpolated column would render
  // as a bare name and bind to run_scores inside the subquery.
  const [used] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(championshipRiders)
    .where(
      and(
        eq(championshipRiders.championshipCountryId, input.championshipCountryId),
        sql`exists (
          select 1 from run_scores rs
          where rs.championship_rider_id = championship_riders.id
        )`,
      ),
    );

  if ((used?.count ?? 0) > 0) {
    throw new DomainError(
      "This country has already taken part in a run, so its squad can no longer be replaced.",
      "CONFLICT",
    );
  }

  const before = await tx
    .select({
      riderId: championshipRiders.riderId,
      rosterSlot: championshipRiders.rosterSlot,
      initialOrder: championshipRiders.initialOrder,
    })
    .from(championshipRiders)
    .where(eq(championshipRiders.championshipCountryId, input.championshipCountryId));

  await tx
    .delete(championshipRiders)
    .where(eq(championshipRiders.championshipCountryId, input.championshipCountryId));

  if (input.squad.riders.length > 0) {
    await tx.insert(championshipRiders).values(
      input.squad.riders.map((rider) => ({
        championshipCountryId: input.championshipCountryId,
        riderId: rider.riderId,
        rosterSlot: rider.rosterSlot,
        initialOrder: rider.initialOrder,
      })),
    );
  }

  await recordAudit(tx, actor, {
    action: "CHAMPIONSHIP_SQUAD_UPDATED",
    entityType: "championship_country",
    entityId: input.championshipCountryId,
    championshipId: input.championshipId,
    before: { riders: before },
    after: { riders: input.squad.riders },
  });
}

/**
 * Permanently deletes a championship and every record that belongs to it:
 * days, events, runs, scores, entry orders, tie-break rounds, countries and
 * rosters.
 *
 * Runs are deleted first, scoped through the event/day join, which cascades
 * away `run_scores` and `run_entry_order_items` before countries and riders
 * are removed — those two tables are the only ones that `restrict` deleting
 * a rider who has already ridden (see `removeChampionshipCountry`'s guard),
 * so clearing them first means that guard never fires here. Everything else
 * cascades from `championship_countries` or `championships` itself.
 */
export async function deleteChampionship(
  tx: Executor,
  actor: Principal,
  championshipId: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: championships.id, name: championships.name, slug: championships.slug })
    .from(championships)
    .where(eq(championships.id, championshipId))
    .limit(1);
  if (!existing) throw new DomainError("Championship not found.", "NOT_FOUND");

  const events = await tx
    .select({ id: championshipEvents.id })
    .from(championshipEvents)
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(eq(championshipDays.championshipId, championshipId));

  if (events.length > 0) {
    await tx.delete(championshipRuns).where(
      inArray(
        championshipRuns.championshipEventId,
        events.map((event) => event.id),
      ),
    );
  }

  await tx
    .delete(championshipCountries)
    .where(eq(championshipCountries.championshipId, championshipId));

  await tx.delete(championships).where(eq(championships.id, championshipId));

  await recordAudit(tx, actor, {
    action: "CHAMPIONSHIP_DELETED",
    entityType: "championship",
    entityId: existing.id,
    championshipId: existing.id,
    before: { name: existing.name, slug: existing.slug },
  });
}

/**
 * True once the championship's first run has actually started.
 *
 * The country start list is a property of the whole competition, so it stays
 * editable while every run is still in its preparation stages (entry orders
 * pending or ready) and locks the moment the very first run moves to in
 * progress, review or confirmed.
 */
export async function hasChampionshipStarted(championshipId: string): Promise<boolean> {
  const runs = await listRunsInOrder(championshipId);
  const firstRun = runs[0];
  if (!firstRun) return false;
  return firstRun.status !== "ENTRY_ORDER_PENDING" && firstRun.status !== "READY";
}

/**
 * Reorders the countries of a championship, as a start list position (team 1,
 * team 2, ...). Refused once the championship has started, because rearranging
 * the start list after the competition is under way would be misleading.
 *
 * Existing rows are first moved to a disjoint negative range and then to their
 * final positions, because the unique index on (championship, order) is
 * checked on every statement rather than deferred to the end of the
 * transaction, so writing the final values directly could collide with a row
 * that has not moved yet.
 */
export async function reorderChampionshipCountries(
  tx: Executor,
  actor: Principal,
  input: { championshipId: string; orderedChampionshipCountryIds: readonly string[] },
): Promise<void> {
  const existing = await tx
    .select({ id: championshipCountries.id, orderIndex: championshipCountries.orderIndex })
    .from(championshipCountries)
    .where(eq(championshipCountries.championshipId, input.championshipId));

  const existingIds = new Set(existing.map((row) => row.id));
  const requestedIds = input.orderedChampionshipCountryIds;
  if (
    requestedIds.length !== existingIds.size ||
    new Set(requestedIds).size !== requestedIds.length ||
    !requestedIds.every((id) => existingIds.has(id))
  ) {
    throw new DomainError(
      "The list of countries does not match this championship.",
      "VALIDATION",
    );
  }

  if (await hasChampionshipStarted(input.championshipId)) {
    throw new DomainError(
      "The competition has already started, so the country order can no longer be changed.",
      "CONFLICT",
    );
  }

  const before = existing
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((row) => row.id);

  for (const [index, id] of requestedIds.entries()) {
    await tx
      .update(championshipCountries)
      .set({ orderIndex: -(index + 1) })
      .where(eq(championshipCountries.id, id));
  }
  for (const [index, id] of requestedIds.entries()) {
    await tx.update(championshipCountries).set({ orderIndex: index }).where(eq(championshipCountries.id, id));
  }

  await recordAudit(tx, actor, {
    action: "CHAMPIONSHIP_COUNTRIES_REORDERED",
    entityType: "championship",
    entityId: input.championshipId,
    championshipId: input.championshipId,
    before: { order: before },
    after: { order: requestedIds },
  });
}
