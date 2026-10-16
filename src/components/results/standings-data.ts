import {
  buildStandings,
  scopeForDay,
  type ChampionshipTotals,
  type DayNumber,
  type StandingsScope,
  type StandingsSubject,
} from "@/domain/results";
import type { Standing } from "@/domain/scoring/standings";
import { formatPoints, type Decimal } from "@/domain/scoring/decimal";
import type { Translator } from "@/lib/i18n";
import type {
  ChampionshipParticipantDirectory,
  ChampionshipResults,
  StoredTieBreakRound,
  TieBreakKey,
} from "@/server/services/results";
import type { ChampionshipDayDetail } from "@/server/services/championships";

/**
 * Shapes the results engine output into plain, serialisable rows for the
 * internal and the public standings views.
 *
 * Every ranking number comes from `buildStandings` and every score is formatted
 * with `formatPoints` here, on the server, so no `Decimal` instance ever
 * crosses into a client component and no view ever computes a placing.
 */

const ALL_SCOPES: readonly StandingsScope[] = ["DAY_1", "DAY_2", "DAY_3", "OVERALL"];
const ALL_SUBJECTS: readonly StandingsSubject[] = ["INDIVIDUAL", "COUNTRY"];

/** Parses a scope from a URL segment, rejecting anything that isn't exactly one of the four. */
export function parseStandingsScope(value: string): StandingsScope | null {
  return (ALL_SCOPES as readonly string[]).includes(value) ? (value as StandingsScope) : null;
}

const SCOPE_LABEL_KEYS = {
  DAY_1: "results.day1",
  DAY_2: "results.day2",
  DAY_3: "results.day3",
  OVERALL: "results.overall",
} as const;

/**
 * Dictionary key for a scope, used by every standings view (on screen and
 * PDF, internal and public). Lives here rather than in `standings-table.tsx`
 * because that file is a client component: a server-rendered PDF page needs
 * to call this directly, which only works from a plain module.
 */
export function scopeLabelKey(scope: StandingsScope): (typeof SCOPE_LABEL_KEYS)[StandingsScope] {
  return SCOPE_LABEL_KEYS[scope];
}

/**
 * Shortens a rider's full name to first + last for the standings table,
 * where every extra word competes with a narrow, fixed-width column. Riders
 * are stored as one free-text name with no separate first/last fields, so
 * this is a word-split heuristic rather than a guaranteed-correct rule; a
 * name of two words or fewer already fits and passes through unchanged.
 * Round sheets, the entry order panel and the participants page all read
 * the rider's full name directly from their own data, not through here, so
 * only the standings table is affected.
 */
function shortenRiderName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export function dayOfScope(scope: StandingsScope): DayNumber | null {
  switch (scope) {
    case "DAY_1":
      return 1;
    case "DAY_2":
      return 2;
    case "DAY_3":
      return 3;
    default:
      return null;
  }
}

export function tieBreakKeyOf(scope: StandingsScope, subject: StandingsSubject): TieBreakKey {
  return `${scope}:${subject}`;
}

/** One day column of a standings row, already formatted. */
export interface StandingDayValue {
  readonly day: DayNumber;
  readonly value: string;
}

export interface StandingRow {
  /** Championship rider id for an individual row, championship country id for a country row. */
  readonly key: string;
  readonly rank: number;
  /** Rank from the totals alone, which also groups the members of a tie. */
  readonly baseRank: number;
  readonly isTiedAfterTieBreak: boolean;
  /** Rider name for an individual row, country name for a country row. */
  readonly name: string;
  readonly countryName: string;
  readonly iso2: string;
  readonly dayValues: readonly StandingDayValue[];
  /** Country rows only: the country's riders' points for this scope. */
  readonly riderPoints: string | null;
  /** Country rows only: pair, team and relay faults charged to the country. */
  readonly countryFaults: string | null;
  readonly total: string;
}

export interface StandingsSet {
  readonly scope: StandingsScope;
  readonly subject: StandingsSubject;
  readonly rows: readonly StandingRow[];
  /** True when at least one row still shares its final rank with another. */
  readonly hasUnresolvedTie: boolean;
}

export interface StandingsData {
  /** Days that have at least one confirmed run, in order. */
  readonly days: readonly DayNumber[];
  readonly sets: readonly StandingsSet[];
}

function dayValuesOf(
  days: readonly DayNumber[],
  valueOf: (day: DayNumber) => string,
): readonly StandingDayValue[] {
  return days.map((day) => ({ day, value: valueOf(day) }));
}

