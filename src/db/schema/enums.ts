import { pgEnum } from "drizzle-orm/pg-core";
import { EVENT_TYPE_KEYS } from "@/domain/scoring/event-types";
import { PERMISSIONS } from "@/domain/permissions";

export const permissionEnum = pgEnum("permission", PERMISSIONS);

export const eventTypeEnum = pgEnum("event_type", EVENT_TYPE_KEYS);

/** Roster slot a rider occupies in one championship, for one country. */
export const rosterSlotEnum = pgEnum("roster_slot", ["ACTIVE", "RESERVE"]);

/**
 * Run lifecycle.
 *
 * ENTRY_ORDER_PENDING  at least one country has not confirmed its entry order
 * READY                every country confirmed, the round sheet can be printed
 * IN_PROGRESS          the operator is recording scores
 * REVIEW               scoring is complete and awaiting the final check
 * CONFIRMED            the run is official and counts towards the standings
 */
export const runStatusEnum = pgEnum("run_status", [
  "ENTRY_ORDER_PENDING",
  "READY",
  "IN_PROGRESS",
  "REVIEW",
  "CONFIRMED",
]);

export const championshipStatusEnum = pgEnum("championship_status", [
  "DRAFT",
  "ACTIVE",
  "COMPLETED",
]);

/** The operator's explicit decision about a country's order before a run. */
export const entryOrderDecisionEnum = pgEnum("entry_order_decision", ["NO_CHANGE", "CHANGED"]);

/** What a set of standings ranks. */
export const standingsScopeEnum = pgEnum("standings_scope", ["DAY_1", "DAY_2", "DAY_3", "OVERALL"]);

export const standingsSubjectEnum = pgEnum("standings_subject", ["INDIVIDUAL", "COUNTRY"]);
