import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase, resetDatabase } from "../helpers/database";
import {
  createActor,
  createChampionshipFixture,
  createTemplate,
  listRunIds,
} from "../helpers/fixtures";
import type { Principal } from "@/lib/auth/session";

const suite = hasTestDatabase ? describe : describe.skip;

suite("concurrency and data integrity", () => {
  let actor: Principal;
  let db: Awaited<ReturnType<typeof getDatabase>>;

  async function getDatabase() {
    const { getDb } = await import("@/db");
    return getDb();
  }

  beforeAll(async () => {
    db = await getDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
    actor = await createActor();
  });

  async function setUp() {
    const templateId = await createTemplate("Concurrency template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const fixture = await createChampionshipFixture({ actor, templateId });
    const runIds = await listRunIds(fixture.championshipId);
    return { ...fixture, runId: runIds[0]! };
  }

  /**
   * Two operators confirming the last two countries at the same moment each
   * commit without seeing the other, so neither observes the run becoming
   * complete. The run must still be startable.
   */
  it("starts a run whose countries were confirmed in concurrent transactions", async () => {
    const { runId } = await setUp();
    const { getRunEntryOrderState, confirmCountryEntryOrder, startRun } = await import(
      "@/server/services/runs"
    );
    const { getRunContext } = await import("@/server/services/championships");

    const state = await getRunEntryOrderState(runId, "en");
    const [first, second] = state!.countries;

    await Promise.all([
      db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: first!.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      ),
      db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: second!.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      ),
    ]);

    const after = await getRunEntryOrderState(runId, "en");
    expect(after!.allConfirmed).toBe(true);

    const context = (await getRunContext(runId))!;
    await db.transaction((tx) => startRun(tx, actor, runId, context.version));

    const started = (await getRunContext(runId))!;
    expect(started.status).toBe("IN_PROGRESS");
  });

  it("refuses to start a run while a country is still unreviewed", async () => {
    const { runId } = await setUp();
    const { getRunEntryOrderState, confirmCountryEntryOrder, startRun } = await import(
      "@/server/services/runs"
    );
    const { getRunContext } = await import("@/server/services/championships");

    const state = await getRunEntryOrderState(runId, "en");
    await db.transaction((tx) =>
      confirmCountryEntryOrder(tx, actor, {
        runId,
        championshipCountryId: state!.countries[0]!.championshipCountryId,
        decision: "NO_CHANGE",
      }),
    );

    const context = (await getRunContext(runId))!;
    await expect(
      db.transaction((tx) => startRun(tx, actor, runId, context.version)),
    ).rejects.toThrow(/must confirm its entry order/i);
  });

  it("lets a country be re-reviewed before the run starts, replacing its order", async () => {
    const { runId } = await setUp();
    const { getRunEntryOrderState, confirmCountryEntryOrder, getRunScoringState } = await import(
      "@/server/services/runs"
    );

    const state = await getRunEntryOrderState(runId, "en");
    const country = state!.countries[0]!;
    const active = country.roster
      .filter((member) => member.rosterSlot === "ACTIVE")
      .map((member) => member.championshipRiderId);

    await db.transaction((tx) =>
      confirmCountryEntryOrder(tx, actor, {
        runId,
        championshipCountryId: country.championshipCountryId,
        decision: "NO_CHANGE",
      }),
    );

    const reversed = [...active].reverse();
    await db.transaction((tx) =>
      confirmCountryEntryOrder(tx, actor, {
        runId,
        championshipCountryId: country.championshipCountryId,
        decision: "CHANGED",
        order: reversed,
      }),
    );

    const after = await getRunEntryOrderState(runId, "en");
    const updated = after!.countries.find(
      (entry) => entry.championshipCountryId === country.championshipCountryId,
    )!;
    expect(updated.confirmedOrder).toEqual(reversed);

    // Re-confirming replaces the empty score rows rather than duplicating them.
    const scoring = await getRunScoringState(runId, "en");
    const scored = scoring!.countries.find(
      (entry) => entry.championshipCountryId === country.championshipCountryId,
    )!;
    expect(scored.units).toHaveLength(4);
    expect(scored.units.map((unit) => unit.riders[0]!.championshipRiderId)).toEqual(reversed);
  });

  it("rejects a duplicate country in the same championship", async () => {
    const { championshipId, countryIds } = await setUp();
    const { championshipCountries } = await import("@/db/schema");

    await expect(
      db
        .insert(championshipCountries)
        .values({ championshipId, countryId: countryIds[0]!, orderIndex: 99 }),
    ).rejects.toThrow();
  });

  it("rejects a score outside the allowed set at the database level", async () => {
    const { runId } = await setUp();
    const { getRunEntryOrderState, confirmCountryEntryOrder, getRunScoringState } = await import(
      "@/server/services/runs"
    );
    const { runScoreTargets } = await import("@/db/schema");
    const { and, eq } = await import("drizzle-orm");

    const state = await getRunEntryOrderState(runId, "en");
    for (const country of state!.countries) {
      await db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: country.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      );
    }

    const scoring = await getRunScoringState(runId, "en");
    const scoreId = scoring!.countries[0]!.units[0]!.riders[0]!.runScoreId;

    await expect(
      db
        .update(runScoreTargets)
        .set({ points: "3.0" })
        .where(
          and(eq(runScoreTargets.runScoreId, scoreId), eq(runScoreTargets.targetIndex, 0)),
        ),
    ).rejects.toThrow();
  });

  it("rejects a squad that is not four active riders plus one reserve", async () => {
    const templateId = await createTemplate("Roster template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );
    const { countryIdByIso, createSquadRiders } = await import("../helpers/fixtures");

    const jordan = await countryIdByIso("JO");
    const oman = await countryIdByIso("OM");
    const jordanRiders = await createSquadRiders(jordan, "JO");
    const omanRiders = await createSquadRiders(oman, "OM");

    const goodSquad = (countryId: string, riderIds: readonly string[]) => ({
      countryId,
      riders: riderIds.map((riderId, index) => ({
        riderId,
        rosterSlot: index < 4 ? ("ACTIVE" as const) : ("RESERVE" as const),
        initialOrder: index < 4 ? index + 1 : null,
      })),
    });

    // Three active riders instead of four.
    await expect(
      db.transaction((tx) =>
        createChampionshipFromTemplate(tx, actor, {
          templateId,
          name: "Short squad",
          nameAr: null,
          startDate: "2026-09-18",
          location: "Amman",
          organizer: null,
          squads: [
            {
              countryId: jordan,
              riders: jordanRiders.slice(0, 4).map((riderId, index) => ({
                riderId,
                rosterSlot: index < 3 ? ("ACTIVE" as const) : ("RESERVE" as const),
                initialOrder: index < 3 ? index + 1 : null,
              })),
            },
            goodSquad(oman, omanRiders),
          ],
        }),
      ),
    ).rejects.toThrow(/exactly 4 active riders/i);

    // A single country is not a competition.
    await expect(
      db.transaction((tx) =>
        createChampionshipFromTemplate(tx, actor, {
          templateId,
          name: "Lonely championship",
          nameAr: null,
          startDate: "2026-09-18",
          location: "Amman",
          organizer: null,
          squads: [goodSquad(jordan, jordanRiders)],
        }),
      ),
    ).rejects.toThrow(/at least two/i);

    // A rider entered under a country they do not belong to.
    await expect(
      db.transaction((tx) =>
        createChampionshipFromTemplate(tx, actor, {
          templateId,
          name: "Borrowed rider",
          nameAr: null,
          startDate: "2026-09-18",
          location: "Amman",
          organizer: null,
          squads: [
            goodSquad(jordan, [...jordanRiders.slice(0, 4), omanRiders[0]!]),
            goodSquad(oman, omanRiders),
          ],
        }),
      ),
    ).rejects.toThrow(/not registered under this country/i);
  });

  it("keeps a rider registry name unique within a country", async () => {
    const { createRider } = await import("@/server/services/registry");
    const { countryIdByIso } = await import("../helpers/fixtures");
    const jordan = await countryIdByIso("JO");

    await db.transaction((tx) => createRider(tx, { countryId: jordan, fullName: "Sami Khalid" }));

    await expect(
      db.transaction((tx) =>
        createRider(tx, { countryId: jordan, fullName: "  sami   khalid  " }),
      ),
    ).rejects.toThrow(/already exists/i);

    // The same name under a different country is a different person.
    const oman = await countryIdByIso("OM");
    const created = await db.transaction((tx) =>
      createRider(tx, { countryId: oman, fullName: "Sami Khalid" }),
    );
    expect(created.fullName).toBe("Sami Khalid");
  });
});
