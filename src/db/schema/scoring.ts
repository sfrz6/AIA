import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { entryOrderDecisionEnum, standingsScopeEnum, standingsSubjectEnum } from "./enums";
import { users } from "./identity";
import {
  championshipCountries,
  championshipRiders,
  championshipRuns,
  championships,
} from "./championships";

/**
 * A country's confirmed entry order for one run.
 *
 * The official change request happens on paper before the run. The operator
 * records the outcome here: either the previous order carries over unchanged,
 * or a new order is entered. Each row, together with its items, is an immutable
 * historical snapshot: a later run never rewrites an earlier one.
 */
export const runEntryOrders = pgTable(
  "run_entry_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => championshipRuns.id, { onDelete: "cascade" }),
    championshipCountryId: uuid("championship_country_id")
      .notNull()
      .references(() => championshipCountries.id, { onDelete: "cascade" }),
    decision: entryOrderDecisionEnum("decision").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedByUserId: uuid("confirmed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("run_entry_orders_unique_idx").on(table.runId, table.championshipCountryId),
    index("run_entry_orders_run_idx").on(table.runId),
  ],
);

export const runEntryOrderItems = pgTable(
  "run_entry_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runEntryOrderId: uuid("run_entry_order_id")
      .notNull()
      .references(() => runEntryOrders.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    championshipRiderId: uuid("championship_rider_id")
      .notNull()
      .references(() => championshipRiders.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("run_entry_order_items_position_idx").on(table.runEntryOrderId, table.position),
    uniqueIndex("run_entry_order_items_rider_idx").on(
      table.runEntryOrderId,
      table.championshipRiderId,
    ),
    check("run_entry_order_items_position_check", sql`${table.position} >= 1`),
  ],
);

/**
 * One timed unit inside a run: a single rider for individual events, a pair, or
 * a whole team. The recorded time belongs to the unit, not to a rider.
 */
export const runScoringUnits = pgTable(
  "run_scoring_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => championshipRuns.id, { onDelete: "cascade" }),
    championshipCountryId: uuid("championship_country_id")
      .notNull()
      .references(() => championshipCountries.id, { onDelete: "cascade" }),
    /** 0-based index of the unit inside the country for this run. */
    unitIndex: integer("unit_index").notNull(),
    timeSeconds: numeric("time_seconds", { precision: 6, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("run_scoring_units_unique_idx").on(
      table.runId,
      table.championshipCountryId,
      table.unitIndex,
    ),
    index("run_scoring_units_run_idx").on(table.runId),
    check("run_scoring_units_index_check", sql`${table.unitIndex} >= 0`),
    check(
      "run_scoring_units_time_check",
      sql`${table.timeSeconds} is null or ${table.timeSeconds} >= 0`,
    ),
  ],
);

/** One rider's participation in one run, inside one scoring unit. */
export const runScores = pgTable(
  "run_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => championshipRuns.id, { onDelete: "cascade" }),
    runScoringUnitId: uuid("run_scoring_unit_id")
      .notNull()
      .references(() => runScoringUnits.id, { onDelete: "cascade" }),
    championshipRiderId: uuid("championship_rider_id")
      .notNull()
      .references(() => championshipRiders.id, { onDelete: "restrict" }),
    /** 1-based position of the rider inside the unit. */
    positionInUnit: integer("position_in_unit").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // A rider rides at most once per run.
    uniqueIndex("run_scores_rider_idx").on(table.runId, table.championshipRiderId),
    uniqueIndex("run_scores_unit_position_idx").on(table.runScoringUnitId, table.positionInUnit),
    index("run_scores_run_idx").on(table.runId),
    check("run_scores_position_check", sql`${table.positionInUnit} >= 1`),
  ],
);

/**
 * One target attempt. Most events have a single target per rider per run;
 * rings and peg and lemons and peg have three.
 */
export const runScoreTargets = pgTable(
  "run_score_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runScoreId: uuid("run_score_id")
      .notNull()
      .references(() => runScores.id, { onDelete: "cascade" }),
    /** 0-based index of the target inside the run. */
    targetIndex: integer("target_index").notNull(),
    /** Null until the referee records a value. */
    points: numeric("points", { precision: 4, scale: 1 }),
  },
  (table) => [
    uniqueIndex("run_score_targets_unique_idx").on(table.runScoreId, table.targetIndex),
    check("run_score_targets_index_check", sql`${table.targetIndex} >= 0`),
    check(
      "run_score_targets_points_check",
      sql`${table.points} is null or ${table.points} in (0, 2, 4, 6)`,
    ),
  ],
);

/**
 * An audited correction to a run that was already confirmed. Every correction
 * keeps the complete before and after picture plus the mandatory reason.
 */
export const runRevisions = pgTable(
  "run_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => championshipRuns.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    reason: text("reason").notNull(),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    changedByName: text("changed_by_name").notNull(),
    beforeData: jsonb("before_data").notNull(),
    afterData: jsonb("after_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("run_revisions_unique_idx").on(table.runId, table.revisionNumber),
    index("run_revisions_run_idx").on(table.runId, table.createdAt),
    check("run_revisions_number_check", sql`${table.revisionNumber} >= 1`),
    check("run_revisions_reason_check", sql`btrim(${table.reason}) <> ''`),
  ],
);

/**
 * A tie-break round, called a round of draws in the reference workbook. It is
 * ridden at a reduced peg size to separate competitors or countries that are
 * level on points.
 */
