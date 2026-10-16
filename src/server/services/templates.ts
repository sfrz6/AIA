import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "@/db";
import {
  championshipTemplates,
  templateDays,
  templateEvents,
  templateRuns,
} from "@/db/schema";
import { EVENT_TYPE_KEYS, type EventTypeKey } from "@/domain/scoring/event-types";
import { DomainError } from "@/server/actions/result";

/** A championship always spans exactly these three competition days. */
export const TEMPLATE_DAY_NUMBERS = [1, 2, 3] as const;

export const MAX_TEMPLATE_NAME_LENGTH = 120;
export const MAX_TEMPLATE_DESCRIPTION_LENGTH = 500;

export interface TemplateSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly eventCount: number;
  readonly runCount: number;
  /** Championships created from this template, counted for provenance only. */
  readonly championshipCount: number;
}

export interface TemplateRunDetail {
  readonly id: string;
  readonly runNumber: number;
  /** Peg size in centimetres, as stored: a fixed point decimal string. */
  readonly pegSizeCm: string;
  /** Seconds allowed before the penalty starts, as stored. */
  readonly timeLimitSeconds: string;
}

export interface TemplateEventDetail {
  readonly id: string;
  readonly eventType: EventTypeKey;
  readonly orderIndex: number;
  readonly runs: readonly TemplateRunDetail[];
}

export interface TemplateDayDetail {
  /** Null only for a day that holds no events and was never stored. */
  readonly id: string | null;
  readonly dayNumber: number;
  readonly events: readonly TemplateEventDetail[];
}

export interface TemplateDetail {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isArchived: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Always the three competition days, in order, however sparse the structure. */
  readonly days: readonly TemplateDayDetail[];
}

/*
 * Correlated subqueries are written with literal table names and aliases.
 * Drizzle renders an interpolated column inside a `sql` template as a bare
 * column name, which inside a subquery binds to the subquery's own table: the
 * correlation is then either ambiguous or silently wrong.
 */
const eventCountExpression = sql<number>`(
  select count(*)::int
  from template_events e
  join template_days d on d.id = e.template_day_id
  where d.template_id = championship_templates.id
)`;

const runCountExpression = sql<number>`(
  select count(*)::int
  from template_runs r
  join template_events e on e.id = r.template_event_id
  join template_days d on d.id = e.template_day_id
  where d.template_id = championship_templates.id
)`;

const championshipCountExpression = sql<number>`(
  select count(*)::int
  from championships c
  where c.source_template_id = championship_templates.id
)`;

/** Templates with the size of their structure and how often they were used. */
export async function listTemplates(
  options: { includeArchived?: boolean } = {},
): Promise<readonly TemplateSummary[]> {
  const db = getDb();
  return db
    .select({
      id: championshipTemplates.id,
      name: championshipTemplates.name,
      description: championshipTemplates.description,
      isArchived: championshipTemplates.isArchived,
      createdAt: championshipTemplates.createdAt,
      eventCount: eventCountExpression,
      runCount: runCountExpression,
      championshipCount: championshipCountExpression,
    })
    .from(championshipTemplates)
    .where(options.includeArchived ? undefined : eq(championshipTemplates.isArchived, false))
    .orderBy(asc(championshipTemplates.isArchived), asc(championshipTemplates.name));
}

interface StructureRow {
  readonly dayId: string;
  readonly dayNumber: number;
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly orderIndex: number | null;
  readonly runId: string | null;
  readonly runNumber: number | null;
  readonly pegSizeCm: string | null;
  readonly timeLimitSeconds: string | null;
}

/** Days, events and runs of one template in a single ordered result set. */
function selectStructureRows(executor: Executor, templateId: string): Promise<StructureRow[]> {
  return executor
    .select({
      dayId: templateDays.id,
      dayNumber: templateDays.dayNumber,
      eventId: templateEvents.id,
      eventType: templateEvents.eventType,
      orderIndex: templateEvents.orderIndex,
      runId: templateRuns.id,
      runNumber: templateRuns.runNumber,
      pegSizeCm: templateRuns.pegSizeCm,
      timeLimitSeconds: templateRuns.timeLimitSeconds,
    })
    .from(templateDays)
    .leftJoin(templateEvents, eq(templateEvents.templateDayId, templateDays.id))
    .leftJoin(templateRuns, eq(templateRuns.templateEventId, templateEvents.id))
    .where(eq(templateDays.templateId, templateId))
    .orderBy(asc(templateDays.dayNumber), asc(templateEvents.orderIndex), asc(templateRuns.runNumber));
}

/**
 * Groups the flat join result into days, events and runs.
 *
 * The rows arrive ordered, so appending in sequence preserves the order of the
 * events within a day and of the runs within an event.
 */
