import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { championshipRiders, countries, riders } from "@/db/schema";
import { DomainError } from "@/server/actions/result";
import type { Locale } from "@/lib/i18n/config";

export interface CountrySummary {
  readonly id: string;
  readonly iso2: string;
  readonly iso3: string;
  readonly name: string;
  readonly riderCount: number;
}

export interface RiderRecord {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
  readonly countryId: string;
}

function nameColumn(locale: Locale) {
  return locale === "ar" ? countries.nameAr : countries.nameEn;
}

/** Countries with how many riders each has on its active registry. */
export async function listCountriesWithRiderCounts(
  locale: Locale,
  search?: string,
): Promise<readonly CountrySummary[]> {
  const db = getDb();
  const name = nameColumn(locale);
  const term = search?.trim();

  const rows = await db
    .select({
      id: countries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      name,
      // Written with a literal alias: Drizzle renders an interpolated column
      // inside a `sql` template as a bare name, which would bind to the
      // subquery's own table and silently count the wrong rows.
      riderCount: sql<number>`(
        select count(*)::int from riders r
        where r.country_id = countries.id and r.is_active
      )`,
    })
    .from(countries)
    .where(
      term
        ? sql`(${countries.nameEn} ilike ${`%${term}%`}
            or ${countries.nameAr} ilike ${`%${term}%`}
            or ${countries.iso2} ilike ${`${term}%`}
            or ${countries.iso3} ilike ${`${term}%`})`
        : undefined,
    )
    .orderBy(asc(name));

  return rows;
}

export async function getCountry(
  countryId: string,
  locale: Locale,
): Promise<{ id: string; iso2: string; iso3: string; name: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: countries.id,
      iso2: countries.iso2,
      iso3: countries.iso3,
      name: nameColumn(locale),
    })
    .from(countries)
    .where(eq(countries.id, countryId))
    .limit(1);
  return row ?? null;
}

export async function listRidersForCountry(
  countryId: string,
  options: { includeRetired?: boolean } = {},
): Promise<readonly RiderRecord[]> {
  const db = getDb();
  return db
    .select({
      id: riders.id,
      fullName: riders.fullName,
      isActive: riders.isActive,
      countryId: riders.countryId,
    })
    .from(riders)
    .where(
      options.includeRetired
        ? eq(riders.countryId, countryId)
        : and(eq(riders.countryId, countryId), eq(riders.isActive, true)),
    )
    .orderBy(asc(riders.fullName));
}

/**
 * Adds a rider to a country's permanent registry.
 *
 * Only a name is required: the country comes from the page the operator is on.
 * The unique index on (country, folded name) is what actually prevents a
 * duplicate identity, so a race between two operators is caught by the
 * database rather than by a read-then-write check.
 */
export async function createRider(
  tx: Executor,
  input: { countryId: string; fullName: string },
): Promise<RiderRecord> {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  if (!fullName) throw new DomainError("A rider name is required.", "VALIDATION");

  const inserted = await tx
    .insert(riders)
    .values({ countryId: input.countryId, fullName })
    .onConflictDoNothing()
    .returning({
      id: riders.id,
      fullName: riders.fullName,
      isActive: riders.isActive,
      countryId: riders.countryId,
    });

  const created = inserted[0];
  if (created) return created;

  const [existing] = await tx
    .select({
      id: riders.id,
      fullName: riders.fullName,
      isActive: riders.isActive,
      countryId: riders.countryId,
    })
    .from(riders)
    .where(
      and(
        eq(riders.countryId, input.countryId),
        sql`lower(btrim(${riders.fullName})) = lower(btrim(${fullName}))`,
      ),
    )
    .limit(1);

  if (!existing) throw new DomainError("The rider could not be created.", "UNEXPECTED");
  throw new DomainError("A rider with this name already exists for this country.", "CONFLICT");
}

export async function countChampionshipParticipations(
  tx: Executor,
  riderId: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(championshipRiders)
    .where(eq(championshipRiders.riderId, riderId));
  return row?.count ?? 0;
}
