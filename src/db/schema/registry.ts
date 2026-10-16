import { relations, sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Clubs are permanent. A club keeps the same identity across every
 * championship so that future versions can attach historical results and
 * ranking points to it without rewriting anything.
 *
 * A club is entered by name only: there is no flag, logo or club code
 * attached to it, unlike the national federations the system used to model.
 */
export const clubs = pgTable(
  "clubs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /** Shown instead of `name` on an Arabic-locale page when set. */
    nameAr: text("name_ar"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("clubs_name_idx").on(sql`lower(btrim(${table.name}))`)],
);

/**
 * Riders belong permanently to a club. There is deliberately no separate
 * team entity that owns riders: a squad is assembled per championship, and
 * the rider identity survives across championships.
 */
export const riders = pgTable(
  "riders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clubId: uuid("club_id")
      .notNull()
      .references(() => clubs.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    /** Shown instead of `fullName` on an Arabic-locale page when set. */
    fullNameAr: text("full_name_ar"),
    /** Retired riders stay in the registry but drop out of the pickers. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("riders_club_idx").on(table.clubId),
    // Guards against the same rider being entered twice under one club,
    // which would split that rider's future history across two identities.
    uniqueIndex("riders_club_name_idx").on(table.clubId, sql`lower(btrim(${table.fullName}))`),
  ],
);

export const clubsRelations = relations(clubs, ({ many }) => ({
  riders: many(riders),
}));

export const ridersRelations = relations(riders, ({ one }) => ({
  club: one(clubs, { fields: [riders.clubId], references: [clubs.id] }),
}));
