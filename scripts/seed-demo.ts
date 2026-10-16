import { and, asc, eq, inArray } from "drizzle-orm";
import {
  championshipDays,
  championshipEvents,
  championshipRuns,
  championshipTemplates,
  countries,
  riders,
  templateDays,
  templateEvents,
  templateRuns,
  users,
} from "@/db/schema";
import {
  getEventTypeDefinition,
  type EventTypeKey,
} from "@/domain/scoring/event-types";
import type { Principal } from "@/lib/auth/session";
import {
  createChampionshipFromTemplate,
  type SquadInput,
} from "@/server/services/championship-setup";
import {
  confirmCountryEntryOrder,
  confirmRun,
  getRunScoringState,
  saveRunScores,
  startRun,
  type RunScorePayload,
} from "@/server/services/runs";
import { getRunContext } from "@/server/services/championships";
import { closeDatabase, fail, loadEnv, openDatabase } from "./lib";

loadEnv();

/**
 * Creates a realistic championship to explore: the full three day structure
 * from the reference workbook, four countries, twenty riders, and the opening
 * Individual Lance run already scored and confirmed so the standings, the
 * public results page and the correction workflow all have something to show.
 *
 * Demo data only. Everything it creates is named so it is obvious, and the
 * command refuses to touch a database that already holds a championship.
 */

const TEMPLATE_NAME = "Demo: ITPF three day championship";
const CHAMPIONSHIP_NAME = "Demo: WC Qualifying Tournament, Jordan 2026";
const DEMO_COUNTRIES = ["JO", "OM", "AE", "PK"] as const;

const STRUCTURE: ReadonlyArray<{ day: 1 | 2 | 3; event: EventTypeKey; runs: number }> = [
  { day: 1, event: "INDIVIDUAL_LANCE", runs: 2 },
  { day: 1, event: "PAIR_LANCE", runs: 2 },
  { day: 1, event: "TEAM_LANCE", runs: 3 },
  { day: 2, event: "INDIVIDUAL_SWORD", runs: 2 },
  { day: 2, event: "PAIR_SWORD", runs: 2 },
  { day: 2, event: "TEAM_SWORD", runs: 3 },
  { day: 3, event: "RINGS_AND_PEG_LANCE", runs: 2 },
  { day: 3, event: "LEMON_AND_PEG_SWORD", runs: 2 },
  { day: 3, event: "RELAY_LANCE", runs: 2 },
  { day: 3, event: "RELAY_SWORD", runs: 2 },
];

const RIDER_NAMES: Record<string, readonly string[]> = {
  JO: ["Faris Al Majali", "Omar Al Tarawneh", "Yazan Al Hadid", "Rakan Al Shobaki", "Mutaz Al Fayez"],
  OM: ["Salim Al Harthy", "Khalid Al Riyami", "Nasser Al Balushi", "Hamad Al Saadi", "Talal Al Hinai"],
  AE: ["Rashid Al Mansoori", "Saeed Al Ketbi", "Hamdan Al Nuaimi", "Majid Al Shamsi", "Khalifa Al Suwaidi"],
  PK: ["Imran Baig", "Zafar Abbas", "Sohail Akhtar", "Bilal Nadeem", "Usman Tariq"],
};

