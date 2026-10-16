import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

export const E2E_ADMIN = { username: "e2e-admin", password: "E2ePassword!2026" } as const;

/** Countries the suite competes with, chosen so their flags are seeded. */
export const E2E_COUNTRIES = ["Jordan", "Oman"] as const;

export function e2eDatabaseUrl(): string {
  const url = process.env.E2E_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "E2E_DATABASE_URL (or TEST_DATABASE_URL) must be set to run the end to end suite.",
    );
  }
  return url;
}

/**
 * Prepares a dedicated database for the end to end suite: schema up to date,
 * country registry seeded, one administrator, and riders registered for the two
 * competing countries so the championship wizard has a squad to pick from.
 *
 * Deliberately destructive, which is why it refuses to touch anything that is
 * not an explicitly configured end to end database.
 */
export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  process.env.DATABASE_URL = url;
  process.env.DATABASE_DRIVER = "pg";

  const { createDatabase } = await import("../src/db");
  const db = createDatabase(url);

  await migrate(db as never, { migrationsFolder: "./src/db/migrations" });

  const { countries, riders, users } = await import("../src/db/schema");
  const { SEED_COUNTRIES } = await import("../src/lib/countries/iso-countries");
  const { hashPassword } = await import("../src/lib/auth/password");
  const { eq, inArray } = await import("drizzle-orm");

  await db.execute(
    sql.raw(
      `truncate table audit_logs, run_revisions, run_score_targets, run_scores,
       run_scoring_units, run_entry_order_items, run_entry_orders,
       tie_break_entry_scores, tie_break_entries, tie_break_rounds,
       championship_riders, championship_countries, championship_runs,
       championship_events, championship_days, championships, template_runs,
       template_events, template_days, championship_templates, riders, sessions,
       user_permissions, users restart identity cascade`,
    ),
  );

  await db
    .insert(countries)
    .values(
      SEED_COUNTRIES.map((country) => ({
        iso2: country.iso2,
        iso3: country.iso3,
        nameEn: country.nameEn,
        nameAr: country.nameAr,
      })),
    )
    .onConflictDoUpdate({
      target: countries.iso2,
      set: { nameEn: sql`excluded.name_en`, nameAr: sql`excluded.name_ar` },
    });

  await db.insert(users).values({
    name: "End to end administrator",
    username: E2E_ADMIN.username,
    passwordHash: await hashPassword(E2E_ADMIN.password),
    isAdmin: true,
    isActive: true,
  });

  // Four riders per country. The suite adds the fifth through the interface, so
  // the "Add rider" path is exercised by the happy path itself.
  const competing = await db
    .select({ id: countries.id, iso2: countries.iso2 })
    .from(countries)
    .where(inArray(countries.iso2, ["JO", "OM"]));

  for (const country of competing) {
    await db.insert(riders).values(
      Array.from({ length: 4 }, (_, index) => ({
        countryId: country.id,
        fullName: `${country.iso2} Rider ${index + 1}`,
      })),
    );
  }

  const [check] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(riders)
    .where(eq(riders.isActive, true));
  if ((check?.total ?? 0) !== 8) {
    throw new Error(`Expected 8 seeded riders, found ${check?.total ?? 0}.`);
  }

  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  if (client?.end) await client.end();
}
