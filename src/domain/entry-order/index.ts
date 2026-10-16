import { RIDERS_PER_COUNTRY_PER_RUN } from "@/domain/scoring/event-types";

export interface RosterMember {
  readonly championshipRiderId: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  /** 1 to 4 for the riders nominated as active, null for the reserve. */
  readonly initialOrder: number | null;
}

export type EntryOrderDecision = "NO_CHANGE" | "CHANGED";

export interface EntryOrderValidationError {
  readonly code:
    | "WRONG_SIZE"
    | "DUPLICATE_RIDER"
    | "UNKNOWN_RIDER"
    | "INCOMPLETE_ROSTER";
  readonly message: string;
}

/**
 * The order a country starts the championship with.
 *
 * Taken from the nominated active riders, in the order the squad was entered.
 * The reserve is deliberately excluded: a reserve rides only when the operator
 * substitutes one in through an explicit entry order change.
 */
export function initialEntryOrder(roster: readonly RosterMember[]): readonly string[] {
  return roster
    .filter((member) => member.rosterSlot === "ACTIVE" && member.initialOrder !== null)
    .slice()
    .sort((a, b) => (a.initialOrder ?? 0) - (b.initialOrder ?? 0))
    .map((member) => member.championshipRiderId);
}

/**
 * The order a country carries into a run when the operator records "no change".
 *
 * `previousOrder` is the order confirmed for the most recent earlier run. When
 * there is none, because this is the country's first run, the squad's nominated
 * starting order is used instead.
 */
export function inheritedEntryOrder(
  previousOrder: readonly string[] | null,
  roster: readonly RosterMember[],
): readonly string[] {
  if (previousOrder && previousOrder.length > 0) return previousOrder;
  return initialEntryOrder(roster);
}

/**
 * Checks a proposed order against the country's championship roster.
 *
 * The order must name exactly the riders that will take part in the run, each
 * one once, and every one of them must belong to this country's squad. Any of
 * the squad's riders may appear, so substituting the reserve for an active
 * rider is expressed simply by naming the reserve in the order.
 */
export function validateEntryOrder(
  roster: readonly RosterMember[],
  proposed: readonly string[],
  ridersPerRun: number = RIDERS_PER_COUNTRY_PER_RUN,
): EntryOrderValidationError | null {
  const eligible = new Set(roster.map((member) => member.championshipRiderId));

  if (roster.filter((member) => member.rosterSlot === "ACTIVE").length < ridersPerRun) {
    return {
      code: "INCOMPLETE_ROSTER",
      message: `This country needs ${ridersPerRun} active riders before a run can be prepared.`,
    };
  }

  if (proposed.length !== ridersPerRun) {
    return {
      code: "WRONG_SIZE",
      message: `An entry order must name exactly ${ridersPerRun} riders.`,
    };
  }

  const seen = new Set<string>();
  for (const id of proposed) {
    if (!eligible.has(id)) {
      return { code: "UNKNOWN_RIDER", message: "A rider in this order is not in the squad." };
    }
    if (seen.has(id)) {
      return { code: "DUPLICATE_RIDER", message: "A rider appears twice in this order." };
    }
    seen.add(id);
  }

  return null;
}

export function ordersAreEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * Splits a confirmed entry order into the scoring units of one run.
 *
 * Individual events give one unit per rider, in riding order. Pair events give
 * two units: positions 1 and 2, then positions 3 and 4. Team and relay events
 * give a single unit holding all four riders. The index of a unit and the
 * position of a rider inside it are what the scoring engine and the printed
 * round sheet both key off, so they are derived here once.
 */
export function buildScoringUnits(
  order: readonly string[],
  ridersPerScoringUnit: number,
): ReadonlyArray<{ unitIndex: number; riders: ReadonlyArray<{ championshipRiderId: string; positionInUnit: number }> }> {
  const units: Array<{
    unitIndex: number;
    riders: Array<{ championshipRiderId: string; positionInUnit: number }>;
  }> = [];

  for (let index = 0; index < order.length; index += ridersPerScoringUnit) {
    const slice = order.slice(index, index + ridersPerScoringUnit);
    units.push({
      unitIndex: units.length,
      riders: slice.map((championshipRiderId, position) => ({
        championshipRiderId,
        positionInUnit: position + 1,
      })),
    });
  }

  return units;
}
