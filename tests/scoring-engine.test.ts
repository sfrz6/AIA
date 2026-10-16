import { describe, expect, it } from "vitest";
import { scoreRun, aggregateRuns, type RunScoringInput } from "@/domain/scoring/engine";
import { allowedTargetPoints, getEventTypeDefinition, maxUnitPoints } from "@/domain/scoring/event-types";
import { calculateTimePenalty } from "@/domain/scoring/penalty";

const OMAN = "country-oman";
const JORDAN = "country-jordan";

function individualRun(
  riders: Array<{ id: string; points: number | null; time: number | null }>,
  timeLimitSeconds = "6.40",
): RunScoringInput {
  return {
    eventTypeKey: "INDIVIDUAL_LANCE",
    timeLimitSeconds,
    units: riders.map((rider, index) => ({
      unitIndex: index,
      championshipCountryId: OMAN,
      timeSeconds: rider.time,
      riders: [{ championshipRiderId: rider.id, positionInUnit: 1, targets: [rider.points] }],
    })),
  };
}

describe("individual events", () => {
  it("applies the time penalty to the rider and never goes below zero", () => {
    const result = scoreRun(
      individualRun([
        { id: "r1", points: 6, time: 6.4 }, // exactly on the limit
        { id: "r2", points: 6, time: 6.41 }, // one started second over
        { id: "r3", points: 4, time: 7.4 }, // one full second over
        { id: "r4", points: 2, time: 20 }, // penalty capped by the zero floor
      ]),
    );

    const byId = new Map(result.riders.map((rider) => [rider.championshipRiderId, rider]));
    expect(byId.get("r1")!.netPoints.toString()).toBe("6");
    expect(byId.get("r2")!.netPoints.toString()).toBe("5.5");
    expect(byId.get("r3")!.netPoints.toString()).toBe("3.5");
    expect(byId.get("r4")!.netPoints.toString()).toBe("0");
  });

  it("charges half a point for every started second, not for completed seconds", () => {
    const result = scoreRun(
      individualRun([
        { id: "a", points: 6, time: 7.4 }, // exactly 1.00 s over
        { id: "b", points: 6, time: 7.41 }, // 1.01 s over
        { id: "c", points: 6, time: 8.4 }, // exactly 2.00 s over
      ]),
    );
    const byId = new Map(result.riders.map((rider) => [rider.championshipRiderId, rider]));
    expect(byId.get("a")!.netPoints.toString()).toBe("5.5");
    expect(byId.get("b")!.netPoints.toString()).toBe("5");
    expect(byId.get("c")!.netPoints.toString()).toBe("5");
  });

  it("is immune to binary floating point error at the limit boundary", () => {
    // 7.4 - 6.4 is 1.0000000000000009 in IEEE-754 double arithmetic, which
    // would round up to two started seconds and overcharge by half a point.
    const result = scoreRun(individualRun([{ id: "x", points: 6, time: 7.4 }]));
    expect(result.riders[0]!.netPoints.toString()).toBe("5.5");
  });

  it("caps the penalty at the event maximum before the zero floor", () => {
    const definition = getEventTypeDefinition("INDIVIDUAL_LANCE");
    const detail = calculateTimePenalty({
      timeSeconds: "60",
      timeLimitSeconds: "6.40",
      rawPoints: "6",
      maxUnitPoints: maxUnitPoints(definition),
    });
    expect(detail.penalty.toString()).toBe("-6");
    expect(detail.cappedByEventMaximum).toBe(true);
  });

  it("attributes no penalty to the country", () => {
    const result = scoreRun(individualRun([{ id: "r1", points: 6, time: 30 }]));
    expect(result.countries).toHaveLength(1);
    expect(result.countries[0]!.countryPenaltyTotal.toString()).toBe("0");
    expect(result.countries[0]!.total.toString()).toBe("0");
  });

  it("treats a missing score as zero and reports the run as incomplete", () => {
    const result = scoreRun(individualRun([{ id: "r1", points: null, time: 6 }]));
    expect(result.riders[0]!.rawPoints.toString()).toBe("0");
    expect(result.isComplete).toBe(false);
  });
});

