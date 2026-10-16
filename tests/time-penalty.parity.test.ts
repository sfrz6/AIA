import { describe, expect, it } from "vitest";
import fixtures from "./fixtures/time-penalty.excel.json" with { type: "json" };
import { Decimal } from "@/domain/scoring/decimal";
import { calculateTimePenalty } from "@/domain/scoring/penalty";
import {
  getEventTypeDefinition,
  isEventTypeKey,
  maxUnitPoints,
} from "@/domain/scoring/event-types";

interface ParityRow {
  eventTypeKey: string;
  timeLimitSeconds: string;
  timeSeconds: string;
  rawPoints: string;
  expectedPenalty: string;
  expectedNet: string;
}

const rows = fixtures as ParityRow[];

/**
 * Every row is produced by a literal transcription of the workbook formula,
 * including the per-event cap constants. See SCORING_AUDIT.md for the mapping
 * from each sheet to the constants used here.
 */
describe("time penalty parity with the reference workbook", () => {
  it("covers every event type", () => {
    const covered = new Set(rows.map((row) => row.eventTypeKey));
    expect(covered.size).toBe(10);
  });

  it("has a meaningful number of fixture rows", () => {
    expect(rows.length).toBeGreaterThan(1000);
  });

  for (const row of rows) {
    const label = `${row.eventTypeKey} time=${row.timeSeconds} raw=${row.rawPoints}`;
    it(`matches Excel for ${label}`, () => {
      expect(isEventTypeKey(row.eventTypeKey)).toBe(true);
      if (!isEventTypeKey(row.eventTypeKey)) return;
      const definition = getEventTypeDefinition(row.eventTypeKey);

      const result = calculateTimePenalty({
        timeSeconds: row.timeSeconds,
        timeLimitSeconds: row.timeLimitSeconds,
        rawPoints: row.rawPoints,
        maxUnitPoints: maxUnitPoints(definition),
      });

      expect(result.penalty.toString()).toBe(new Decimal(row.expectedPenalty).toString());
      expect(result.penalty.plus(row.rawPoints).toString()).toBe(
        new Decimal(row.expectedNet).toString(),
      );
    });
  }
});