function groupStructureRows(rows: readonly StructureRow[]): Map<number, TemplateDayDetail> {
  const days = new Map<number, { id: string; events: Map<string, TemplateEventDetail> }>();

  for (const row of rows) {
    let day = days.get(row.dayNumber);
    if (!day) {
      day = { id: row.dayId, events: new Map() };
      days.set(row.dayNumber, day);
    }
    if (!row.eventId) continue;

    let event = day.events.get(row.eventId);
    if (!event) {
      event = {
        id: row.eventId,
        eventType: row.eventType as EventTypeKey,
        orderIndex: row.orderIndex ?? 0,
        runs: [],
      };
      day.events.set(row.eventId, event);
    }
    if (!row.runId) continue;

    (event.runs as TemplateRunDetail[]).push({
      id: row.runId,
      runNumber: row.runNumber ?? 0,
      pegSizeCm: row.pegSizeCm ?? "0",
      timeLimitSeconds: row.timeLimitSeconds ?? "0",
    });
  }

  const grouped = new Map<number, TemplateDayDetail>();
  for (const [dayNumber, day] of days) {
    grouped.set(dayNumber, {
      id: day.id,
      dayNumber,
      events: [...day.events.values()],
    });
  }
  return grouped;
}

/**
 * Full nested structure of one template.
 *
 * The three competition days are always present. A day that holds no events may
 * never have been stored, so its identifier can be null; saving the template
 * writes all three days.
 */
export async function getTemplateDetail(templateId: string): Promise<TemplateDetail | null> {
  const db = getDb();

  const [record] = await db
    .select({
      id: championshipTemplates.id,
      name: championshipTemplates.name,
      description: championshipTemplates.description,
      isArchived: championshipTemplates.isArchived,
      createdAt: championshipTemplates.createdAt,
      updatedAt: championshipTemplates.updatedAt,
    })
    .from(championshipTemplates)
    .where(eq(championshipTemplates.id, templateId))
    .limit(1);

  if (!record) return null;

  const grouped = groupStructureRows(await selectStructureRows(db, templateId));

  return {
    ...record,
    days: TEMPLATE_DAY_NUMBERS.map(
      (dayNumber) => grouped.get(dayNumber) ?? { id: null, dayNumber, events: [] },
    ),
  };
}

const runSchema = z.object({
  runNumber: z.number().int().min(1),
  pegSizeCm: z.number().positive().max(999),
  timeLimitSeconds: z.number().positive().max(9999),
});

const eventSchema = z.object({
  eventType: z.enum(EVENT_TYPE_KEYS),
  orderIndex: z.number().int().min(1),
  runs: z.array(runSchema).min(1, "Each event needs at least one run."),
});

const daySchema = z.object({
  dayNumber: z.number().int().min(1).max(3),
  events: z.array(eventSchema),
});

/**
 * Editor payload for the structure of a template.
 *
 * The three days always travel together, so a day that lost its last event is
 * saved as an empty day rather than silently keeping the previous structure.
 */
export const templateStructureSchema = z
  .object({ days: z.array(daySchema).length(3, "A template must define exactly three days.") })
  .refine(
    (value) => new Set(value.days.map((day) => day.dayNumber)).size === value.days.length,
    "Each competition day must be given once.",
  )
  .refine(
    (value) => value.days.some((day) => day.events.length > 0),
    "A template needs at least one event across the three days.",
  )
  .refine(
    (value) =>
      value.days.every(
        (day) => new Set(day.events.map((event) => event.eventType)).size === day.events.length,
      ),
    "An event can be held only once on a day.",
  );

export type TemplateStructureInput = z.infer<typeof templateStructureSchema>;

interface EventPlan {
  readonly templateDayId: string;
  readonly eventType: EventTypeKey;
  readonly orderIndex: number;
  readonly runs: readonly { readonly pegSizeCm: number; readonly timeLimitSeconds: number }[];
}

/**
 * Replaces the whole structure of a template inside the caller's transaction.
 *
 * `template_days` cascades to events and runs, so deleting the days clears the
 * structure completely and re-inserting it is both simpler and safer than
 * diffing: nothing else references these rows, because a championship holds its
 * own copy of the structure.
 *
 * The order of the events and the numbering of the runs are re-derived here, so
 * the stored `order_index` and `run_number` are always contiguous and 1-based
 * whatever the client sent.
 */
