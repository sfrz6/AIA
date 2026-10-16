import { relations, sql } from "drizzle-orm";
import {
  boolean,
  char,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Countries are permanent. A country keeps the same identity across every
 * championship so that future versions can attach historical results and
 * ranking points to it without rewriting anything.
 */
export const countries = pgTable(
  "countries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** ISO 3166-1 alpha-2, uppercase. Drives the flag shown in the interface. */
    iso2: char("iso2", { length: 2 }).notNull(),
    /** ISO 3166-1 alpha-3, uppercase. Used on printed documents. */
    iso3: char("iso3", { length: 3 }).notNull(),
    nameEn: text("name_en").notNull(),
    nameAr: text("name_ar").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("countries_iso2_idx").on(table.iso2),
    uniqueIndex("countries_iso3_idx").on(table.iso3),
    index("countries_name_en_idx").on(table.nameEn),
  ],
);

/**
 * Riders belong permanently to a country. There is deliberately no team entity
 * that owns riders: a national squad is assembled per championship, and the
 * rider identity survives across championships.
 */
export const riders = pgTable(
  "riders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    countryId: uuid("country_id")
      .notNull()
      .references(() => countries.id, { onDelete: "restrict" }),
    fullName: text("full_name").notNull(),
    /** Retired riders stay in the registry but drop out of the pickers. */
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("riders_country_idx").on(table.countryId),
    // Guards against the same rider being entered twice under one country,
    // which would split that rider's future history across two identities.
    uniqueIndex("riders_country_name_idx").on(
      table.countryId,
      sql`lower(btrim(${table.fullName}))`,
    ),
  ],
);

export const countriesRelations = relations(countries, ({ many }) => ({
  riders: many(riders),
}));

export const ridersRelations = relations(riders, ({ one }) => ({
  country: one(countries, { fields: [riders.countryId], references: [countries.id] }),
}));