function buildSet(
  totals: ChampionshipTotals,
  directory: ChampionshipParticipantDirectory,
  tieBreak: StoredTieBreakRound | undefined,
  days: readonly DayNumber[],
  scope: StandingsScope,
  subject: StandingsSubject,
  t: Translator,
): StandingsSet {
  const includeKeys =
    subject === "INDIVIDUAL" ? [...directory.riders.keys()] : [...directory.countries.keys()];

  const standings = buildStandings(totals, {
    scope,
    subject,
    tieBreak,
    includeKeys,
  });

  const day = dayOfScope(scope);
  const unknown = t("common.unknown");

  const rows = standings.map<StandingRow>((standing) => {
    if (subject === "INDIVIDUAL") {
      const rider = directory.riders.get(standing.key);
      const riderTotals = totals.riders.get(standing.key);
      return {
        key: standing.key,
        rank: standing.rank,
        baseRank: standing.baseRank,
        isTiedAfterTieBreak: standing.isTiedAfterTieBreak,
        name: rider ? shortenRiderName(rider.riderName) : unknown,
        countryName: rider?.countryName ?? unknown,
        iso2: rider?.iso2 ?? "",
        dayValues: dayValuesOf(days, (value) =>
          formatPoints(riderTotals?.byDay.get(value) ?? 0),
        ),
        riderPoints: null,
        countryFaults: null,
        total: formatPoints(standing.total),
      };
    }

    const country = directory.countries.get(standing.key);
    const countryTotals = totals.countries.get(standing.key);
    const riderPoints =
      day === null
        ? countryTotals?.riderPointsOverall
        : countryTotals?.riderPointsByDay.get(day);
    const faults =
      day === null ? countryTotals?.penaltiesOverall : countryTotals?.penaltiesByDay.get(day);

    return {
      key: standing.key,
      rank: standing.rank,
      baseRank: standing.baseRank,
      isTiedAfterTieBreak: standing.isTiedAfterTieBreak,
      name: country?.countryName ?? unknown,
      countryName: country?.countryName ?? unknown,
      iso2: country?.iso2 ?? "",
      dayValues: dayValuesOf(days, (value) =>
        formatPoints(countryTotals?.byDay.get(value) ?? 0),
      ),
      riderPoints: formatPoints(riderPoints ?? 0),
      countryFaults: formatPoints(faults ?? 0),
      total: formatPoints(standing.total),
    };
  });

  return {
    scope,
    subject,
    rows,
    hasUnresolvedTie: rows.some((row) => row.isTiedAfterTieBreak),
  };
}

/** A tied group's identity within one scope: the shared total and the exact competitors in it. */
interface TiedGroup {
  readonly total: Decimal;
  readonly keys: ReadonlySet<string>;
}

function tiedGroupsOf(standings: readonly Standing[]): readonly TiedGroup[] {
  const byBaseRank = new Map<number, { total: Decimal; keys: Set<string> }>();
  for (const standing of standings) {
    if (!standing.isTiedOnTotal) continue;
    let group = byBaseRank.get(standing.baseRank);
    if (!group) {
      group = { total: standing.total, keys: new Set() };
      byBaseRank.set(standing.baseRank, group);
    }
    group.keys.add(standing.key);
  }
  return [...byBaseRank.values()];
}

function keysEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

/**
 * Finds the stored tie-break round that resolves a scope's unresolved ties.
 *
 * A round recorded for this exact scope always wins, unconditionally — same
 * as before cross-scope reuse existed. `calculateStandings` already matches
 * a round's entries to tied groups tolerantly (a round covering several
 * separate ties at once, or missing an entry because a rider withdrew from
 * the draw, both resolve whatever members it does cover and leave the rest
 * at their base rank), so this must not gate the direct case on an exact
 * key match — doing so previously rejected those two ordinary cases
 * entirely.
 *
 * Only when there is no round recorded for this scope at all does a round
 * from a *different* scope get reused, and only when that round's own tie —
 * the exact competitors, at the exact total they were tied at — matches one
 * of this scope's tied groups precisely. This is what lets a Day 1
 * tie-break also settle Overall while Day 1 is the only day played (the two
 * totals are identical), without ever misapplying an old decision to a
 * later, merely similar-looking tie once more days change the total.
 */
function findApplicableTieBreak(
  scope: StandingsScope,
  subject: StandingsSubject,
  groups: readonly TiedGroup[],
  tieBreaks: ReadonlyMap<TieBreakKey, StoredTieBreakRound>,
  rawByScope: ReadonlyMap<StandingsScope, readonly Standing[]>,
): StoredTieBreakRound | undefined {
  const direct = tieBreaks.get(tieBreakKeyOf(scope, subject));
  if (direct) return direct;

  for (const round of tieBreaks.values()) {
    if (round.subject !== subject || round.scope === scope) continue;
    const roundKeys = new Set(round.entries.map((entry) => entry.key));
    const sourceGroup = tiedGroupsOf(rawByScope.get(round.scope) ?? []).find((candidate) =>
      keysEqual(candidate.keys, roundKeys),
    );
    if (!sourceGroup) continue;
    if (groups.some((group) => sourceGroup.total.equals(group.total) && keysEqual(sourceGroup.keys, group.keys))) {
      return round;
    }
  }

  return undefined;
}

