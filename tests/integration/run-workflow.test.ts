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

suite("run workflow against a real database", () => {
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

  async function setUp(eventType: Parameters<typeof createTemplate>[1][number]["eventType"]) {
    const templateId = await createTemplate("Test template", [
      { dayNumber: 1, eventType, runs: 2 },
    ]);
    const fixture = await createChampionshipFixture({ actor, templateId });
    const runIds = await listRunIds(fixture.championshipId);
    return { ...fixture, runIds };
  }

  it("copies the template structure into the championship", async () => {
    const templateId = await createTemplate("Three day template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 2 },
      { dayNumber: 1, eventType: "TEAM_LANCE", runs: 3 },
      { dayNumber: 2, eventType: "INDIVIDUAL_SWORD", runs: 2 },
      { dayNumber: 3, eventType: "RELAY_LANCE", runs: 2 },
    ]);
    const { championshipId } = await createChampionshipFixture({ actor, templateId });

    const { getChampionshipDetail } = await import("@/server/services/championships");
    const detail = await getChampionshipDetail(championshipId);

    expect(detail).not.toBeNull();
    expect(detail!.days).toHaveLength(3);
    expect(detail!.days[0]!.events.map((event) => event.eventType)).toEqual([
      "INDIVIDUAL_LANCE",
      "TEAM_LANCE",
    ]);
    expect(detail!.days[0]!.events[1]!.runs).toHaveLength(3);
    expect(detail!.days[1]!.competitionDate).toBe("2026-09-19");
    expect(detail!.days[2]!.competitionDate).toBe("2026-09-20");
    expect(detail!.sourceTemplateName).toBe("Three day template");
  });

  it("leaves an existing championship untouched when the template changes", async () => {
    const templateId = await createTemplate("Editable template", [
      { dayNumber: 1, eventType: "INDIVIDUAL_LANCE", runs: 2 },
    ]);
    const { championshipId } = await createChampionshipFixture({ actor, templateId });

    const { templateRuns, templateEvents, championshipTemplates } = await import("@/db/schema");
    const { eq, sql } = await import("drizzle-orm");

    // Change the template completely: a different peg size and one fewer run.
    await db.update(templateRuns).set({ pegSizeCm: "2.0" }).where(sql`true`);
    await db.delete(templateEvents).where(sql`true`);
    await db
      .update(championshipTemplates)
      .set({ isArchived: true })
      .where(eq(championshipTemplates.id, templateId));

    const { getChampionshipDetail } = await import("@/server/services/championships");
    const detail = await getChampionshipDetail(championshipId);
    expect(detail!.days[0]!.events).toHaveLength(1);
    expect(detail!.days[0]!.events[0]!.runs).toHaveLength(2);
    expect(detail!.days[0]!.events[0]!.runs[0]!.pegSizeCm).toBe("6.0");
  });

  it("requires every club to confirm its entry order before the run can start", async () => {
    const { runIds, championshipId } = await setUp("INDIVIDUAL_LANCE");
    const runId = runIds[0]!;

    const { startRun, getRunEntryOrderState, confirmClubEntryOrder } = await import(
      "@/server/services/runs"
    );

    await expect(
      db.transaction((tx) => startRun(tx, actor, runId, 1)),
    ).rejects.toThrow(/entry order/i);

    const state = await getRunEntryOrderState(runId, "en");
    expect(state!.totalCount).toBe(2);
    expect(state!.allConfirmed).toBe(false);

    for (const club of state!.clubs) {
      await db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId,
          championshipClubId: club.championshipClubId,
          decision: "NO_CHANGE",
        }),
      );
    }

    const after = await getRunEntryOrderState(runId, "en");
    expect(after!.allConfirmed).toBe(true);
    expect(after!.run.status).toBe("READY");
    expect(championshipId).toBeTruthy();
  });

  it("uses the nominated order for the first run and carries it into later runs of the same event automatically", async () => {
    const { runIds } = await setUp("INDIVIDUAL_LANCE");
    const { getRunEntryOrderState, confirmClubEntryOrder } = await import(
      "@/server/services/runs"
    );

    const first = runIds[0]!;
    const second = runIds[1]!;
    const state = await getRunEntryOrderState(first, "en");
    const club = state!.clubs[0]!;
    const nominated = club.roster
      .filter((member) => member.rosterSlot === "ACTIVE")
      .sort((a, b) => (a.initialOrder ?? 0) - (b.initialOrder ?? 0))
      .map((member) => member.championshipRiderId);

    for (const participant of state!.clubs) {
      await db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId: first,
          championshipClubId: participant.championshipClubId,
          decision: "NO_CHANGE",
        }),
      );
    }

    const firstState = await getRunEntryOrderState(first, "en");
    expect(firstState!.clubs[0]!.confirmedOrder).toEqual(nominated);
    expect(firstState!.run.status).toBe("READY");

    // The second run of the same event is carried over automatically, with
    // no separate confirmation step, as soon as the first run is complete.
    const secondState = await getRunEntryOrderState(second, "en");
    const secondClub = secondState!.clubs.find(
      (entry) => entry.championshipClubId === club.championshipClubId,
    )!;
    expect(secondClub.confirmedOrder).toEqual(nominated);
    expect(secondClub.decision).toBe("NO_CHANGE");
    expect(secondState!.allConfirmed).toBe(true);
    expect(secondState!.run.status).toBe("READY");

    // The lineup can only change once per event: a direct attempt to change
    // the second run's order on its own is rejected.
    await expect(
      db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId: second,
          championshipClubId: club.championshipClubId,
          decision: "CHANGED",
          order: [nominated[3]!, nominated[2]!, nominated[1]!, nominated[0]!],
        }),
      ),
    ).rejects.toThrow(/once per event/i);

    // Re-confirming the first run with a genuinely different order (still
    // editable, since neither run has started scoring) replaces the order
    // carried into the second run too.
    const changed = [nominated[3]!, nominated[2]!, nominated[1]!, nominated[0]!];
    await db.transaction((tx) =>
      confirmClubEntryOrder(tx, actor, {
        runId: first,
        championshipClubId: club.championshipClubId,
        decision: "CHANGED",
        order: changed,
      }),
    );

    const secondAfterChange = await getRunEntryOrderState(second, "en");
    const secondClubAfterChange = secondAfterChange!.clubs.find(
      (entry) => entry.championshipClubId === club.championshipClubId,
    )!;
    expect(secondClubAfterChange.confirmedOrder).toEqual(changed);
  });

  it("allows the reserve to be substituted through a change of order", async () => {
    const { runIds } = await setUp("INDIVIDUAL_LANCE");
    const { getRunEntryOrderState, confirmClubEntryOrder } = await import(
      "@/server/services/runs"
    );

    const runId = runIds[0]!;
    const state = await getRunEntryOrderState(runId, "en");
    const club = state!.clubs[0]!;
    const active = club.roster.filter((member) => member.rosterSlot === "ACTIVE");
    const reserve = club.roster.find((member) => member.rosterSlot === "RESERVE")!;

    const order = [
      reserve.championshipRiderId,
      active[1]!.championshipRiderId,
      active[2]!.championshipRiderId,
      active[3]!.championshipRiderId,
    ];

    await db.transaction((tx) =>
      confirmClubEntryOrder(tx, actor, {
        runId,
        championshipClubId: club.championshipClubId,
        decision: "CHANGED",
        order,
      }),
    );

    const after = await getRunEntryOrderState(runId, "en");
    expect(after!.clubs[0]!.confirmedOrder).toEqual(order);
  });

  it("rejects an entry order that names a rider from another squad", async () => {
    const { runIds } = await setUp("INDIVIDUAL_LANCE");
    const { getRunEntryOrderState, confirmClubEntryOrder } = await import(
      "@/server/services/runs"
    );

    const runId = runIds[0]!;
    const state = await getRunEntryOrderState(runId, "en");
    const [first, second] = state!.clubs;
    const foreign = second!.roster[0]!.championshipRiderId;
    const own = first!.roster.filter((m) => m.rosterSlot === "ACTIVE").slice(0, 3);

    await expect(
      db.transaction((tx) =>
        confirmClubEntryOrder(tx, actor, {
          runId,
          championshipClubId: first!.championshipClubId,
          decision: "CHANGED",
          order: [...own.map((m) => m.championshipRiderId), foreign],
        }),
      ),
    ).rejects.toThrow(/not in the squad/i);
  });

  it("builds two pair units per club for a pair event", async () => {
    const { runIds } = await setUp("PAIR_LANCE");
    const { getRunEntryOrderState, confirmClubEntryOrder, getRunScoringState } = await import(
      "@/server/services/runs"
    );

    const runId = runIds[0]!;
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

    const scoring = await getRunScoringState(runId, "en");
    expect(scoring!.clubs).toHaveLength(2);
    for (const club of scoring!.clubs) {
      expect(club.units).toHaveLength(2);
      for (const unit of club.units) {
        expect(unit.riders).toHaveLength(2);
        expect(unit.riders.map((rider) => rider.positionInUnit)).toEqual([1, 2]);
      }
    }
  });

  it("builds one unit of four riders for a team event", async () => {
    const { runIds } = await setUp("TEAM_LANCE");
    const { getRunEntryOrderState, confirmClubEntryOrder, getRunScoringState } = await import(
      "@/server/services/runs"
    );

    const runId = runIds[0]!;
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

    const scoring = await getRunScoringState(runId, "en");
    for (const club of scoring!.clubs) {
      expect(club.units).toHaveLength(1);
      expect(club.units[0]!.riders).toHaveLength(4);
    }
  });
});
