import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  championshipEvents,
  championshipRuns,
  championshipTemplates,
  clubs,
  riders,
  templateDays,
  templateEvents,
  templateRuns,
  users,
} from "@/db/schema";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import { getEventTypeDefinition } from "@/domain/scoring/event-types";
import type { Principal } from "@/lib/auth/session";
import {
  createChampionshipFromTemplate,
  type SquadInput,
} from "@/server/services/championship-setup";

export const ADMIN: Principal = {
  userId: "00000000-0000-0000-0000-000000000000",
  name: "Test administrator",
  username: "test-admin",
  isAdmin: true,
  permissions: [],
};

/** Creates the acting user so that audit rows have a real foreign key. */
export async function createActor(name = "Test administrator"): Promise<Principal> {
  const db = getDb();
  const [created] = await db
    .insert(users)
    .values({
      name,
      username: `test-${Math.random().toString(36).slice(2, 10)}`,
      passwordHash: "not-a-real-hash",
      isAdmin: true,
    })
    .returning({ id: users.id, name: users.name, username: users.username });
  if (!created) throw new Error("Could not create the test actor.");
  return {
    userId: created.id,
    name: created.name,
    username: created.username,
    isAdmin: true,
    permissions: [],
  };
}

export interface TemplateEventSpec {
  readonly dayNumber: 1 | 2 | 3;
  readonly eventType: EventTypeKey;
  readonly runs: number;
}

/** Builds a template directly, bypassing the editor, for use as a fixture. */
export async function createTemplate(
  name: string,
  events: readonly TemplateEventSpec[],
): Promise<string> {
  const db = getDb();
  const [template] = await db
    .insert(championshipTemplates)
    .values({ name })
    .returning({ id: championshipTemplates.id });
  if (!template) throw new Error("Could not create the test template.");

  for (const dayNumber of [1, 2, 3] as const) {
    const [day] = await db
      .insert(templateDays)
      .values({ templateId: template.id, dayNumber })
      .returning({ id: templateDays.id });
    if (!day) throw new Error("Could not create the test template day.");

    const dayEvents = events.filter((event) => event.dayNumber === dayNumber);
    for (const [index, spec] of dayEvents.entries()) {
      const definition = getEventTypeDefinition(spec.eventType);
      const [event] = await db
        .insert(templateEvents)
        .values({
          templateDayId: day.id,
          eventType: spec.eventType,
          orderIndex: index + 1,
        })
        .returning({ id: templateEvents.id });
      if (!event) throw new Error("Could not create the test template event.");

      await db.insert(templateRuns).values(
        Array.from({ length: spec.runs }, (_, runIndex) => ({
          templateEventId: event.id,
          runNumber: runIndex + 1,
          pegSizeCm:
            definition.defaultPegSizesCm[runIndex] ??
            definition.defaultPegSizesCm[definition.defaultPegSizesCm.length - 1] ??
            "6",
          timeLimitSeconds: definition.defaultTimeLimitSeconds,
        })),
      );
    }
  }

  return template.id;
}

/** Registers five riders under a club and returns their identifiers. */
export async function createSquadRiders(
  clubId: string,
  prefix: string,
): Promise<readonly string[]> {
  const db = getDb();
  const created = await db
    .insert(riders)
    .values(
      Array.from({ length: 5 }, (_, index) => ({
        clubId,
        fullName: `${prefix} Rider ${index + 1}`,
      })),
    )
    .returning({ id: riders.id });
  return created.map((rider) => rider.id);
}

/**
 * Gets or creates a test club by name.
 *
 * Clubs are no longer pre-seeded from a fixed registry, so tests create
 * their own on demand; idempotent, so repeated calls with the same name in
 * one test run reuse the same club.
 */
export async function clubIdByName(name: string): Promise<string> {
  const db = getDb();
  const [existing] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.name, name)).limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(clubs)
    .values({ name })
    .onConflictDoNothing()
    .returning({ id: clubs.id });
  if (created) return created.id;

  const [row] = await db.select({ id: clubs.id }).from(clubs).where(eq(clubs.name, name)).limit(1);
  if (!row) throw new Error(`Club ${name} could not be created.`);
  return row.id;
}

export interface ChampionshipFixture {
  readonly championshipId: string;
  readonly clubIds: readonly string[];
}

/**
 * Creates a championship from a template with the given clubs, each with
 * four active riders and one reserve.
 */
export async function createChampionshipFixture(options: {
  actor: Principal;
  templateId: string;
  name?: string;
  clubNames?: readonly string[];
}): Promise<ChampionshipFixture> {
  const db = getDb();
  const clubNames = options.clubNames ?? ["JO", "OM"];

  const squads: SquadInput[] = [];
  for (const clubName of clubNames) {
    const clubId = await clubIdByName(clubName);
    const riderIds = await createSquadRiders(clubId, clubName);
    squads.push({
      clubId,
      riders: riderIds.map((riderId, index) => ({
        riderId,
        rosterSlot: index < 4 ? ("ACTIVE" as const) : ("RESERVE" as const),
        initialOrder: index < 4 ? index + 1 : null,
      })),
    });
  }

  const created = await db.transaction((tx) =>
    createChampionshipFromTemplate(tx, options.actor, {
      templateId: options.templateId,
      name: options.name ?? `Test championship ${Math.random().toString(36).slice(2, 8)}`,
      nameAr: null,
      startDate: "2026-09-18",
      location: "Amman",
      organizer: "Royal Jordanian Equestrian Federation",
      squads,
    }),
  );

  return {
    championshipId: created.id,
    clubIds: squads.map((squad) => squad.clubId),
  };
}

/** Runs of a championship in competition order. */
export async function listRunIds(championshipId: string): Promise<readonly string[]> {
  const db = getDb();
  const { championshipDays } = await import("@/db/schema");
  const rows = await db
    .select({ id: championshipRuns.id })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(eq(championshipDays.championshipId, championshipId))
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
    );
  return rows.map((row) => row.id);
}
