import { Decimal } from "./decimal";

/**
 * How a scoring unit is formed and how its time penalty is attributed.
 *
 * INDIVIDUAL   one rider, one target per run, the rider rides against the clock
 *              and carries the penalty personally.
 * MULTI_TARGET one rider, several targets in a single pass (rings and peg,
 *              lemons and peg). The penalty is personal, like INDIVIDUAL.
 * PAIR         two riders ride together, one shared time, one shared penalty.
 * TEAM         four riders ride together, one shared time, one shared penalty.
 * RELAY        four riders in relay, one shared time, one shared penalty.
 *
 * For INDIVIDUAL and MULTI_TARGET the penalty reduces the rider's own score, so
 * it is already part of the rider's individual total. For PAIR, TEAM and RELAY
 * the penalty belongs to the country: the rider contributes raw points to the
 * individual standings and the penalty is applied once to the country total.
 * This mirrors the reference workbook exactly (see SCORING_AUDIT.md).
 */
export type ScoringRuleType = "INDIVIDUAL" | "MULTI_TARGET" | "PAIR" | "TEAM" | "RELAY";

/** Whether the penalty is carried by the rider or by the country. */
export type PenaltyAttribution = "RIDER" | "COUNTRY";

export type Discipline = "LANCE" | "SWORD";

export const EVENT_TYPE_KEYS = [
  "INDIVIDUAL_LANCE",
  "PAIR_LANCE",
  "TEAM_LANCE",
  "INDIVIDUAL_SWORD",
  "PAIR_SWORD",
  "TEAM_SWORD",
  "RINGS_AND_PEG_LANCE",
  "LEMON_AND_PEG_SWORD",
  "RELAY_LANCE",
  "RELAY_SWORD",
] as const;

export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number];

export interface EventTypeDefinition {
  readonly key: EventTypeKey;
  readonly ruleType: ScoringRuleType;
  readonly discipline: Discipline;
  /** Riders that form one scoring unit (one shared time). */
  readonly ridersPerScoringUnit: number;
  /** Scoring units fielded by each country in a single run. */
  readonly unitsPerCountry: number;
  /** Scoreable targets each rider attempts in one run. */
  readonly targetsPerRider: number;
  /** Default time limit in seconds before penalties start, from the workbook. */
  readonly defaultTimeLimitSeconds: string;
  /** Default peg sizes in centimetres, run by run, from the workbook. */
  readonly defaultPegSizesCm: readonly string[];
}

/** Riders each country fields in a run of any event in this system: 4 active. */
export const RIDERS_PER_COUNTRY_PER_RUN = 4;

/** Championship roster size per country: 4 active riders plus 1 reserve. */
export const ACTIVE_RIDERS_PER_COUNTRY = 4;
export const RESERVE_RIDERS_PER_COUNTRY = 1;

/** The only point values a referee may award for a single target. */
export const ALLOWED_TARGET_POINTS = [0, 2, 4, 6] as const;
export const MAX_POINTS_PER_TARGET = 6;

/** Time penalty step: half a point for every started second over the limit. */
export const PENALTY_PER_SECOND = "0.5";

const DEFINITIONS: Record<EventTypeKey, EventTypeDefinition> = {
  INDIVIDUAL_LANCE: {
    key: "INDIVIDUAL_LANCE",
    ruleType: "INDIVIDUAL",
    discipline: "LANCE",
    ridersPerScoringUnit: 1,
    unitsPerCountry: RIDERS_PER_COUNTRY_PER_RUN,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "6.40",
    defaultPegSizesCm: ["6", "4"],
  },
  INDIVIDUAL_SWORD: {
    key: "INDIVIDUAL_SWORD",
    ruleType: "INDIVIDUAL",
    discipline: "SWORD",
    ridersPerScoringUnit: 1,
    unitsPerCountry: RIDERS_PER_COUNTRY_PER_RUN,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "6.40",
    defaultPegSizesCm: ["6", "4"],
  },
  PAIR_LANCE: {
    key: "PAIR_LANCE",
    ruleType: "PAIR",
    discipline: "LANCE",
    ridersPerScoringUnit: 2,
    unitsPerCountry: 2,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4"],
  },
  PAIR_SWORD: {
    key: "PAIR_SWORD",
    ruleType: "PAIR",
    discipline: "SWORD",
    ridersPerScoringUnit: 2,
    unitsPerCountry: 2,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4"],
  },
  TEAM_LANCE: {
    key: "TEAM_LANCE",
    ruleType: "TEAM",
    discipline: "LANCE",
    ridersPerScoringUnit: RIDERS_PER_COUNTRY_PER_RUN,
    unitsPerCountry: 1,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4", "4"],
  },
  TEAM_SWORD: {
    key: "TEAM_SWORD",
    ruleType: "TEAM",
    discipline: "SWORD",
    ridersPerScoringUnit: RIDERS_PER_COUNTRY_PER_RUN,
    unitsPerCountry: 1,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4", "4"],
  },
  RINGS_AND_PEG_LANCE: {
    key: "RINGS_AND_PEG_LANCE",
    ruleType: "MULTI_TARGET",
    discipline: "LANCE",
    ridersPerScoringUnit: 1,
    unitsPerCountry: RIDERS_PER_COUNTRY_PER_RUN,
    targetsPerRider: 3,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4"],
  },
  LEMON_AND_PEG_SWORD: {
    key: "LEMON_AND_PEG_SWORD",
    ruleType: "MULTI_TARGET",
    discipline: "SWORD",
    ridersPerScoringUnit: 1,
    unitsPerCountry: RIDERS_PER_COUNTRY_PER_RUN,
    targetsPerRider: 3,
    defaultTimeLimitSeconds: "7.00",
    defaultPegSizesCm: ["6", "4"],
  },
  RELAY_LANCE: {
    key: "RELAY_LANCE",
    ruleType: "RELAY",
    discipline: "LANCE",
    ridersPerScoringUnit: RIDERS_PER_COUNTRY_PER_RUN,
    unitsPerCountry: 1,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "10.00",
    defaultPegSizesCm: ["6", "4"],
  },
  RELAY_SWORD: {
    key: "RELAY_SWORD",
    ruleType: "RELAY",
    discipline: "SWORD",
    ridersPerScoringUnit: RIDERS_PER_COUNTRY_PER_RUN,
    unitsPerCountry: 1,
    targetsPerRider: 1,
    defaultTimeLimitSeconds: "10.00",
    defaultPegSizesCm: ["6", "4"],
  },
};

