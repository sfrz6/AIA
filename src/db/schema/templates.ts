import { relations } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { eventTypeEnum } from "./enums";
import { users } from "./identity";

/**
 * A template describes the structure of a championship: which events run on
 * which day, in which order, over how many runs, and with which peg size.
 *
 * Templates are never read while a championship is being scored. Creating a
 * championship copies the whole structure, so editing a template later can
 * never change a championship that already exists.
 */
export const championshipTemplates = pgTable(
  "championship_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    isArchived: boolean("is_archived").notNull().default(false),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("championship_templates_name_idx").on(table.name)],
);

/** A championship always spans exactly three competition days. */
export const templateDays = pgTable(
  "template_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => championshipTemplates.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
  },
  (table) => [
    uniqueIndex("template_days_unique_idx").on(table.templateId, table.dayNumber),
    check("template_days_day_number_check", sql`${table.dayNumber} between 1 and 3`),
  ],
);

export const templateEvents = pgTable(
  "template_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateDayId: uuid("template_day_id")
      .notNull()
      .references(() => templateDays.id, { onDelete: "cascade" }),
    eventType: eventTypeEnum("event_type").notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    uniqueIndex("template_events_order_idx").on(table.templateDayId, table.orderIndex),
    uniqueIndex("template_events_type_idx").on(table.templateDayId, table.eventType),
    check("template_events_order_check", sql`${table.orderIndex} >= 1`),
  ],
);

export const templateRuns = pgTable(
  "template_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    templateEventId: uuid("template_event_id")
      .notNull()
      .references(() => templateEvents.id, { onDelete: "cascade" }),
    runNumber: integer("run_number").notNull(),
    /** Peg size for this run, in centimetres. */
    pegSizeCm: numeric("peg_size_cm", { precision: 4, scale: 1 }).notNull(),
    /** Seconds allowed before the time penalty starts. */
    timeLimitSeconds: numeric("time_limit_seconds", { precision: 6, scale: 2 }).notNull(),
  },
  (table) => [
    uniqueIndex("template_runs_unique_idx").on(table.templateEventId, table.runNumber),
    index("template_runs_event_idx").on(table.templateEventId),
    check("template_runs_number_check", sql`${table.runNumber} >= 1`),
    check("template_runs_peg_check", sql`${table.pegSizeCm} > 0`),
    check("template_runs_time_check", sql`${table.timeLimitSeconds} > 0`),
  ],
);

export const championshipTemplatesRelations = relations(championshipTemplates, ({ many }) => ({
  days: many(templateDays),
}));

export const templateDaysRelations = relations(templateDays, ({ one, many }) => ({
  template: one(championshipTemplates, {
    fields: [templateDays.templateId],
    references: [championshipTemplates.id],
  }),
  events: many(templateEvents),
}));

export const templateEventsRelations = relations(templateEvents, ({ one, many }) => ({
  day: one(templateDays, {
    fields: [templateEvents.templateDayId],
    references: [templateDays.id],
  }),
  runs: many(templateRuns),
}));

export const templateRunsRelations = relations(templateRuns, ({ one }) => ({
  event: one(templateEvents, {
    fields: [templateRuns.templateEventId],
    references: [templateEvents.id],
  }),
}));
