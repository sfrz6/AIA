import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hasTestDatabase, resetDatabase } from "../helpers/database";
import {
  createActor,
  createChampionshipFixture,
  createSquadRiders,
  createTemplate,
  countryIdByIso,
  listRunIds,
} from "../helpers/fixtures";
import type { Principal } from "@/lib/auth/session";
import type { SquadInput } from "@/server/services/championship-setup";

const suite = hasTestDatabase ? describe : describe.skip;

suite("championship country order and optional squads", () => {
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

  async function fullSquad(countryId: string, prefix: string): Promise<SquadInput> {
    const riderIds = await createSquadRiders(countryId, prefix);
    return {
      countryId,
      riders: riderIds.map((riderId, index) => ({
        riderId,
        rosterSlot: index < 4 ? ("ACTIVE" as const) : ("RESERVE" as const),
        initialOrder: index < 4 ? index + 1 : null,
      })),
    };
  }

  it("assigns the country order from the order squads were submitted in, not alphabetically", async () => {
    const templateId = await createTemplate("Order template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    // Submitted in reverse alphabetical order: Pakistan, Oman, Jordan.
    const pakistan = await fullSquad(await countryIdByIso("PK"), "PK");
    const oman = await fullSquad(await countryIdByIso("OM"), "OM");
    const jordan = await fullSquad(await countryIdByIso("JO"), "JO");

    const created = await db.transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        templateId,
        name: "Order test",
        nameAr: null,
        startDate: "2026-09-18",
        location: "Amman",
        organizer: null,
        squads: [pakistan, oman, jordan],
      }),
    );

    const { listChampionshipCountries } = await import("@/server/services/championships");
    const listed = await listChampionshipCountries(created.id, "en");

    expect(listed.map((row) => row.iso2)).toEqual(["PK", "OM", "JO"]);
    expect(listed.map((row) => row.orderIndex)).toEqual([0, 1, 2]);
  });

  it("allows a country to be created with no riders selected yet", async () => {
    const templateId = await createTemplate("Optional riders template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    const jordan = await countryIdByIso("JO");
    const oman = await fullSquad(await countryIdByIso("OM"), "OM");

    const created = await db.transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        templateId,
        name: "Optional riders test",
        nameAr: null,
        startDate: "2026-09-18",
        location: "Amman",
        organizer: null,
        squads: [{ countryId: jordan, riders: [] }, oman],
      }),
    );

    const { listChampionshipCountries, listChampionshipRiders } = await import(
      "@/server/services/championships"
    );
    const countries = await listChampionshipCountries(created.id, "en");
    const riders = await listChampionshipRiders(created.id, "en");

    expect(countries).toHaveLength(2);
    const jordanParticipant = countries.find((row) => row.iso2 === "JO")!;
    expect(riders.filter((r) => r.championshipCountryId === jordanParticipant.championshipCountryId)).toHaveLength(0);
    const omanParticipant = countries.find((row) => row.iso2 === "OM")!;
    expect(riders.filter((r) => r.championshipCountryId === omanParticipant.championshipCountryId)).toHaveLength(5);
  });

  it("rejects a squad that is partially picked rather than empty or complete", async () => {
    const { validateSquad } = await import("@/server/services/championship-setup");

    expect(() => validateSquad({ countryId: "x", riders: [] })).not.toThrow();
    expect(() =>
      validateSquad({
        countryId: "x",
        riders: [{ riderId: "r1", rosterSlot: "ACTIVE", initialOrder: 1 }],
      }),
    ).toThrow(/exactly 4 active riders/i);
  });

  it("refuses the run's entry order while a country's squad is still empty", async () => {
    const templateId = await createTemplate("Empty squad run template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    const jordan = await countryIdByIso("JO");
    const oman = await fullSquad(await countryIdByIso("OM"), "OM");

    const created = await db.transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        templateId,
        name: "Empty squad run test",
        nameAr: null,
        startDate: "2026-09-18",
        location: "Amman",
        organizer: null,
        squads: [{ countryId: jordan, riders: [] }, oman],
      }),
    );

    const runId = (await listRunIds(created.id))[0]!;
    const { getRunEntryOrderState, confirmCountryEntryOrder } = await import(
      "@/server/services/runs"
    );
    const state = await getRunEntryOrderState(runId, "en");
    const jordanCountry = state!.countries.find((c) => c.iso2 === "JO")!;

    await expect(
      db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: jordanCountry.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      ),
    ).rejects.toThrow(/needs 4 active riders/i);
  });

  it("reorders countries and reflects the new order everywhere countries are listed", async () => {
    const { championshipId, countryIds } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Reorder template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
      isoCodes: ["JO", "OM", "PK"],
    });

    const { listChampionshipCountries } = await import("@/server/services/championships");
    const { reorderChampionshipCountries } = await import(
      "@/server/services/championship-setup"
    );
    const { championshipCountries } = await import("@/db/schema");

    const before = await listChampionshipCountries(championshipId, "en");
    expect(before.map((row) => row.countryId)).toEqual(countryIds);

    // Reverse the order.
    const reversed = [...before].reverse().map((row) => row.championshipCountryId);
    await db.transaction((tx) =>
      reorderChampionshipCountries(tx, actor, {
        championshipId,
        orderedChampionshipCountryIds: reversed,
      }),
    );

    const after = await listChampionshipCountries(championshipId, "en");
    expect(after.map((row) => row.championshipCountryId)).toEqual(reversed);
    expect(after.map((row) => row.orderIndex)).toEqual([0, 1, 2]);

    // The entry order screen for the first run picks up the new order too.
    const runId = (await listRunIds(championshipId))[0]!;
    const { getRunEntryOrderState } = await import("@/server/services/runs");
    const state = await getRunEntryOrderState(runId, "en");
    expect(state!.countries.map((c) => c.championshipCountryId)).toEqual(reversed);

    // No duplicate order_index was ever left behind.
    const rows = await db
      .select({ orderIndex: championshipCountries.orderIndex })
      .from(championshipCountries)
      .where(eq(championshipCountries.championshipId, championshipId));
    expect(new Set(rows.map((row) => row.orderIndex)).size).toBe(rows.length);
  });

  it("rejects a reorder whose countries do not match the championship", async () => {
    const { championshipId } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Mismatch template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
    });
    const { reorderChampionshipCountries } = await import(
      "@/server/services/championship-setup"
    );

    await expect(
      db.transaction((tx) =>
        reorderChampionshipCountries(tx, actor, {
          championshipId,
          orderedChampionshipCountryIds: ["00000000-0000-0000-0000-000000000099"],
        }),
      ),
    ).rejects.toThrow(/does not match this championship/i);
  });

  it("locks the country order once the championship's first run has started", async () => {
    const { championshipId } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Lock template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
    });

    const { hasChampionshipStarted, reorderChampionshipCountries } = await import(
      "@/server/services/championship-setup"
    );
    const { listChampionshipCountries, getRunContext } = await import(
      "@/server/services/championships"
    );
    const { getRunEntryOrderState, confirmCountryEntryOrder, startRun } = await import(
      "@/server/services/runs"
    );

    expect(await hasChampionshipStarted(championshipId)).toBe(false);

    const runId = (await listRunIds(championshipId))[0]!;
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

    // Still unlocked: entry orders confirmed, but the run has not started.
    expect(await hasChampionshipStarted(championshipId)).toBe(false);
    const countries = await listChampionshipCountries(championshipId, "en");
    await db.transaction((tx) =>
      reorderChampionshipCountries(tx, actor, {
        championshipId,
        orderedChampionshipCountryIds: [...countries].reverse().map((c) => c.championshipCountryId),
      }),
    );

    const context = (await getRunContext(runId))!;
    await db.transaction((tx) => startRun(tx, actor, runId, context.version));

    expect(await hasChampionshipStarted(championshipId)).toBe(true);

    const afterStart = await listChampionshipCountries(championshipId, "en");
    await expect(
      db.transaction((tx) =>
        reorderChampionshipCountries(tx, actor, {
          championshipId,
          orderedChampionshipCountryIds: [...afterStart]
            .reverse()
            .map((c) => c.championshipCountryId),
        }),
      ),
    ).rejects.toThrow(/already started/i);
  });
});
