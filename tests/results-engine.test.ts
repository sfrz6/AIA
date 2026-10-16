import { describe, expect, it } from "vitest";
import { aggregateChampionship, buildStandings, type ConfirmedRun } from "@/domain/results";
import type { ScoringUnitInput } from "@/domain/scoring/engine";

const OMAN = "cc-oman";
const JORDAN = "cc-jordan";

const omanRiders = ["o1", "o2", "o3", "o4"];
const jordanRiders = ["j1", "j2", "j3", "j4"];

function individualUnits(
  countryId: string,
  riderIds: readonly string[],
  points: readonly number[],
  times: readonly number[],
): ScoringUnitInput[] {
  return riderIds.map((id, index) => ({
    unitIndex: index,
    championshipCountryId: countryId,
    timeSeconds: times[index] ?? 6,
    riders: [{ championshipRiderId: id, positionInUnit: 1, targets: [points[index] ?? 0] }],
  }));
}

function teamUnit(
  countryId: string,
  riderIds: readonly string[],
  points: readonly number[],
  time: number,
): ScoringUnitInput {
  return {
    unitIndex: 0,
    championshipCountryId: countryId,
    timeSeconds: time,
    riders: riderIds.map((id, index) => ({
      championshipRiderId: id,
      positionInUnit: index + 1,
      targets: [points[index] ?? 0],
    })),
  };
}

/**
 * A miniature day 1 modelled on the workbook: individual lance (own penalty),
 * pair lance and team lance (country penalty).
 */
const runs: ConfirmedRun[] = [
  {
    runId: "il-1",
    championshipEventId: "ev-il",
    eventType: "INDIVIDUAL_LANCE",
    dayNumber: 1,
    runNumber: 1,
    timeLimitSeconds: "6.40",
    units: [
      ...individualUnits(OMAN, omanRiders, [6, 4, 6, 0], [6.0, 7.4, 6.4, 6.0]),
      ...individualUnits(JORDAN, jordanRiders, [6, 6, 2, 4], [6.4, 6.4, 6.4, 6.4]),
    ],
  },
  {
    runId: "pl-1",
    championshipEventId: "ev-pl",
    eventType: "PAIR_LANCE",
    dayNumber: 1,
    runNumber: 1,
    timeLimitSeconds: "7.00",
    units: [
      {
        unitIndex: 0,
        championshipCountryId: OMAN,
        timeSeconds: 8.0, // 1 s over, -0.5
        riders: [
          { championshipRiderId: "o1", positionInUnit: 1, targets: [6] },
          { championshipRiderId: "o2", positionInUnit: 2, targets: [4] },
        ],
      },
      {
        unitIndex: 1,
        championshipCountryId: OMAN,
        timeSeconds: 7.0,
        riders: [
          { championshipRiderId: "o3", positionInUnit: 1, targets: [2] },
          { championshipRiderId: "o4", positionInUnit: 2, targets: [2] },
        ],
      },
      {
        unitIndex: 0,
        championshipCountryId: JORDAN,
        timeSeconds: 7.0,
        riders: [
          { championshipRiderId: "j1", positionInUnit: 1, targets: [6] },
          { championshipRiderId: "j2", positionInUnit: 2, targets: [6] },
        ],
      },
      {
        unitIndex: 1,
        championshipCountryId: JORDAN,
        timeSeconds: 7.0,
        riders: [
          { championshipRiderId: "j3", positionInUnit: 1, targets: [0] },
          { championshipRiderId: "j4", positionInUnit: 2, targets: [0] },
        ],
      },
    ],
  },
  {
    runId: "tl-1",
    championshipEventId: "ev-tl",
    eventType: "TEAM_LANCE",
    dayNumber: 1,
    runNumber: 1,
    timeLimitSeconds: "7.00",
    units: [
      teamUnit(OMAN, omanRiders, [6, 6, 6, 6], 7.0),
      teamUnit(JORDAN, jordanRiders, [2, 2, 2, 2], 11.0), // 4 s over, -2
    ],
  },
];