describe("pair events", () => {
  const pairRun = (
    pairs: Array<{ riders: Array<{ id: string; points: number }>; time: number }>,
  ): RunScoringInput => ({
    eventTypeKey: "PAIR_LANCE",
    timeLimitSeconds: "7.00",
    units: pairs.map((pair, index) => ({
      unitIndex: index,
      championshipCountryId: OMAN,
      timeSeconds: pair.time,
      riders: pair.riders.map((rider, position) => ({
        championshipRiderId: rider.id,
        positionInUnit: position + 1,
        targets: [rider.points],
      })),
    })),
  });

  it("keeps the pair penalty off the riders and on the country", () => {
    const result = scoreRun(
      pairRun([
        {
          riders: [
            { id: "p1", points: 6 },
            { id: "p2", points: 4 },
          ],
          time: 9.5, // 2.5 s over, 3 started seconds, penalty -1.5
        },
      ]),
    );

    const byId = new Map(result.riders.map((rider) => [rider.championshipRiderId, rider]));
    expect(byId.get("p1")!.individualContribution.toString()).toBe("6");
    expect(byId.get("p2")!.individualContribution.toString()).toBe("4");

    expect(result.units[0]!.penalty.toString()).toBe("-1.5");
    expect(result.countries[0]!.riderPointsTotal.toString()).toBe("10");
    expect(result.countries[0]!.countryPenaltyTotal.toString()).toBe("-1.5");
    expect(result.countries[0]!.total.toString()).toBe("8.5");
  });

  it("floors the pair penalty at the pair's combined points", () => {
    const result = scoreRun(
      pairRun([
        {
          riders: [
            { id: "p1", points: 2 },
            { id: "p2", points: 0 },
          ],
          time: 40,
        },
      ]),
    );
    expect(result.units[0]!.penalty.toString()).toBe("-2");
    expect(result.units[0]!.netPoints.toString()).toBe("0");
    // The riders still carry their raw points into the individual standings.
    expect(result.riders[0]!.individualContribution.toString()).toBe("2");
    expect(result.countries[0]!.total.toString()).toBe("0");
  });

  it("caps the pair penalty at twelve points", () => {
    const result = scoreRun(
      pairRun([
        {
          riders: [
            { id: "p1", points: 6 },
            { id: "p2", points: 6 },
          ],
          time: 100,
        },
      ]),
    );
    expect(result.units[0]!.penalty.toString()).toBe("-12");
    expect(result.units[0]!.netPoints.toString()).toBe("0");
  });

  it("sums both pairs of a country", () => {
    const result = scoreRun(
      pairRun([
        {
          riders: [
            { id: "p1", points: 6 },
            { id: "p2", points: 6 },
          ],
          time: 8, // 1 s over, -0.5
        },
        {
          riders: [
            { id: "p3", points: 4 },
            { id: "p4", points: 2 },
          ],
          time: 7, // on the limit
        },
      ]),
    );
    expect(result.countries[0]!.riderPointsTotal.toString()).toBe("18");
    expect(result.countries[0]!.countryPenaltyTotal.toString()).toBe("-0.5");
    expect(result.countries[0]!.total.toString()).toBe("17.5");
  });
});

describe("team and relay events", () => {
  const teamRun = (
    eventTypeKey: "TEAM_LANCE" | "RELAY_LANCE",
    points: number[],
    time: number,
  ): RunScoringInput => ({
    eventTypeKey,
    timeLimitSeconds: getEventTypeDefinition(eventTypeKey).defaultTimeLimitSeconds,
    units: [
      {
        unitIndex: 0,
        championshipCountryId: JORDAN,
        timeSeconds: time,
        riders: points.map((value, index) => ({
          championshipRiderId: `t${index + 1}`,
          positionInUnit: index + 1,
          targets: [value],
        })),
      },
    ],
  });

  it("applies one shared penalty for the whole team", () => {
    const result = scoreRun(teamRun("TEAM_LANCE", [6, 6, 4, 2], 10)); // 3 s over
    expect(result.units[0]!.rawPoints.toString()).toBe("18");
    expect(result.units[0]!.penalty.toString()).toBe("-1.5");
    expect(result.countries[0]!.total.toString()).toBe("16.5");
    for (const rider of result.riders) {
      expect(rider.individualContribution.equals(rider.rawPoints)).toBe(true);
    }
  });

  it("caps the team penalty at twenty four points", () => {
    const result = scoreRun(teamRun("TEAM_LANCE", [6, 6, 6, 6], 200));
    expect(result.units[0]!.penalty.toString()).toBe("-24");
    expect(result.countries[0]!.total.toString()).toBe("0");
  });

  it("uses the ten second relay limit", () => {
    const onLimit = scoreRun(teamRun("RELAY_LANCE", [6, 6, 6, 6], 10));
    expect(onLimit.units[0]!.penalty.toString()).toBe("0");
    const over = scoreRun(teamRun("RELAY_LANCE", [6, 6, 6, 6], 10.01));
    expect(over.units[0]!.penalty.toString()).toBe("-0.5");
  });
});

