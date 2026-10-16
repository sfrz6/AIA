import { describe, expect, it } from "vitest";
import {
  buildScoringUnits,
  inheritedEntryOrder,
  initialEntryOrder,
  ordersAreEqual,
  validateEntryOrder,
  type RosterMember,
} from "@/domain/entry-order";

const roster: RosterMember[] = [
  { championshipRiderId: "r3", rosterSlot: "ACTIVE", initialOrder: 3 },
  { championshipRiderId: "r1", rosterSlot: "ACTIVE", initialOrder: 1 },
  { championshipRiderId: "r4", rosterSlot: "ACTIVE", initialOrder: 4 },
  { championshipRiderId: "r2", rosterSlot: "ACTIVE", initialOrder: 2 },
  { championshipRiderId: "res", rosterSlot: "RESERVE", initialOrder: null },
];

describe("initial entry order", () => {
  it("uses the nominated order and excludes the reserve", () => {
    expect(initialEntryOrder(roster)).toEqual(["r1", "r2", "r3", "r4"]);
  });
});

describe("inherited entry order", () => {
  it("carries the previous run's order forward on no change", () => {
    expect(inheritedEntryOrder(["r2", "r1", "res", "r4"], roster)).toEqual([
      "r2",
      "r1",
      "res",
      "r4",
    ]);
  });

  it("falls back to the nominated order for the first run", () => {
    expect(inheritedEntryOrder(null, roster)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(inheritedEntryOrder([], roster)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("does not mutate the previous order", () => {
    const previous = ["r4", "r3", "r2", "r1"];
    const result = inheritedEntryOrder(previous, roster);
    expect(result).toEqual(previous);
    expect(previous).toEqual(["r4", "r3", "r2", "r1"]);
  });
});

describe("entry order validation", () => {
  it("accepts a rearrangement of the active riders", () => {
    expect(validateEntryOrder(roster, ["r4", "r1", "r3", "r2"])).toBeNull();
  });

  it("accepts the reserve substituted for an active rider", () => {
    expect(validateEntryOrder(roster, ["r1", "res", "r3", "r4"])).toBeNull();
  });

  it("rejects the wrong number of riders", () => {
    expect(validateEntryOrder(roster, ["r1", "r2", "r3"])?.code).toBe("WRONG_SIZE");
    expect(validateEntryOrder(roster, ["r1", "r2", "r3", "r4", "res"])?.code).toBe("WRONG_SIZE");
  });

  it("rejects a repeated rider", () => {
    expect(validateEntryOrder(roster, ["r1", "r1", "r3", "r4"])?.code).toBe("DUPLICATE_RIDER");
  });

  it("rejects a rider from another squad", () => {
    expect(validateEntryOrder(roster, ["r1", "r2", "r3", "other"])?.code).toBe("UNKNOWN_RIDER");
  });

  it("rejects a squad that is not fully nominated", () => {
    const short: RosterMember[] = [
      { championshipRiderId: "a", rosterSlot: "ACTIVE", initialOrder: 1 },
      { championshipRiderId: "b", rosterSlot: "ACTIVE", initialOrder: 2 },
    ];
    expect(validateEntryOrder(short, ["a", "b"])?.code).toBe("INCOMPLETE_ROSTER");
  });
});

describe("scoring units", () => {
  it("gives one unit per rider for individual events", () => {
    const units = buildScoringUnits(["r1", "r2", "r3", "r4"], 1);
    expect(units).toHaveLength(4);
    expect(units[0]).toEqual({
      unitIndex: 0,
      riders: [{ championshipRiderId: "r1", positionInUnit: 1 }],
    });
    expect(units[3]!.riders[0]!.championshipRiderId).toBe("r4");
  });

  it("pairs riders one with two and three with four", () => {
    const units = buildScoringUnits(["r1", "r2", "r3", "r4"], 2);
    expect(units).toHaveLength(2);
    expect(units[0]!.riders.map((r) => r.championshipRiderId)).toEqual(["r1", "r2"]);
    expect(units[1]!.riders.map((r) => r.championshipRiderId)).toEqual(["r3", "r4"]);
    expect(units[1]!.riders.map((r) => r.positionInUnit)).toEqual([1, 2]);
  });

  it("puts the whole squad in one unit for team and relay events", () => {
    const units = buildScoringUnits(["r1", "r2", "r3", "r4"], 4);
    expect(units).toHaveLength(1);
    expect(units[0]!.riders).toHaveLength(4);
    expect(units[0]!.riders.map((r) => r.positionInUnit)).toEqual([1, 2, 3, 4]);
  });

  it("follows the confirmed order, so a change of order changes the pairs", () => {
    const units = buildScoringUnits(["r3", "r4", "r1", "r2"], 2);
    expect(units[0]!.riders.map((r) => r.championshipRiderId)).toEqual(["r3", "r4"]);
    expect(units[1]!.riders.map((r) => r.championshipRiderId)).toEqual(["r1", "r2"]);
  });
});

describe("order comparison", () => {
  it("is sensitive to position", () => {
    expect(ordersAreEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(ordersAreEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(ordersAreEqual(["a"], ["a", "b"])).toBe(false);
  });
});