/** Builds every scope and subject combination from one load of the results. */
export function buildStandingsData(results: ChampionshipResults, t: Translator): StandingsData {
  const { totals, directory, tieBreaks } = results;
  const days = totals.daysWithResults;

  const sets: StandingsSet[] = [];
  for (const subject of ALL_SUBJECTS) {
    const includeKeys =
      subject === "INDIVIDUAL" ? [...directory.riders.keys()] : [...directory.countries.keys()];

    // Raw (no tie-break applied) standings per scope, needed to know what
    // total and which competitors each stored round was originally recorded
    // for, and what the current scope being built needs resolved.
    const rawByScope = new Map<StandingsScope, readonly Standing[]>(
      ALL_SCOPES.map((scope) => [scope, buildStandings(totals, { scope, subject, includeKeys })]),
    );

    for (const scope of ALL_SCOPES) {
      const unresolvedGroups = tiedGroupsOf(rawByScope.get(scope) ?? []);
      const tieBreak =
        unresolvedGroups.length > 0
          ? findApplicableTieBreak(scope, subject, unresolvedGroups, tieBreaks, rawByScope)
          : undefined;
      sets.push(buildSet(totals, directory, tieBreak, days, scope, subject, t));
    }
  }

  return { days, sets };
}

/** Scopes a view can offer: the days that have results, then the overall table. */
export function availableScopes(days: readonly DayNumber[]): readonly StandingsScope[] {
  return [...days.map(scopeForDay), "OVERALL"];
}

export interface TieBreakRiderOption {
  readonly championshipRiderId: string;
  readonly riderName: string;
}

/**
 * The four active riders of each country, which are the riders that take part
 * in a country tie-break round. The reserve never rides the draw.
 */
export function activeRidersByCountry(
  directory: ChampionshipParticipantDirectory,
): Readonly<Record<string, readonly TieBreakRiderOption[]>> {
  const result: Record<string, TieBreakRiderOption[]> = {};
  for (const country of directory.countries.keys()) result[country] = [];
  for (const rider of directory.riders.values()) {
    if (rider.rosterSlot !== "ACTIVE") continue;
    const bucket = result[rider.championshipCountryId];
    if (!bucket) continue;
    bucket.push({
      championshipRiderId: rider.championshipRiderId,
      riderName: rider.riderName,
    });
  }
  return result;
}

/** One stored tie-break result, flattened for prefilling the dialog. */
export interface StoredTieBreakEntry {
  readonly key: string;
  readonly points: number;
  readonly timeSeconds: string;
}

/**
 * Stored tie-break rounds keyed by `scope:subject`.
 *
 * A country round is stored as one total per country, because that is how the
 * reference workbook records the team round, so only its time can be prefilled
 * rider by rider.
 */
export function storedTieBreakEntries(
  tieBreaks: ReadonlyMap<TieBreakKey, StoredTieBreakRound>,
): Readonly<Record<string, readonly StoredTieBreakEntry[]>> {
  const result: Record<string, readonly StoredTieBreakEntry[]> = {};
  for (const [key, round] of tieBreaks) {
    result[key] = round.entries.map((entry) => ({
      key: entry.key,
      points: Number(entry.points),
      timeSeconds: String(entry.timeSeconds),
    }));
  }
  return result;
}

export interface PdfAvailability {
  /** Whether a PDF can be produced for each day, keyed by day number. */
  readonly byDay: ReadonlyMap<DayNumber, boolean>;
  /**
   * Whether a PDF can be produced for the Overall standings: every day that
   * has been touched at all is *fully* confirmed. A day nobody has started
   * yet never blocks it — the PDF simply covers the days played so far — but
   * a day that is only partway through blocks it, since "Overall so far"
   * would misrepresent a competition still mid-run.
   */
  readonly overall: boolean;
}

/**
 * Decides which standings PDFs can be produced right now, from the
 * championship's day/run structure alone (not the aggregated totals), so it
 * reflects schedule state even for a day with no confirmed runs at all.
 */
export function pdfAvailability(days: readonly ChampionshipDayDetail[]): PdfAvailability {
  const byDay = new Map<DayNumber, boolean>();
  let overall = false;
  let blocked = false;

  for (const day of days) {
    const runs = day.events.flatMap((event) => event.runs);
    const allConfirmed = runs.length > 0 && runs.every((run) => run.status === "CONFIRMED");
    const anyTouched = runs.some((run) => run.status !== "ENTRY_ORDER_PENDING");

    byDay.set(day.dayNumber as DayNumber, allConfirmed);

    if (allConfirmed) overall = true;
    else if (anyTouched) blocked = true;
  }

  return { byDay, overall: overall && !blocked };
}
