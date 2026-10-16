import { describe, expect, it } from "vitest";
import { calculateStandings, scoreTieBreakRound } from "@/domain/scoring/standings";

describe("ranking without a tie-break", () => {
  it("ranks highest total first", () => {
    const standings = calculateStandings([
      { key: "a", total: "12" },
      { key: "b", total: "18" },
      { key: "c", total: "6" },
    ]);
    expect(standings.map((s) => s.key)).toEqual(["b", "a", "c"]);
    expect(standings.map((s) => s.rank)).toEqual([1, 2, 3]);
  });

  it("shares the rank on a tie and skips the following rank", () => {
    const standings = calculateStandings([
      { key: "a", total: "18" },
      { key: "b", total: "12" },
      { key: "c", total: "12" },
      { key: "d", total: "6" },
    ]);
    const byKey = new Map(standings.map((s) => [s.key, s]));
    expect(byKey.get("a")!.rank).toBe(1);
    expect(byKey.get("b")!.rank).toBe(2);
    expect(byKey.get("c")!.rank).toBe(2);
    expect(byKey.get("d")!.rank).toBe(4);
  });

  it("reports an unresolved tie", () => {
    const standings = calculateStandings([
      { key: "a", total: "12" },
      { key: "b", total: "12" },
    ]);
    expect(standings.every((s) => s.isTiedOnTotal)).toBe(true);
    expect(standings.every((s) => s.isTiedAfterTieBreak)).toBe(true);
  });

  it("compares decimal totals exactly", () => {
    const standings = calculateStandings([
      { key: "a", total: "17.5" },
      { key: "b", total: "17.50" },
      { key: "c", total: "17.51" },
    ]);
    const byKey = new Map(standings.map((s) => [s.key, s]));
    expect(byKey.get("c")!.rank).toBe(1);
    expect(byKey.get("a")!.rank).toBe(2);
    expect(byKey.get("b")!.rank).toBe(2);
  });

  it("returns an empty list for no entries", () => {
    expect(calculateStandings([])).toEqual([]);
  });
});

describe("tie-break round", () => {
  const round = {
    timeLimitSeconds: "6.40",
    maxPoints: "6",
    entries: [
      { key: "b", points: "6", timeSeconds: "6.20" },
      { key: "c", points: "6", timeSeconds: "6.10" },
    ],
  };

  it("scores the round with the standard time penalty", () => {
    const scored = scoreTieBreakRound({
      timeLimitSeconds: "6.40",
      maxPoints: "6",
      entries: [
        { key: "x", points: "6", timeSeconds: "6.40" },
        { key: "y", points: "6", timeSeconds: "7.40" },
        { key: "z", points: "2", timeSeconds: "30" },
      ],
    });
    expect(scored.get("x")!.netPoints.toString()).toBe("6");
    expect(scored.get("y")!.netPoints.toString()).toBe("5.5");
    expect(scored.get("z")!.netPoints.toString()).toBe("0");
  });

  it("splits a tied group and shifts the ranks below it unchanged", () => {
    const standings = calculateStandings(
      [
        { key: "a", total: "18" },
        { key: "b", total: "12" },
        { key: "c", total: "12" },
        { key: "d", total: "6" },
      ],
      { tieBreak: round },
    );
    const byKey = new Map(standings.map((s) => [s.key, s]));
    expect(byKey.get("a")!.rank).toBe(1);
    expect(byKey.get("c")!.rank).toBe(2); // faster time wins
    expect(byKey.get("b")!.rank).toBe(3);
    expect(byKey.get("d")!.rank).toBe(4);
    expect(byKey.get("c")!.isTiedAfterTieBreak).toBe(false);
  });

  it("prefers points over time", () => {
    const standings = calculateStandings(
      [
        { key: "b", total: "12" },
        { key: "c", total: "12" },
      ],
      {
        tieBreak: {
          timeLimitSeconds: "6.40",
          maxPoints: "6",
          entries: [
            { key: "b", points: "6", timeSeconds: "9.00" },
            { key: "c", points: "4", timeSeconds: "6.00" },
          ],
        },
      },
    );
    const byKey = new Map(standings.map((s) => [s.key, s]));
    // b keeps 6 - 1.5 = 4.5 against c's 4.
    expect(byKey.get("b")!.rank).toBe(1);
    expect(byKey.get("c")!.rank).toBe(2);
  });

  it("leaves the tie in place when the tie-break result is identical", () => {
    const standings = calculateStandings(
      [
        { key: "b", total: "12" },
        { key: "c", total: "12" },
      ],
      {
        tieBreak: {
          timeLimitSeconds: "6.40",
          maxPoints: "6",
          entries: [
            { key: "b", points: "6", timeSeconds: "6.20" },
            { key: "c", points: "6", timeSeconds: "6.20" },
          ],
        },
      },
    );
    expect(standings.every((s) => s.rank === 1)).toBe(true);
    expect(standings.every((s) => s.isTiedAfterTieBreak)).toBe(true);
  });

  it("keeps the base rank for a competitor missing from the tie-break", () => {
    const standings = calculateStandings(
      [
        { key: "a", total: "12" },
        { key: "b", total: "12" },
        { key: "c", total: "12" },
      ],
      {
        tieBreak: {
          timeLimitSeconds: "6.40",
          maxPoints: "6",
          entries: [
            { key: "a", points: "6", timeSeconds: "6.00" },
            { key: "b", points: "4", timeSeconds: "6.00" },
          ],
        },
      },
    );
    const byKey = new Map(standings.map((s) => [s.key, s]));
    expect(byKey.get("a")!.rank).toBe(1);
    expect(byKey.get("b")!.rank).toBe(2);
    expect(byKey.get("c")!.rank).toBe(1);
  });

  it("ignores tie-break entries for competitors that are not tied", () => {
    const standings = calculateStandings(
      [
        { key: "a", total: "18" },
        { key: "b", total: "12" },
      ],
      {
        tieBreak: {
          timeLimitSeconds: "6.40",
          maxPoints: "6",
          entries: [{ key: "b", points: "6", timeSeconds: "6.00" }],
        },
      },
    );
    expect(standings.map((s) => s.rank)).toEqual([1, 2]);
    expect(standings.every((s) => s.tieBreak === null)).toBe(true);
  });
});