export async function replaceTemplateStructure(
  tx: Executor,
  templateId: string,
  structure: TemplateStructureInput,
): Promise<{ eventCount: number; runCount: number }> {
  if (structure.days.length === 0) {
    throw new DomainError("A template must define exactly three days.", "VALIDATION");
  }

  await tx.delete(templateDays).where(eq(templateDays.templateId, templateId));

  const dayRows = await tx
    .insert(templateDays)
    .values(structure.days.map((day) => ({ templateId, dayNumber: day.dayNumber })))
    .returning({ id: templateDays.id, dayNumber: templateDays.dayNumber });

  const dayIdByNumber = new Map(dayRows.map((row) => [row.dayNumber, row.id]));

  const plans: EventPlan[] = [];
  for (const day of structure.days) {
    const templateDayId = dayIdByNumber.get(day.dayNumber);
    if (!templateDayId) {
      throw new DomainError("The template days could not be stored.", "UNEXPECTED");
    }
    const ordered = [...day.events].sort((a, b) => a.orderIndex - b.orderIndex);
    ordered.forEach((event, index) => {
      plans.push({
        templateDayId,
        eventType: event.eventType,
        orderIndex: index + 1,
        runs: [...event.runs]
          .sort((a, b) => a.runNumber - b.runNumber)
          .map((entry) => ({
            pegSizeCm: entry.pegSizeCm,
            timeLimitSeconds: entry.timeLimitSeconds,
          })),
      });
    });
  }

  if (plans.length === 0) {
    throw new DomainError(
      "A template needs at least one event across the three days.",
      "VALIDATION",
    );
  }

  const eventRows = await tx
    .insert(templateEvents)
    .values(
      plans.map((plan) => ({
        templateDayId: plan.templateDayId,
        eventType: plan.eventType,
        orderIndex: plan.orderIndex,
      })),
    )
    .returning({
      id: templateEvents.id,
      templateDayId: templateEvents.templateDayId,
      orderIndex: templateEvents.orderIndex,
    });

  const eventIdByPosition = new Map(
    eventRows.map((row) => [`${row.templateDayId}:${row.orderIndex}`, row.id]),
  );

  const runValues: {
    templateEventId: string;
    runNumber: number;
    pegSizeCm: string;
    timeLimitSeconds: string;
  }[] = [];

  for (const plan of plans) {
    const templateEventId = eventIdByPosition.get(`${plan.templateDayId}:${plan.orderIndex}`);
    if (!templateEventId) {
      throw new DomainError("The template events could not be stored.", "UNEXPECTED");
    }
    plan.runs.forEach((entry, index) => {
      runValues.push({
        templateEventId,
        runNumber: index + 1,
        pegSizeCm: entry.pegSizeCm.toFixed(1),
        timeLimitSeconds: entry.timeLimitSeconds.toFixed(2),
      });
    });
  }

  if (runValues.length === 0) {
    throw new DomainError("Each event needs at least one run.", "VALIDATION");
  }

  await tx.insert(templateRuns).values(runValues);

  return { eventCount: plans.length, runCount: runValues.length };
}

/**
 * Reads the structure of a template back in editor form.
 *
 * Used to deep copy a template and available to any caller that needs the
 * structure as plain numbers rather than as stored decimal strings.
 */
export async function getTemplateStructure(
  tx: Executor,
  templateId: string,
): Promise<TemplateStructureInput> {
  const grouped = groupStructureRows(await selectStructureRows(tx, templateId));
  return {
    days: TEMPLATE_DAY_NUMBERS.map((dayNumber) => {
      const day = grouped.get(dayNumber);
      return {
        dayNumber,
        events: (day?.events ?? []).map((event, index) => ({
          eventType: event.eventType,
          orderIndex: index + 1,
          runs: event.runs.map((entry, runIndex) => ({
            runNumber: runIndex + 1,
            pegSizeCm: Number(entry.pegSizeCm),
            timeLimitSeconds: Number(entry.timeLimitSeconds),
          })),
        })),
      };
    }),
  };
}

/**
 * First free name at or after `desired`.
 *
 * `championship_templates.name` is unique, so a copy gets a counter appended
 * until the name is free. The caller still handles a unique violation, because
 * two operators can duplicate the same template at the same moment.
 */
export async function findAvailableTemplateName(
  tx: Executor,
  desired: string,
): Promise<string> {
  const base = desired.trim().slice(0, MAX_TEMPLATE_NAME_LENGTH).trim();

  for (let counter = 1; counter <= 99; counter += 1) {
    const suffix = counter === 1 ? "" : ` ${counter}`;
    const candidate = `${base.slice(0, MAX_TEMPLATE_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    const [clash] = await tx
      .select({ id: championshipTemplates.id })
      .from(championshipTemplates)
      .where(eq(championshipTemplates.name, candidate))
      .limit(1);
    if (!clash) return candidate;
  }

  throw new DomainError("A free name for the copy could not be found.", "CONFLICT");
}