describe("championship aggregation", () => {
  const totals = aggregateChampionship(runs);

  it("adds the individual event net and the raw pair and team points per rider", () => {
    // o1: individual 6 (on time) + pair raw 6 + team raw 6 = 18
    expect(totals.riders.get("o1")!.overall.toString()).toBe("18");
    // o2: individual 4 - 0.5 = 3.5, + pair raw 4 + team raw 6 = 13.5
    expect(totals.riders.get("o2")!.overall.toString()).toBe("13.5");
    // o4: individual 0 + pair raw 2 + team raw 6 = 8
    expect(totals.riders.get("o4")!.overall.toString()).toBe("8");
  });

  it("keeps a per event breakdown", () => {
    expect(totals.riders.get("o2")!.byEvent.get("ev-il")!.toString()).toBe("3.5");
    expect(totals.riders.get("o2")!.byEvent.get("ev-pl")!.toString()).toBe("4");
    expect(totals.riders.get("o2")!.byEvent.get("ev-tl")!.toString()).toBe("6");
  });

  it("charges pair and team faults to the country, never to the rider", () => {
    const oman = totals.countries.get(OMAN)!;
    // 18 + 13.5 + (6 + 2 + 6) + (0 + 2 + 6) = 18 + 13.5 + 14 + 8 = 53.5
    expect(oman.riderPointsOverall.toString()).toBe("53.5");
    expect(oman.penaltiesOverall.toString()).toBe("-0.5");
    expect(oman.overall.toString()).toBe("53");

    const jordan = totals.countries.get(JORDAN)!;
    // riders: j1 6+6+2=14, j2 6+6+2=14, j3 2+0+2=4, j4 4+0+2=6 -> 38
    expect(jordan.riderPointsOverall.toString()).toBe("38");
    expect(jordan.penaltiesOverall.toString()).toBe("-2");
    expect(jordan.overall.toString()).toBe("36");
  });

  it("reports which days have results", () => {
    expect(totals.daysWithResults).toEqual([1]);
  });

  it("puts day one totals in the day one bucket and nothing elsewhere", () => {
    const oman = totals.countries.get(OMAN)!;
    expect(oman.byDay.get(1)!.toString()).toBe("53");
    expect(oman.byDay.has(2)).toBe(false);
  });
});

describe("standings from aggregated totals", () => {
  const totals = aggregateChampionship(runs);

  it("ranks countries by total", () => {
    const standings = buildStandings(totals, { scope: "OVERALL", subject: "COUNTRY" });
    expect(standings.map((s) => s.key)).toEqual([OMAN, JORDAN]);
    expect(standings[0]!.rank).toBe(1);
  });

  it("ranks individuals by total", () => {
    const standings = buildStandings(totals, { scope: "OVERALL", subject: "INDIVIDUAL" });
    expect(standings[0]!.key).toBe("o1");
    expect(standings[0]!.total.toString()).toBe("18");
  });

  it("includes competitors that have not scored, on zero", () => {
    const standings = buildStandings(totals, {
      scope: "OVERALL",
      subject: "INDIVIDUAL",
      includeKeys: ["reserve-never-rode"],
    });
    const reserve = standings.find((s) => s.key === "reserve-never-rode");
    expect(reserve).toBeDefined();
    expect(reserve!.total.toString()).toBe("0");
    expect(reserve!.rank).toBe(standings.length);
  });

  it("returns empty standings when no run is confirmed", () => {
    const empty = aggregateChampionship([]);
    expect(buildStandings(empty, { scope: "OVERALL", subject: "COUNTRY" })).toEqual([]);
    expect(empty.daysWithResults).toEqual([]);
  });

  it("applies a tie-break round to a tied group", () => {
    const tied = aggregateChampionship([
      {
        runId: "x",
        championshipEventId: "ev",
        eventType: "INDIVIDUAL_LANCE",
        dayNumber: 1,
        runNumber: 1,
        timeLimitSeconds: "6.40",
        units: [
          ...individualUnits(OMAN, ["a", "b"], [6, 6], [6, 6]),
        ],
      },
    ]);

    const withoutTieBreak = buildStandings(tied, { scope: "OVERALL", subject: "INDIVIDUAL" });
    expect(withoutTieBreak.every((s) => s.rank === 1)).toBe(true);

    const withTieBreak = buildStandings(tied, {
      scope: "OVERALL",
      subject: "INDIVIDUAL",
      tieBreak: {
        timeLimitSeconds: "6.40",
        maxPoints: "6",
        entries: [
          { key: "a", points: "6", timeSeconds: "6.30" },
          { key: "b", points: "6", timeSeconds: "6.10" },
        ],
      },
    });
    expect(withTieBreak[0]!.key).toBe("b");
    expect(withTieBreak[0]!.rank).toBe(1);
    expect(withTieBreak[1]!.rank).toBe(2);
  });
});