/** Deterministic, so the demo looks the same every time it is seeded. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

async function main(): Promise<void> {
  const db = openDatabase();

  const [existing] = await db
    .select({ id: championshipTemplates.id })
    .from(championshipTemplates)
    .where(eq(championshipTemplates.name, TEMPLATE_NAME))
    .limit(1);
  if (existing && !process.argv.includes("--force")) {
    fail(
      "The demo data already exists. Delete the demo championship and template from the " +
        "interface first, or pass --force to create a second copy.",
    );
  }

  const [admin] = await db
    .select({ id: users.id, name: users.name, username: users.username })
    .from(users)
    .where(and(eq(users.isAdmin, true), eq(users.isActive, true)))
    .limit(1);
  if (!admin) fail("No active administrator. Run `npm run db:bootstrap-admin` first.");

  const actor: Principal = {
    userId: admin.id,
    name: admin.name,
    username: admin.username,
    isAdmin: true,
    permissions: [],
  };

  // The template: the full structure from the reference workbook.
  const [template] = await db
    .insert(championshipTemplates)
    .values({
      name: TEMPLATE_NAME,
      description:
        "Demo data. Mirrors the structure of the reference workbook: lance on day 1, sword on day 2, peg and relay events on day 3.",
      createdByUserId: actor.userId,
    })
    .returning({ id: championshipTemplates.id });
  if (!template) fail("Could not create the demo template.");

  for (const dayNumber of [1, 2, 3] as const) {
    const [day] = await db
      .insert(templateDays)
      .values({ templateId: template.id, dayNumber })
      .returning({ id: templateDays.id });
    if (!day) fail("Could not create a demo template day.");

    const dayEvents = STRUCTURE.filter((entry) => entry.day === dayNumber);
    for (const [index, entry] of dayEvents.entries()) {
      const definition = getEventTypeDefinition(entry.event);
      const [event] = await db
        .insert(templateEvents)
        .values({
          templateDayId: day.id,
          eventType: entry.event,
          orderIndex: index + 1,
        })
        .returning({ id: templateEvents.id });
      if (!event) fail("Could not create a demo template event.");

      await db.insert(templateRuns).values(
        Array.from({ length: entry.runs }, (_, runIndex) => ({
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

  // Riders, registered permanently under their country.
  const participating = await db
    .select({ id: countries.id, iso2: countries.iso2, name: countries.nameEn })
    .from(countries)
    .where(inArray(countries.iso2, [...DEMO_COUNTRIES]));

  const squads: SquadInput[] = [];
  for (const country of participating) {
    const names = RIDER_NAMES[country.iso2] ?? [];
    const created = await db
      .insert(riders)
      .values(names.map((fullName) => ({ countryId: country.id, fullName })))
      .onConflictDoNothing()
      .returning({ id: riders.id });

    const riderIds =
      created.length === names.length
        ? created.map((rider) => rider.id)
        : (
            await db
              .select({ id: riders.id })
              .from(riders)
              .where(eq(riders.countryId, country.id))
              .orderBy(asc(riders.fullName))
              .limit(5)
          ).map((rider) => rider.id);

    squads.push({
      countryId: country.id,
      riders: riderIds.map((riderId, index) => ({
        riderId,
        rosterSlot: index < 4 ? "ACTIVE" : "RESERVE",
        initialOrder: index < 4 ? index + 1 : null,
      })),
    });
  }

  const championship = await db.transaction((tx) =>
    createChampionshipFromTemplate(tx, actor, {
      templateId: template.id,
      name: CHAMPIONSHIP_NAME,
      nameAr: "تجريبي: بطولة التأهل لكأس العالم، الأردن 2026",
      startDate: "2026-09-18",
      location: "Amman, Jordan",
      organizer: "Royal Jordanian Equestrian Federation",
      squads,
    }),
  );

  // Score and confirm the opening Individual Lance run, so the standings, the
  // public page and the correction workflow all have real data behind them.
  const [firstRun] = await db
    .select({ id: championshipRuns.id })
    .from(championshipRuns)
    .innerJoin(
      championshipEvents,
      eq(championshipEvents.id, championshipRuns.championshipEventId),
    )
    .innerJoin(championshipDays, eq(championshipDays.id, championshipEvents.championshipDayId))
    .where(eq(championshipDays.championshipId, championship.id))
    .orderBy(
      asc(championshipDays.dayNumber),
      asc(championshipEvents.orderIndex),
      asc(championshipRuns.runNumber),
    )
    .limit(1);
  if (!firstRun) fail("The demo championship has no runs.");

  const { getRunEntryOrderState } = await import("@/server/services/runs");
  const entryOrders = await getRunEntryOrderState(firstRun.id, "en");
  if (!entryOrders) fail("Could not read the demo run.");

  for (const country of entryOrders.countries) {
    await db.transaction((tx) =>
      confirmCountryEntryOrder(tx, actor, {
        runId: firstRun.id,
        championshipCountryId: country.championshipCountryId,
        decision: "NO_CHANGE",
      }),
    );
  }

  let context = await getRunContext(firstRun.id);
  if (!context) fail("Could not read the demo run.");
  await db.transaction((tx) => startRun(tx, actor, firstRun.id, context!.version));

  const scoring = await getRunScoringState(firstRun.id, "en");
  if (!scoring) fail("Could not read the demo run.");

  const random = makeRandom(20260918);
  const payload: RunScorePayload = {
    units: [],
    scores: [],
  };
  const units: Array<{ runScoringUnitId: string; timeSeconds: string | null }> = [];
  const scores: Array<{ runScoreId: string; targets: Array<number | null> }> = [];

  for (const country of scoring.countries) {
    for (const unit of country.units) {
      // A spread of realistic times around the 6.40 s limit, so some riders
      // take a penalty and the standings are not all level.
      const seconds = 5.8 + random() * 2.4;
      units.push({ runScoringUnitId: unit.runScoringUnitId, timeSeconds: seconds.toFixed(2) });
      for (const rider of unit.riders) {
        const award = [0, 2, 4, 6, 6, 6][Math.floor(random() * 6)] ?? 6;
        scores.push({
          runScoreId: rider.runScoreId,
          targets: rider.targets.map(() => award),
        });
      }
    }
  }

  context = await getRunContext(firstRun.id);
  await db.transaction((tx) =>
    saveRunScores(tx, actor, {
      runId: firstRun.id,
      expectedVersion: context!.version,
      payload: { ...payload, units, scores },
    }),
  );

  context = await getRunContext(firstRun.id);
  await db.transaction((tx) =>
    confirmRun(tx, actor, { runId: firstRun.id, expectedVersion: context!.version }),
  );

  console.log(`
  Demo data created.

    Template       ${TEMPLATE_NAME}
    Championship   ${CHAMPIONSHIP_NAME}
    Countries      ${participating.map((c) => c.name).join(", ")}
    Riders         ${participating.length * 5} (4 active and 1 reserve each)
    Runs           ${STRUCTURE.reduce((total, entry) => total + entry.runs, 0)} across 3 days
    Scored         Individual Lance, run 1, confirmed

  Open /championships to carry on from run 2, or /results to see the standings.
  The championship is not published yet, so the public page stays empty until
  you publish it from its overview.
`);

  await closeDatabase(db);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
