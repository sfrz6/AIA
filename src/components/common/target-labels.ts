import type { EventTypeKey } from "@/domain/scoring/event-types";
import type { Translator } from "@/lib/i18n";

/**
 * Column headings for the targets a rider attempts in one run.
 *
 * Rings and peg and lemons and peg have three named targets; every other event
 * has a single score. Used by both the scoring screen and the printed round
 * sheet so the two always read the same.
 */
export function targetLabels(
  eventType: EventTypeKey,
  targetsPerRider: number,
  t: Translator,
): readonly string[] {
  if (eventType === "RINGS_AND_PEG_LANCE" && targetsPerRider === 3) {
    return [t("runs.ringOne"), t("runs.ringTwo"), t("runs.peg")];
  }
  if (eventType === "LEMON_AND_PEG_SWORD" && targetsPerRider === 3) {
    return [t("runs.lemonOne"), t("runs.lemonTwo"), t("runs.peg")];
  }
  if (targetsPerRider === 1) return [t("common.points")];
  return Array.from({ length: targetsPerRider }, (_, index) => String(index + 1));
}