export function getEventTypeDefinition(key: EventTypeKey): EventTypeDefinition {
  return DEFINITIONS[key];
}

export function isEventTypeKey(value: string): value is EventTypeKey {
  return Object.prototype.hasOwnProperty.call(DEFINITIONS, value);
}

/**
 * The point values a referee may award for one target in this event.
 *
 * Rings and peg, and lemons and peg, mix two kinds of target in the same
 * run: the ring (or lemon) itself is hit-or-miss, with no partial credit the
 * way a peg lance or sword thrust can score 2 or 4 — and that same run still
 * ends with an ordinary peg, which keeps the full scale. `targetIndex` is
 * the 0-based position within that rider's targets, matching `targetLabels`:
 * 0 and 1 are the two rings or lemons, 2 is the peg. Every other event's
 * target, at any index, keeps the full 0/2/4/6 scale.
 */
export function allowedTargetPoints(
  definition: EventTypeDefinition,
  targetIndex: number,
): readonly (typeof ALLOWED_TARGET_POINTS)[number][] {
  const isRingOrLemon =
    (definition.key === "RINGS_AND_PEG_LANCE" || definition.key === "LEMON_AND_PEG_SWORD") &&
    definition.targetsPerRider === 3 &&
    targetIndex < 2;
  return isRingOrLemon ? [0, 6] : ALLOWED_TARGET_POINTS;
}

export const ALL_EVENT_TYPES: readonly EventTypeDefinition[] = EVENT_TYPE_KEYS.map(
  (key) => DEFINITIONS[key],
);

export function penaltyAttributionOf(ruleType: ScoringRuleType): PenaltyAttribution {
  return ruleType === "INDIVIDUAL" || ruleType === "MULTI_TARGET" ? "RIDER" : "COUNTRY";
}

/**
 * Highest score a scoring unit can reach in one run. This is also the penalty
 * cap: the workbook caps the time penalty at exactly the unit's maximum score
 * (6 individual, 12 pair, 24 team and relay, 18 rings/lemons and peg).
 */
export function maxUnitPoints(definition: EventTypeDefinition): Decimal {
  return new Decimal(MAX_POINTS_PER_TARGET)
    .times(definition.targetsPerRider)
    .times(definition.ridersPerScoringUnit);
}

/**
 * Defaults for a tie-break round, called a round of draws in the reference
 * workbook, ridden at a reduced peg size to separate competitors or countries
 * that are level on points.
 *
 * The individual round follows the individual event rule exactly: a 6.4 second
 * limit and a 6 point cap. The country round uses a 7 second limit, and the
 * workbook caps its penalty at 6 points even though four riders take part,
 * where the main team events cap at 24. That is reproduced here because it is
 * consistent across all four summary sheets, and it is stored per round so an
 * official can change it if the federation confirms a different figure. See
 * SCORING_AUDIT.md, "Tie-break rounds".
 */
export const TIE_BREAK_DEFAULTS = {
  INDIVIDUAL: { pegSizeCm: "2.5", timeLimitSeconds: "6.40", maxPoints: "6" },
  COUNTRY: { pegSizeCm: "2.5", timeLimitSeconds: "7.00", maxPoints: "6" },
} as const;

/** Riders a country fields in a country tie-break round. */
export const TIE_BREAK_RIDERS_PER_COUNTRY = RIDERS_PER_COUNTRY_PER_RUN;
