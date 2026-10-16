import { sql } from "drizzle-orm";
import { countries } from "@/db/schema";
import { SEED_COUNTRIES } from "@/lib/countries/iso-countries";
import { closeDatabase, loadEnv, openDatabase } from "./lib";

loadEnv();

/**
 * Seeds the permanent country registry.
 *
 * Safe to run repeatedly: an existing country keeps its identity and only its
 * display names are refreshed, so championship history is never orphaned.
 */
async function main(): Promise<void> {
  const variable = process.argv.includes("--test") ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const db = openDatabase(variable);

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
      set: {
        iso3: sql`excluded.iso3`,
        nameEn: sql`excluded.name_en`,
        nameAr: sql`excluded.name_ar`,
        updatedAt: new Date(),
      },
    });

  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(countries);

  console.log(`Country registry seeded. ${row?.count ?? 0} countries available.`);
  await closeDatabase(db);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
