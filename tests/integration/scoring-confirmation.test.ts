import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hasTestDatabase, resetDatabase } from "../helpers/database";
import {
  createActor,
  createChampionshipFixture,
  createTemplate,
  listRunIds,
} from "../helpers/fixtures";
import type { Principal } from "@/lib/auth/session";
import type { RunScorePayload } from "@/server/services/runs";

const suite = hasTestDatabase ? describe : describe.skip;

suite("scoring, confirmation and correction", () => {
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

  /** Creates a one event championship and brings its first run to IN_PROGRESS. */
  async function openRun(
    eventType: "INDIVIDUAL_LANCE" | "TEAM_LANCE" | "PAIR_LANCE" | "RINGS_AND_PEG_LANCE",
  ) {
    const templateId = await createTemplate("Scoring template", [
      { dayNumber: 1, eventType, runs: 2 },
    ]);
    const fixture = await createChampionshipFixture({ actor, templateId });
    const runIds = await listRunIds(fixture.championshipId);
    const runId = runIds[0]!;

    const { getRunEntryOrderState, confirmCountryEntryOrder, startRun, getRunContext } =
      await import("@/server/services/runs").then(async (runs) => ({
        ...runs,
        getRunContext: (await import("@/server/services/championships")).getRunContext,
      }));

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

    let context = (await getRunContext(runId))!;
    await db.transaction((tx) => startRun(tx, actor, runId, context.version));
    context = (await getRunContext(runId))!;

    return { ...fixture, runId, runIds, version: context.version };
  }

  /** Fills every target and time of a run with the given values. */
  async function buildPayload(
    runId: string,
    points: number,
    timeSeconds: string,
  ): Promise<RunScorePayload> {
    const { getRunScoringState } = await import("@/server/services/runs");
    const state = await getRunScoringState(runId, "en");
    const units: RunScorePayload["units"][number][] = [];
    const scores: RunScorePayload["scores"][number][] = [];

    for (const country of state!.countries) {
      for (const unit of country.units) {
        units.push({ runScoringUnitId: unit.runScoringUnitId, timeSeconds });
        for (const rider of unit.riders) {
          scores.push({
            runScoreId: rider.runScoreId,
            targets: rider.targets.map(() => points),
          });
        }
      }
    }
    return { units, scores };
  }

  async function currentVersion(runId: string): Promise<number> {
    const { getRunContext } = await import("@/server/services/championships");
    return (await getRunContext(runId))!.version;
  }

  it("moves to review only once every score and time is recorded", async () => {
    const { runId, version } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, getRunScoringState } = await import("@/server/services/runs");

    const state = await getRunScoringState(runId, "en");
    const firstUnit = state!.countries[0]!.units[0]!;

    const partial = await db.transaction((tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: version,
        payload: {
          units: [{ runScoringUnitId: firstUnit.runScoringUnitId, timeSeconds: "6.00" }],
          scores: [{ runScoreId: firstUnit.riders[0]!.runScoreId, targets: [6] }],
        },
      }),
    );
    expect(partial.complete).toBe(false);
    expect(partial.status).toBe("IN_PROGRESS");

    const full = await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );
    expect(full.complete).toBe(true);
    expect(full.status).toBe("REVIEW");
  });

  it("refuses to confirm a run that is not fully scored", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { confirmRun } = await import("@/server/services/runs");

    await expect(
      db.transaction(async (tx) =>
        confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
      ),
    ).rejects.toThrow(/every score and time/i);
  });

  it("rejects a stale version rather than overwriting newer data", async () => {
    const { runId, version } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores } = await import("@/server/services/runs");

    await db.transaction((tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: version,
        payload: { units: [], scores: [] },
      }),
    );

    await expect(
      db.transaction((tx) =>
        saveRunScores(tx, actor, {
          runId,
          expectedVersion: version,
          payload: { units: [], scores: [] },
        }),
      ),
    ).rejects.toThrow(/changed by someone else/i);
  });

  it("rejects a score row that belongs to another run", async () => {
    const first = await openRun("INDIVIDUAL_LANCE");
    const { getRunScoringState, saveRunScores } = await import("@/server/services/runs");

    // The second run is the same event's Run 2: its entry order was already
    // carried over automatically once Run 1 (opened above) was confirmed.
    const otherRunId = first.runIds[1]!;
    const otherScoring = await getRunScoringState(otherRunId, "en");
    const foreignScoreId = otherScoring!.countries[0]!.units[0]!.riders[0]!.runScoreId;

    await expect(
      db.transaction(async (tx) =>
        saveRunScores(tx, actor, {
          runId: first.runId,
          expectedVersion: await currentVersion(first.runId),
          payload: { units: [], scores: [{ runScoreId: foreignScoreId, targets: [6] }] },
        }),
      ),
    ).rejects.toThrow(/does not match the run/i);
  });

  it("rejects a point value outside the allowed set", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, getRunScoringState } = await import("@/server/services/runs");
    const state = await getRunScoringState(runId, "en");
    const scoreId = state!.countries[0]!.units[0]!.riders[0]!.runScoreId;

    await expect(
      db.transaction(async (tx) =>
        saveRunScores(tx, actor, {
          runId,
          expectedVersion: await currentVersion(runId),
          payload: { units: [], scores: [{ runScoreId: scoreId, targets: [5] }] },
        }),
      ),
    ).rejects.toThrow(/0, 2, 4 or 6/);
  });

  it("only allows 0 or 6 for the two rings, but keeps the full 0/2/4/6 scale for the peg in the same run", async () => {
    const { runId } = await openRun("RINGS_AND_PEG_LANCE");
    const { saveRunScores, getRunScoringState } = await import("@/server/services/runs");
    const state = await getRunScoringState(runId, "en");
    const scoreId = state!.countries[0]!.units[0]!.riders[0]!.runScoreId;

    // A 4 on ring 2 (index 1) is rejected...
    await expect(
      db.transaction(async (tx) =>
        saveRunScores(tx, actor, {
          runId,
          expectedVersion: await currentVersion(runId),
          payload: { units: [], scores: [{ runScoreId: scoreId, targets: [6, 4, 6] }] },
        }),
      ),
    ).rejects.toThrow(/0 or 6/);

    // ...but the same 4 on the peg (index 2) is accepted.
    await expect(
      db.transaction(async (tx) =>
        saveRunScores(tx, actor, {
          runId,
          expectedVersion: await currentVersion(runId),
          payload: { units: [], scores: [{ runScoreId: scoreId, targets: [6, 0, 4] }] },
        }),
      ),
    ).resolves.toBeDefined();
  });

  it("keeps an unconfirmed run out of the results", async () => {
    const { runId, championshipId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores } = await import("@/server/services/runs");
    const { loadChampionshipResults } = await import("@/server/services/results");

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );

    const before = await loadChampionshipResults(championshipId, "en");
    expect(before.confirmedRunCount).toBe(0);
    expect(before.totals.riders.size).toBe(0);
  });

  it("publishes the run into the standings once it is confirmed", async () => {
    const { runId, championshipId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, confirmRun } = await import("@/server/services/runs");
    const { loadChampionshipResults } = await import("@/server/services/results");
    const { buildStandings } = await import("@/domain/results");

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );
    await db.transaction(async (tx) =>
      confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
    );

    const results = await loadChampionshipResults(championshipId, "en");
    expect(results.confirmedRunCount).toBe(1);
    expect(results.totals.riders.size).toBe(8);

    const standings = buildStandings(results.totals, {
      scope: "OVERALL",
      subject: "INDIVIDUAL",
    });
    expect(standings).toHaveLength(8);
    // Everyone scored 6 inside the time, so every competitor is tied on 6.
    expect(standings.every((entry) => entry.total.toString() === "6")).toBe(true);
    expect(standings.every((entry) => entry.rank === 1)).toBe(true);
  });

  it("charges a team time fault to the country and not to the riders", async () => {
    const { runId, championshipId } = await openRun("TEAM_LANCE");
    const { saveRunScores, confirmRun } = await import("@/server/services/runs");
    const { loadChampionshipResults } = await import("@/server/services/results");

    // The team limit is 7.00 s, so 9.00 s is 2 s over, costing 1 point.
    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "9.00"),
      }),
    );
    await db.transaction(async (tx) =>
      confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
    );

    const results = await loadChampionshipResults(championshipId, "en");
    const rider = [...results.totals.riders.values()][0]!;
    expect(rider.overall.toString()).toBe("6");

    const country = [...results.totals.countries.values()][0]!;
    expect(country.riderPointsOverall.toString()).toBe("24");
    expect(country.penaltiesOverall.toString()).toBe("-1");
    expect(country.overall.toString()).toBe("23");
  });

  it("requires a reason to correct a confirmed run and records a revision", async () => {
    const { runId, championshipId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, confirmRun, correctConfirmedRun, listRunRevisions } = await import(
      "@/server/services/runs"
    );
    const { loadChampionshipResults } = await import("@/server/services/results");

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );
    await db.transaction(async (tx) =>
      confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
    );

    const corrected = await buildPayload(runId, 2, "6.00");

    await expect(
      db.transaction(async (tx) =>
        correctConfirmedRun(tx, actor, {
          runId,
          expectedVersion: await currentVersion(runId),
          payload: corrected,
          reason: "   ",
        }),
      ),
    ).rejects.toThrow(/reason is required/i);

    await db.transaction(async (tx) =>
      correctConfirmedRun(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: corrected,
        reason: "Paper referee recorded a different score for every rider.",
      }),
    );

    const revisions = await listRunRevisions(runId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]!.revisionNumber).toBe(1);
    expect(revisions[0]!.changedByName).toBe(actor.name);
    expect(revisions[0]!.reason).toMatch(/paper referee/i);
    expect(JSON.stringify(revisions[0]!.beforeData)).toContain("6.0");
    expect(JSON.stringify(revisions[0]!.afterData)).toContain("2.0");

    // The standings follow the correction without any extra step.
    const results = await loadChampionshipResults(championshipId, "en");
    const rider = [...results.totals.riders.values()][0]!;
    expect(rider.overall.toString()).toBe("2");
  });

  it("refuses to score a confirmed run through the normal save path", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, confirmRun } = await import("@/server/services/runs");

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );
    await db.transaction(async (tx) =>
      confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
    );

    await expect(
      db.transaction(async (tx) =>
        saveRunScores(tx, actor, {
          runId,
          expectedVersion: await currentVersion(runId),
          payload: await buildPayload(runId, 0, "6.00"),
        }),
      ),
    ).rejects.toThrow(/correction workflow/i);
  });

  it("still allows the entry order to change after the run has started, as long as no score has been saved", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { confirmCountryEntryOrder, getRunEntryOrderState } = await import(
      "@/server/services/runs"
    );
    const state = await getRunEntryOrderState(runId, "en");

    await expect(
      db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: state!.countries[0]!.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("locks the entry order once a score has been saved for the run", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { confirmCountryEntryOrder, getRunEntryOrderState, saveRunScores } = await import(
      "@/server/services/runs"
    );

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );

    const state = await getRunEntryOrderState(runId, "en");

    await expect(
      db.transaction((tx) =>
        confirmCountryEntryOrder(tx, actor, {
          runId,
          championshipCountryId: state!.countries[0]!.championshipCountryId,
          decision: "NO_CHANGE",
        }),
      ),
    ).rejects.toThrow(/already been saved/i);
  });

  it("writes an audit entry for every official action", async () => {
    const { runId, championshipId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, confirmRun, correctConfirmedRun } = await import(
      "@/server/services/runs"
    );

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );
    await db.transaction(async (tx) =>
      confirmRun(tx, actor, { runId, expectedVersion: await currentVersion(runId) }),
    );
    await db.transaction(async (tx) =>
      correctConfirmedRun(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 4, "6.00"),
        reason: "Correction after the paper sheet was checked.",
      }),
    );

    const { auditLogs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const entries = await db
      .select({
        action: auditLogs.action,
        actorName: auditLogs.actorName,
        reason: auditLogs.reason,
      })
      .from(auditLogs)
      .where(eq(auditLogs.championshipId, championshipId));

    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain("CHAMPIONSHIP_CREATED");
    expect(actions).toContain("ENTRY_ORDER_CONFIRMED");
    expect(actions).toContain("RUN_STARTED");
    expect(actions).toContain("RUN_SCORES_SAVED");
    expect(actions).toContain("RUN_CONFIRMED");
    expect(actions).toContain("RUN_CORRECTED");

    const correction = entries.find((entry) => entry.action === "RUN_CORRECTED");
    expect(correction!.reason).toMatch(/paper sheet/i);
    expect(correction!.actorName).toBe(actor.name);
    expect(entries.every((entry) => !JSON.stringify(entry).includes("passwordHash"))).toBe(true);
  });

  it("rolls the whole confirmation back when any part of it fails", async () => {
    const { runId } = await openRun("INDIVIDUAL_LANCE");
    const { saveRunScores, confirmRun } = await import("@/server/services/runs");
    const { getRunContext } = await import("@/server/services/championships");
    const { auditLogs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    await db.transaction(async (tx) =>
      saveRunScores(tx, actor, {
        runId,
        expectedVersion: await currentVersion(runId),
        payload: await buildPayload(runId, 6, "6.00"),
      }),
    );

    const version = await currentVersion(runId);
    await expect(
      db.transaction(async (tx) => {
        await confirmRun(tx, actor, { runId, expectedVersion: version });
        throw new Error("simulated failure after the confirmation");
      }),
    ).rejects.toThrow(/simulated failure/);

    const context = await getRunContext(runId);
    expect(context!.status).toBe("REVIEW");
    expect(context!.confirmedAt).toBeNull();

    const audits = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.action, "RUN_CONFIRMED"));
    expect(audits).toHaveLength(0);
  });
});
