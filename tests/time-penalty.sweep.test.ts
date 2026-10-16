import { describe, expect, it } from "vitest";
import { Decimal } from "@/domain/scoring/decimal";
import { calculateTimePenalty } from "@/domain/scoring/penalty";
import {
  ALLOWED_TARGET_POINTS,
  EVENT_TYPE_KEYS,
  getEventTypeDefinition,
  maxUnitPoints,
} from "@/domain/scoring/event-types";

/**
 * The exact constants the workbook uses per event: the excess past which the
 * formula returns a fixed cap, and that cap.
 *
 * `capExcess` is twice `capPenalty` for every event except the two peg events,
 * where the workbook says 43 rather than 36. That discrepancy is anomaly A1 in
 * SCORING_AUDIT.md and is reproduced faithfully here, so the sweep would fail
 * if the implementation and the workbook ever disagreed on a reachable input.
 */
const WORKBOOK: Record<string, { limit: string; capExcess: number; capPenalty: number }> = {
  INDIVIDUAL_LANCE: { limit: "6.40", capExcess: 12, capPenalty: 6 },
  INDIVIDUAL_SWORD: { limit: "6.40", capExcess: 12, capPenalty: 6 },
  PAIR_LANCE: { limit: "7.00", capExcess: 24, capPenalty: 12 },
  PAIR_SWORD: { limit: "7.00", capExcess: 24, capPenalty: 12 },
  TEAM_LANCE: { limit: "7.00", capExcess: 48, capPenalty: 24 },
  TEAM_SWORD: { limit: "7.00", capExcess: 48, capPenalty: 24 },
  RINGS_AND_PEG_LANCE: { limit: "7.00", capExcess: 43, capPenalty: 18 },
  LEMON_AND_PEG_SWORD: { limit: "7.00", capExcess: 43, capPenalty: 18 },
  RELAY_LANCE: { limit: "10.00", capExcess: 48, capPenalty: 24 },
  RELAY_SWORD: { limit: "10.00", capExcess: 48, capPenalty: 24 },
};

/** Excel's CEILING(value, -0.5) for a value at or below zero. */
function excelCeilingToNegativeHalf(value: Decimal): Decimal {
  return value.dividedBy("-0.5").ceil().times("-0.5");
}

/** A literal transcription of the workbook formula, in exact arithmetic. */
function workbookPenalty(
  time: Decimal,
  limit: Decimal,
  rawPoints: Decimal,
  capExcess: number,
  capPenalty: number,
): Decimal {
  const excess = time.minus(limit);
  let inner: Decimal;
  if (excess.lessThanOrEqualTo(0)) {
    inner = new Decimal(0);
  } else if (excess.greaterThan(capExcess)) {
    inner = new Decimal(capPenalty).negated();
  } else {
    inner = excelCeilingToNegativeHalf(new Decimal("-0.5").times(excess));
  }
  return inner.lessThan(rawPoints.negated()) ? rawPoints.negated() : inner;
}

/** Deterministic pseudo random source, so a failure is always reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

describe("randomised parity sweep against the workbook formula", () => {
  it("agrees for every event across ten thousand random reachable inputs", () => {
    const random = makeRandom(20260918);
    const mismatches: string[] = [];

    for (const key of EVENT_TYPE_KEYS) {
      const definition = getEventTypeDefinition(key);
      const constants = WORKBOOK[key]!;
      const limit = new Decimal(constants.limit);
      const unitMaximum = maxUnitPoints(definition);
      const targetsPerUnit = definition.targetsPerRider * definition.ridersPerScoringUnit;

      for (let sample = 0; sample < 1000; sample += 1) {
        // A reachable raw score: the sum of real target awards for the unit.
        let rawPoints = new Decimal(0);
        for (let target = 0; target < targetsPerUnit; target += 1) {
          const award =
            ALLOWED_TARGET_POINTS[Math.floor(random() * ALLOWED_TARGET_POINTS.length)]!;
          rawPoints = rawPoints.plus(award);
        }

        // Times are recorded to two decimals, from well inside the limit to far
        // beyond every cap.
        const seconds = new Decimal(Math.floor(random() * 7000) / 100);

        const expected = workbookPenalty(
          seconds,
          limit,
          rawPoints,
          constants.capExcess,
          constants.capPenalty,
        );
        const actual = calculateTimePenalty({
          timeSeconds: seconds,
          timeLimitSeconds: limit,
          rawPoints,
          maxUnitPoints: unitMaximum,
        }).penalty;

        if (!actual.equals(expected)) {
          mismatches.push(
            `${key} time=${seconds.toFixed(2)} raw=${rawPoints.toString()} expected=${expected.toString()} actual=${actual.toString()}`,
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("never lets a penalty push a score below zero or above the event cap", () => {
    const random = makeRandom(7);
    for (const key of EVENT_TYPE_KEYS) {
      const definition = getEventTypeDefinition(key);
      const unitMaximum = maxUnitPoints(definition);
      const limit = new Decimal(WORKBOOK[key]!.limit);

      for (let sample = 0; sample < 200; sample += 1) {
        const rawPoints = new Decimal(Math.floor(random() * (unitMaximum.toNumber() / 2 + 1)) * 2);
        const seconds = new Decimal(Math.floor(random() * 20000) / 100);
        const { penalty } = calculateTimePenalty({
          timeSeconds: seconds,
          timeLimitSeconds: limit,
          rawPoints,
          maxUnitPoints: unitMaximum,
        });

        expect(penalty.lessThanOrEqualTo(0)).toBe(true);
        expect(rawPoints.plus(penalty).greaterThanOrEqualTo(0)).toBe(true);
        expect(penalty.greaterThanOrEqualTo(unitMaximum.negated())).toBe(true);
        // Penalties always land on a half point step.
        expect(penalty.times(2).isInteger()).toBe(true);
      }
    }
  });

  it("charges for started seconds, not completed ones, at every boundary", () => {
    const limit = new Decimal("6.40");
    const cases: Array<[string, string]> = [
      ["6.40", "0"],
      ["6.41", "-0.5"],
      ["7.40", "-0.5"],
      ["7.41", "-1"],
      ["8.40", "-1"],
      ["8.41", "-1.5"],
    ];
    for (const [time, expected] of cases) {
      const { penalty } = calculateTimePenalty({
        timeSeconds: time,
        timeLimitSeconds: limit,
        rawPoints: "6",
        maxUnitPoints: "6",
      });
      expect(`${time} -> ${penalty.toString()}`).toBe(`${time} -> ${expected}`);
    }
  });
});
