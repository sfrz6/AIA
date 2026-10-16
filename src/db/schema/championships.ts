import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  championshipStatusEnum,
  eventTypeEnum,
  rosterSlotEnum,
  runStatusEnum,
} from "./enums";
import { users } from "./identity";
import { clubs, riders } from "./registry";
import { championshipTemplates } from "./templates";

export const championships = pgTable(
  "championships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /** Shown instead of `name` on an Arabic-locale page when set. */
    nameAr: text("name_ar"),
    startDate: date("start_date").notNull(),
    location: text("location").notNull(),
    /** Shown instead of `location` on an Arabic-locale page when set. */
    locationAr: text("location_ar"),
    organizer: text("organizer"),
    /** Shown instead of `organizer` on an Arabic-locale page when set. */
    organizerAr: text("organizer_ar"),
    status: championshipStatusEnum("status").notNull().default("DRAFT"),
    /** Controls whether the public results page shows this championship. */
    isPublished: boolean("is_published").notNull().default(false),
    /** Public URL segment. Stable once the championship is published. */
    slug: text("slug").notNull(),
    /**
     * Recorded for provenance only. The championship structure below is a full
     * copy, so the template can be edited or archived without any effect here.
     */
    sourceTemplateId: uuid("source_template_id").references(() => championshipTemplates.id, {
      onDelete: "set null",
    }),
    sourceTemplateName: text("source_template_name"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("championships_slug_idx").on(table.slug),
    index("championships_start_date_idx").on(table.startDate),
    index("championships_published_idx").on(table.isPublished, table.startDate),
  ],
);

export const championshipDays = pgTable(
  "championship_days",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipId: uuid("championship_id")
      .notNull()
      .references(() => championships.id, { onDelete: "cascade" }),
    dayNumber: integer("day_number").notNull(),
    competitionDate: date("competition_date").notNull(),
  },
  (table) => [
    uniqueIndex("championship_days_unique_idx").on(table.championshipId, table.dayNumber),
    check("championship_days_number_check", sql`${table.dayNumber} between 1 and 3`),
  ],
);

export const championshipEvents = pgTable(
  "championship_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipDayId: uuid("championship_day_id")
      .notNull()
      .references(() => championshipDays.id, { onDelete: "cascade" }),
    eventType: eventTypeEnum("event_type").notNull(),
    orderIndex: integer("order_index").notNull(),
  },
  (table) => [
    uniqueIndex("championship_events_order_idx").on(table.championshipDayId, table.orderIndex),
    uniqueIndex("championship_events_type_idx").on(table.championshipDayId, table.eventType),
  ],
);

export const championshipRuns = pgTable(
  "championship_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipEventId: uuid("championship_event_id")
      .notNull()
      .references(() => championshipEvents.id, { onDelete: "cascade" }),
    runNumber: integer("run_number").notNull(),
    pegSizeCm: numeric("peg_size_cm", { precision: 4, scale: 1 }).notNull(),
    timeLimitSeconds: numeric("time_limit_seconds", { precision: 6, scale: 2 }).notNull(),
    status: runStatusEnum("status").notNull().default("ENTRY_ORDER_PENDING"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Incremented on every write, used for optimistic concurrency checks. */
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("championship_runs_unique_idx").on(table.championshipEventId, table.runNumber),
    index("championship_runs_status_idx").on(table.status),
    check("championship_runs_number_check", sql`${table.runNumber} >= 1`),
    check(
      "championship_runs_confirmed_check",
      sql`(${table.status} = 'CONFIRMED') = (${table.confirmedAt} is not null)`,
    ),
  ],
);

/** A club taking part in a championship. */
export const championshipClubs = pgTable(
  "championship_clubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipId: uuid("championship_id")
      .notNull()
      .references(() => championships.id, { onDelete: "cascade" }),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    /**
     * The club's position in the start list (team 1, team 2, ...), 0-based.
     * Set when the club is added and editable from the Participants page
     * until the first run of the championship actually starts. Drives the
     * display order everywhere clubs are listed: participants, entry
     * orders, scoring, round sheets and results.
     */
    orderIndex: integer("order_index").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("championship_clubs_unique_idx").on(table.championshipId, table.clubId),
    uniqueIndex("championship_clubs_order_idx").on(table.championshipId, table.orderIndex),
    index("championship_clubs_championship_idx").on(table.championshipId),
  ],
);

/**
 * A rider's participation in one championship, for one club.
 *
 * Active or reserve is a property of the participation, never of the rider: the
 * same rider can be active in one championship and reserve in the next.
 */
export const championshipRiders = pgTable(
  "championship_riders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipClubId: uuid("championship_club_id")
      .notNull()
      .references(() => championshipClubs.id, { onDelete: "cascade" }),
    riderId: uuid("rider_id")
      .notNull()
      .references(() => riders.id, { onDelete: "restrict" }),
    rosterSlot: rosterSlotEnum("roster_slot").notNull(),
    /** Starting order for the first run, 1 to 4 for active riders. */
    initialOrder: integer("initial_order"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("championship_riders_unique_idx").on(table.championshipClubId, table.riderId),
    uniqueIndex("championship_riders_order_idx")
      .on(table.championshipClubId, table.initialOrder)
      .where(sql`${table.initialOrder} is not null`),
    index("championship_riders_club_idx").on(table.championshipClubId),
    check(
      "championship_riders_order_check",
      sql`(${table.rosterSlot} = 'ACTIVE' and ${table.initialOrder} between 1 and 4)
          or (${table.rosterSlot} = 'RESERVE' and ${table.initialOrder} is null)`,
    ),
  ],
);

export const championshipsRelations = relations(championships, ({ many, one }) => ({
  days: many(championshipDays),
  clubs: many(championshipClubs),
  sourceTemplate: one(championshipTemplates, {
    fields: [championships.sourceTemplateId],
    references: [championshipTemplates.id],
  }),
}));

export const championshipDaysRelations = relations(championshipDays, ({ one, many }) => ({
  championship: one(championships, {
    fields: [championshipDays.championshipId],
    references: [championships.id],
  }),
  events: many(championshipEvents),
}));

export const championshipEventsRelations = relations(championshipEvents, ({ one, many }) => ({
  day: one(championshipDays, {
    fields: [championshipEvents.championshipDayId],
    references: [championshipDays.id],
  }),
  runs: many(championshipRuns),
}));

export const championshipRunsRelations = relations(championshipRuns, ({ one }) => ({
  event: one(championshipEvents, {
    fields: [championshipRuns.championshipEventId],
    references: [championshipEvents.id],
  }),
}));

export const championshipClubsRelations = relations(championshipClubs, ({ one, many }) => ({
  championship: one(championships, {
    fields: [championshipClubs.championshipId],
    references: [championships.id],
  }),
  club: one(clubs, {
    fields: [championshipClubs.clubId],
    references: [clubs.id],
  }),
  riders: many(championshipRiders),
}));

export const championshipRidersRelations = relations(championshipRiders, ({ one }) => ({
  championshipClub: one(championshipClubs, {
    fields: [championshipRiders.championshipClubId],
    references: [championshipClubs.id],
  }),
  rider: one(riders, { fields: [championshipRiders.riderId], references: [riders.id] }),
}));