describe("rings and peg, lemons and peg", () => {
  const multiRun = (targets: number[], time: number): RunScoringInput => ({
    eventTypeKey: "RINGS_AND_PEG_LANCE",
    timeLimitSeconds: "7.00",
    units: [
      {
        unitIndex: 0,
        championshipCountryId: OMAN,
        timeSeconds: time,
        riders: [{ championshipRiderId: "m1", positionInUnit: 1, targets }],
      },
    ],
  });

  it("sums the three targets before applying the rider's penalty", () => {
    const result = scoreRun(multiRun([6, 4, 2], 9)); // 2 s over, -1
    expect(result.riders[0]!.rawPoints.toString()).toBe("12");
    expect(result.riders[0]!.netPoints.toString()).toBe("11");
    expect(result.countries[0]!.countryPenaltyTotal.toString()).toBe("0");
  });

  it("caps the penalty at eighteen points", () => {
    const result = scoreRun(multiRun([6, 6, 6], 500));
    expect(result.riders[0]!.netPoints.toString()).toBe("0");
    expect(result.units[0]!.penalty.toString()).toBe("-18");
  });

  it("only allows 0 or 6 for the two rings or lemons, but keeps the full scale for the peg in the same run", () => {
    const rings = getEventTypeDefinition("RINGS_AND_PEG_LANCE");
    const lemons = getEventTypeDefinition("LEMON_AND_PEG_SWORD");
    expect(allowedTargetPoints(rings, 0)).toEqual([0, 6]); // ring 1
    expect(allowedTargetPoints(rings, 1)).toEqual([0, 6]); // ring 2
    expect(allowedTargetPoints(rings, 2)).toEqual([0, 2, 4, 6]); // peg
    expect(allowedTargetPoints(lemons, 0)).toEqual([0, 6]); // lemon 1
    expect(allowedTargetPoints(lemons, 1)).toEqual([0, 6]); // lemon 2
    expect(allowedTargetPoints(lemons, 2)).toEqual([0, 2, 4, 6]); // peg

    const individual = getEventTypeDefinition("INDIVIDUAL_LANCE");
    const team = getEventTypeDefinition("TEAM_SWORD");
    expect(allowedTargetPoints(individual, 0)).toEqual([0, 2, 4, 6]);
    expect(allowedTargetPoints(team, 0)).toEqual([0, 2, 4, 6]);
  });

  it("matches the workbook inside the 36 to 43 second anomaly window", () => {
    // The workbook caps at -18 only past 43 s over, so between 36 s and 43 s it
    // computes a penalty beyond -18. The zero floor makes both readings equal,
    // which this case pins down.
    const result = scoreRun(multiRun([6, 6, 6], 7 + 40));
    expect(result.riders[0]!.netPoints.toString()).toBe("0");
    const justUnder = scoreRun(multiRun([6, 4, 2], 7 + 40));
    expect(justUnder.riders[0]!.netPoints.toString()).toBe("0");
  });
});

describe("aggregating runs into an event", () => {
  it("adds rider contributions and country penalties across runs", () => {
    const run1 = scoreRun({
      eventTypeKey: "TEAM_SWORD",
      timeLimitSeconds: "7.00",
      units: [
        {
          unitIndex: 0,
          championshipCountryId: JORDAN,
          timeSeconds: 8,
          riders: [
            { championshipRiderId: "a", positionInUnit: 1, targets: [6] },
            { championshipRiderId: "b", positionInUnit: 2, targets: [4] },
          ],
        },
      ],
    });
    const run2 = scoreRun({
      eventTypeKey: "TEAM_SWORD",
      timeLimitSeconds: "7.00",
      units: [
        {
          unitIndex: 0,
          championshipCountryId: JORDAN,
          timeSeconds: 7,
          riders: [
            { championshipRiderId: "a", positionInUnit: 1, targets: [2] },
            { championshipRiderId: "b", positionInUnit: 2, targets: [6] },
          ],
        },
      ],
    });

    const aggregate = aggregateRuns([run1, run2]);
    expect(aggregate.riderTotals.get("a")!.toString()).toBe("8");
    expect(aggregate.riderTotals.get("b")!.toString()).toBe("10");
    expect(aggregate.countryRiderTotals.get(JORDAN)!.toString()).toBe("18");
    expect(aggregate.countryPenaltyTotals.get(JORDAN)!.toString()).toBe("-0.5");
  });
});
