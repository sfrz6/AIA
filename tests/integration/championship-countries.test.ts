import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hasTestDatabase, resetDatabase } from "../helpers/database";
import {
  createActor,
  createChampionshipFixture,
  createSquadRiders,
  createTemplate,
  clubIdByName,
  listRunIds,
} from "../helpers/fixtures";
import type { Principal } from "@/lib/auth/session";
import type { SquadInput } from "@/server/services/championship-setup";

const suite = hasTestDatabase ? describe : describe.skip;

suite("championship club order and optional squads", () => {
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

  async function fullSquad(clubId: string, prefix: string): Promise<SquadInput> {
    const riderIds = await createSquadRiders(clubId, prefix);
    return {
      clubId,
      riders: riderIds.map((riderId, index) => ({
        riderId,
        rosterSlot: index < 4 ? ("ACTIVE" as const) : ("RESERVE" as const),
        initialOrder: index < 4 ? index + 1 : null,
      })),
    };
  }

  it("assigns the club order from the order squads were submitted in, not alphabetically", async () => {
    const templateId = await createTemplate("Order template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    // Submitted in reverse alphabetical order: Pakistan, Oman, Jordan.
    const pakistan = await fullSquad(await clubIdByName("PK"), "PK");
    const oman = await fullSquad(await clubIdByName("OM"), "OM");
    const jordan = await fullSquad(await clubIdByName("JO"), "JO");

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

    const { listChampionshipClubs } = await import("@/server/services/championships");
    const listed = await listChampionshipClubs(created.id, "en");

    expect(listed.map((row) => row.name)).toEqual(["PK", "OM", "JO"]);
    expect(listed.map((row) => row.orderIndex)).toEqual([0, 1, 2]);
  });

  it("allows a club to be created with no riders selected yet", async () => {
    const templateId = await createTemplate("Optional riders template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    const jordan = await clubIdByName("JO");
    const oman = await fullSquad(await clubIdByName("OM"), "OM");

    const created = await db.transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        templateId,
        name: "Optional riders test",
        nameAr: null,
        startDate: "2026-09-18",
        location: "Amman",
        organizer: null,
        squads: [{ clubId: jordan, riders: [] }, oman],
      }),
    );

    const { listChampionshipClubs, listChampionshipRiders } = await import(
      "@/server/services/championships"
    );
    const clubs = await listChampionshipClubs(created.id, "en");
    const riders = await listChampionshipRiders(created.id, "en");

    expect(clubs).toHaveLength(2);
    const jordanParticipant = clubs.find((row) => row.name === "JO")!;
    expect(riders.filter((r) => r.championshipClubId === jordanParticipant.championshipClubId)).toHaveLength(0);
    const omanParticipant = clubs.find((row) => row.name === "OM")!;
    expect(riders.filter((r) => r.championshipClubId === omanParticipant.championshipClubId)).toHaveLength(5);
  });

  it("rejects a squad that is partially picked rather than empty or complete", async () => {
    const { validateSquad } = await import("@/server/services/championship-setup");

    expect(() => validateSquad({ clubId: "x", riders: [] })).not.toThrow();
    expect(() =>
      validateSquad({
        clubId: "x",
        riders: [{ riderId: "r1", rosterSlot: "ACTIVE", initialOrder: 1 }],
      }),
    ).toThrow(/exactly 4 active riders/i);
  });

  it("refuses the run's entry order while a club's squad is still empty", async () => {
    const templateId = await createTemplate("Empty squad run template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
    ]);
    const { createChampionshipFromTemplate } = await import(
      "@/server/services/championship-setup"
    );

    const jordan = await clubIdByName("JO");
    const oman = await fullSquad(await clubIdByName("OM"), "OM");

    const created = await db.transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        templateId,
        name: "Empty squad run test",
        nameAr: null,
        startDate: "2026-09-18",
        location: "Amman",
        organizer: null,
        squads: [{ clubId: jordan, riders: [] }, oman],
      }),
    );

    const runId = (await listRunIds(created.id))[0]!;
    const { getRunEntryOrderState, confirmClubEntryOrder } = await import(
      "@/server/services/runs"
    );
    const state = await getRunEntryOrderState(runId, "en");
    const jordanClub = state!.clubs.find((c) => c.clubName === "JO")!;

    await expect(
      db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId,
          championshipClubId: jordanClub.championshipClubId,
          decision: "NO_CHANGE",
        }),
      ),
    ).rejects.toThrow(/needs 4 active riders/i);
  });

  it("reorders clubs and reflects the new order everywhere clubs are listed", async () => {
    const { championshipId, clubIds } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Reorder template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
      clubNames: ["JO", "OM", "PK"],
    });

    const { listChampionshipClubs } = await import("@/server/services/championships");
    const { reorderChampionshipClubs } = await import(
      "@/server/services/championship-setup"
    );
    const { championshipClubs } = await import("@/db/schema");

    const before = await listChampionshipClubs(championshipId, "en");
    expect(before.map((row) => row.clubId)).toEqual(clubIds);

    // Reverse the order.
    const reversed = [...before].reverse().map((row) => row.championshipClubId);
    await db.transaction((tx) =>
      reorderChampionshipClubs(tx, actor, {
        championshipId,
        orderedChampionshipClubIds: reversed,
      }),
    );

    const after = await listChampionshipClubs(championshipId, "en");
    expect(after.map((row) => row.championshipClubId)).toEqual(reversed);
    expect(after.map((row) => row.orderIndex)).toEqual([0, 1, 2]);

    // The entry order screen for the first run picks up the new order too.
    const runId = (await listRunIds(championshipId))[0]!;
    const { getRunEntryOrderState } = await import("@/server/services/runs");
    const state = await getRunEntryOrderState(runId, "en");
    expect(state!.clubs.map((c) => c.championshipClubId)).toEqual(reversed);

    // No duplicate order_index was ever left behind.
    const rows = await db
      .select({ orderIndex: championshipClubs.orderIndex })
      .from(championshipClubs)
      .where(eq(championshipClubs.championshipId, championshipId));
    expect(new Set(rows.map((row) => row.orderIndex)).size).toBe(rows.length);
  });

  it("rejects a reorder whose clubs do not match the championship", async () => {
    const { championshipId } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Mismatch template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
    });
    const { reorderChampionshipClubs } = await import(
      "@/server/services/championship-setup"
    );

    await expect(
      db.transaction((tx) =>
        reorderChampionshipClubs(tx, actor, {
          championshipId,
          orderedChampionshipClubIds: ["00000000-0000-0000-0000-000000000099"],
        }),
      ),
    ).rejects.toThrow(/does not match this championship/i);
  });

  it("locks the club order once the championship's first run has started", async () => {
    const { championshipId } = await createChampionshipFixture({
      actor,
      templateId: await createTemplate("Lock template", [
        { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 1 },
      ]),
    });

    const { hasChampionshipStarted, reorderChampionshipClubs } = await import(
      "@/server/services/championship-setup"
    );
    const { listChampionshipClubs, getRunContext } = await import(
      "@/server/services/championships"
    );
    const { getRunEntryOrderState, confirmClubEntryOrder, startRun } = await import(
      "@/server/services/runs"
    );

    expect(await hasChampionshipStarted(championshipId)).toBe(false);

    const runId = (await listRunIds(championshipId))[0]!;
    const state = await getRunEntryOrderState(runId, "en");
    for (const club of state!.clubs) {
      await db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId,
          championshipClubId: club.championshipClubId,
          decision: "NO_CHANGE",
        }),
      );
    }

    // Still unlocked: entry orders confirmed, but the run has not started.
    expect(await hasChampionshipStarted(championshipId)).toBe(false);
    const clubs = await listChampionshipClubs(championshipId, "en");
    await db.transaction((tx) =>
      reorderChampionshipClubs(tx, actor, {
        championshipId,
        orderedChampionshipClubIds: [...clubs].reverse().map((c) => c.championshipClubId),
      }),
    );

    const context = (await getRunContext(runId))!;
    await db.transaction((tx) => startRun(tx, actor, runId, context.version));

    expect(await hasChampionshipStarted(championshipId)).toBe(true);

    const afterStart = await listChampionshipClubs(championshipId, "en");
    await expect(
      db.transaction((tx) =>
        reorderChampionshipClubs(tx, actor, {
          championshipId,
          orderedChampionshipClubIds: [...afterStart]
            .reverse()
            .map((c) => c.championshipClubId),
        }),
      ),
    ).rejects.toThrow(/already started/i);
  });
});
