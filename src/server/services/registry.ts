import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { championshipRiders, clubs, riders } from "@/db/schema";
import { DomainError } from "@/server/actions/result";
import type { Locale } from "@/lib/i18n/config";

export interface ClubSummary {
  readonly id: string;
  readonly name: string;
  readonly riderCount: number;
}

export interface RiderRecord {
  readonly id: string;
  readonly fullName: string;
  readonly fullNameAr: string | null;
  readonly isActive: boolean;
  readonly clubId: string;
}

/**
 * A club's display name, Arabic locale falling back to the primary name when
 * no Arabic override was set, same as a championship's own `name`/`nameAr`.
 */
function nameColumn(locale: Locale) {
  return locale === "ar" ? sql<string>`coalesce(${clubs.nameAr}, ${clubs.name})` : clubs.name;
}

/** Clubs with how many riders each has on its active registry. */
export async function listClubsWithRiderCounts(
  locale: Locale,
  search?: string,
): Promise<readonly ClubSummary[]> {
  const db = getDb();
  const name = nameColumn(locale);
  const term = search?.trim();

  const rows = await db
    .select({
      id: clubs.id,
      name,
      // Written with a literal alias: Drizzle renders an interpolated column
      // inside a `sql` template as a bare name, which would bind to the
      // subquery's own table and silently count the wrong rows.
      riderCount: sql<number>`(
        select count(*)::int from riders r
        where r.club_id = clubs.id and r.is_active
      )`,
    })
    .from(clubs)
    .where(
      term
        ? sql`(${clubs.name} ilike ${`%${term}%`} or ${clubs.nameAr} ilike ${`%${term}%`})`
        : undefined,
    )
    .orderBy(asc(name));

  return rows;
}

export async function getClub(
  clubId: string,
  locale: Locale,
): Promise<{ id: string; name: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      id: clubs.id,
      name: nameColumn(locale),
    })
    .from(clubs)
    .where(eq(clubs.id, clubId))
    .limit(1);
  return row ?? null;
}

/**
 * Creates a club by name only: there is no flag, logo or code to enter, just
 * the name shown everywhere the club appears (and an optional Arabic name).
 * The unique index on the folded name is what actually prevents a duplicate
 * identity, so a race between two operators is caught by the database rather
 * than by a read-then-write check.
 */
export async function createClub(
  tx: Executor,
  input: { name: string; nameAr: string | null },
): Promise<{ id: string; name: string }> {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new DomainError("A club name is required.", "VALIDATION");
  const nameAr = input.nameAr?.trim().replace(/\s+/g, " ") || null;

  const inserted = await tx
    .insert(clubs)
    .values({ name, nameAr })
    .onConflictDoNothing()
    .returning({ id: clubs.id, name: clubs.name });

  const created = inserted[0];
  if (created) return created;

  throw new DomainError("A club with this name already exists.", "CONFLICT", {
    name: "A club with this name already exists.",
  });
}

export async function listRidersForClub(
  clubId: string,
  options: { includeRetired?: boolean } = {},
): Promise<readonly RiderRecord[]> {
  const db = getDb();
  return db
    .select({
      id: riders.id,
      fullName: riders.fullName,
      fullNameAr: riders.fullNameAr,
      isActive: riders.isActive,
      clubId: riders.clubId,
    })
    .from(riders)
    .where(
      options.includeRetired
        ? eq(riders.clubId, clubId)
        : and(eq(riders.clubId, clubId), eq(riders.isActive, true)),
    )
    .orderBy(asc(riders.fullName));
}

/**
 * Adds a rider to a club's permanent registry.
 *
 * Only a name is required: the club comes from the page the operator is on.
 * The unique index on (club, folded name) is what actually prevents a
 * duplicate identity, so a race between two operators is caught by the
 * database rather than by a read-then-write check.
 */
export async function createRider(
  tx: Executor,
  input: { clubId: string; fullName: string; fullNameAr: string | null },
): Promise<RiderRecord> {
  const fullName = input.fullName.trim().replace(/\s+/g, " ");
  if (!fullName) throw new DomainError("A rider name is required.", "VALIDATION");
  const fullNameAr = input.fullNameAr?.trim().replace(/\s+/g, " ") || null;

  const inserted = await tx
    .insert(riders)
    .values({ clubId: input.clubId, fullName, fullNameAr })
    .onConflictDoNothing()
    .returning({
      id: riders.id,
      fullName: riders.fullName,
      fullNameAr: riders.fullNameAr,
      isActive: riders.isActive,
      clubId: riders.clubId,
    });

  const created = inserted[0];
  if (created) return created;

  const [existing] = await tx
    .select({
      id: riders.id,
      fullName: riders.fullName,
      fullNameAr: riders.fullNameAr,
      isActive: riders.isActive,
      clubId: riders.clubId,
    })
    .from(riders)
    .where(
      and(
        eq(riders.clubId, input.clubId),
        sql`lower(btrim(${riders.fullName})) = lower(btrim(${fullName}))`,
      ),
    )
    .limit(1);

  if (!existing) throw new DomainError("The rider could not be created.", "UNEXPECTED");
  throw new DomainError("A rider with this name already exists for this club.", "CONFLICT");
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