export const tieBreakRounds = pgTable(
  "tie_break_rounds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    championshipId: uuid("championship_id")
      .notNull()
      .references(() => championships.id, { onDelete: "cascade" }),
    scope: standingsScopeEnum("scope").notNull(),
    subject: standingsSubjectEnum("subject").notNull(),
    pegSizeCm: numeric("peg_size_cm", { precision: 4, scale: 1 }).notNull(),
    timeLimitSeconds: numeric("time_limit_seconds", { precision: 6, scale: 2 }).notNull(),
    /** Penalty cap for the round, which is also the maximum scoreable points. */
    maxPoints: numeric("max_points", { precision: 5, scale: 1 }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tie_break_rounds_unique_idx").on(
      table.championshipId,
      table.scope,
      table.subject,
    ),
  ],
);

export const tieBreakEntries = pgTable(
  "tie_break_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tieBreakRoundId: uuid("tie_break_round_id")
      .notNull()
      .references(() => tieBreakRounds.id, { onDelete: "cascade" }),
    /** Set for an individual tie-break, null for a country tie-break. */
    championshipRiderId: uuid("championship_rider_id").references(() => championshipRiders.id, {
      onDelete: "cascade",
    }),
    /** Set for a country tie-break, null for an individual tie-break. */
    championshipCountryId: uuid("championship_country_id").references(
      () => championshipCountries.id,
      { onDelete: "cascade" },
    ),
    timeSeconds: numeric("time_seconds", { precision: 6, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("tie_break_entries_rider_idx")
      .on(table.tieBreakRoundId, table.championshipRiderId)
      .where(sql`${table.championshipRiderId} is not null`),
    uniqueIndex("tie_break_entries_country_idx")
      .on(table.tieBreakRoundId, table.championshipCountryId)
      .where(sql`${table.championshipCountryId} is not null`),
    check(
      "tie_break_entries_subject_check",
      sql`(${table.championshipRiderId} is not null) <> (${table.championshipCountryId} is not null)`,
    ),
    check("tie_break_entries_time_check", sql`${table.timeSeconds} >= 0`),
  ],
);

/**
 * Points scored in a tie-break round. An individual round has one row; a
 * country round has one row per rider taking part in the draw.
 */
export const tieBreakEntryScores = pgTable(
  "tie_break_entry_scores",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tieBreakEntryId: uuid("tie_break_entry_id")
      .notNull()
      .references(() => tieBreakEntries.id, { onDelete: "cascade" }),
    championshipRiderId: uuid("championship_rider_id")
      .notNull()
      .references(() => championshipRiders.id, { onDelete: "cascade" }),
    points: numeric("points", { precision: 4, scale: 1 }).notNull(),
  },
  (table) => [
    uniqueIndex("tie_break_entry_scores_unique_idx").on(
      table.tieBreakEntryId,
      table.championshipRiderId,
    ),
    check(
      "tie_break_entry_scores_points_check",
      sql`${table.points} in (0, 2, 4, 6)`,
    ),
  ],
);

export const runEntryOrdersRelations = relations(runEntryOrders, ({ one, many }) => ({
  run: one(championshipRuns, {
    fields: [runEntryOrders.runId],
    references: [championshipRuns.id],
  }),
  championshipCountry: one(championshipCountries, {
    fields: [runEntryOrders.championshipCountryId],
    references: [championshipCountries.id],
  }),
  items: many(runEntryOrderItems),
}));

export const runEntryOrderItemsRelations = relations(runEntryOrderItems, ({ one }) => ({
  entryOrder: one(runEntryOrders, {
    fields: [runEntryOrderItems.runEntryOrderId],
    references: [runEntryOrders.id],
  }),
  championshipRider: one(championshipRiders, {
    fields: [runEntryOrderItems.championshipRiderId],
    references: [championshipRiders.id],
  }),
}));

export const runScoringUnitsRelations = relations(runScoringUnits, ({ one, many }) => ({
  run: one(championshipRuns, {
    fields: [runScoringUnits.runId],
    references: [championshipRuns.id],
  }),
  championshipCountry: one(championshipCountries, {
    fields: [runScoringUnits.championshipCountryId],
    references: [championshipCountries.id],
  }),
  scores: many(runScores),
}));

export const runScoresRelations = relations(runScores, ({ one, many }) => ({
  unit: one(runScoringUnits, {
    fields: [runScores.runScoringUnitId],
    references: [runScoringUnits.id],
  }),
  championshipRider: one(championshipRiders, {
    fields: [runScores.championshipRiderId],
    references: [championshipRiders.id],
  }),
  targets: many(runScoreTargets),
}));

export const runScoreTargetsRelations = relations(runScoreTargets, ({ one }) => ({
  score: one(runScores, { fields: [runScoreTargets.runScoreId], references: [runScores.id] }),
}));

export const tieBreakRoundsRelations = relations(tieBreakRounds, ({ one, many }) => ({
  championship: one(championships, {
    fields: [tieBreakRounds.championshipId],
    references: [championships.id],
  }),
  entries: many(tieBreakEntries),
}));

export const tieBreakEntriesRelations = relations(tieBreakEntries, ({ one, many }) => ({
  round: one(tieBreakRounds, {
    fields: [tieBreakEntries.tieBreakRoundId],
    references: [tieBreakRounds.id],
  }),
  scores: many(tieBreakEntryScores),
}));

export const tieBreakEntryScoresRelations = relations(tieBreakEntryScores, ({ one }) => ({
  entry: one(tieBreakEntries, {
    fields: [tieBreakEntryScores.tieBreakEntryId],
    references: [tieBreakEntries.id],
  }),
}));
