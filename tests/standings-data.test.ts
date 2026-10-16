import { describe, expect, it } from "vitest";
import { dec, ZERO } from "@/domain/scoring/decimal";
import type { ChampionshipTotals, CountryTotals, DayNumber } from "@/domain/results";
import type { Decimal } from "@/domain/scoring/decimal";
import { buildStandingsData, pdfAvailability } from "@/components/results/standings-data";
import type {
  ChampionshipParticipantDirectory,
  ChampionshipResults,
  StoredTieBreakRound,
  TieBreakKey,
} from "@/server/services/results";
import type { ChampionshipDayDetail, ChampionshipRunDetail } from "@/server/services/championships";
import type { Translator } from "@/lib/i18n";

const t: Translator = ((key: string) => key) as Translator;

function countryTotals(dayOneTotal: number, hasDayTwo: boolean): CountryTotals {
  const byDay = new Map<DayNumber, Decimal>([[1, dec(dayOneTotal)]]);
  if (hasDayTwo) byDay.set(2, dec(5));
  const overall = hasDayTwo ? dec(dayOneTotal).plus(5) : dec(dayOneTotal);
  return {
    championshipCountryId: "placeholder",
    riderPointsByDay: byDay,
    penaltiesByDay: new Map(),
    byDay,
    riderPointsOverall: overall,
    penaltiesOverall: ZERO,
    overall,
  };
}

function directoryOf(countryIds: readonly string[]): ChampionshipParticipantDirectory {
  const countries = new Map(
    countryIds.map((id) => [
      id,
      { championshipCountryId: id, iso2: id.slice(0, 2).toUpperCase(), iso3: "XXX", countryName: id },
    ]),
  );
  return { riders: new Map(), countries };
}

describe("buildStandingsData — cross-scope tie-break reuse", () => {
  it("applies an Overall tie-break to Day 1 when Day 1 is the only day played and the totals match exactly", () => {
    const totals: ChampionshipTotals = {
      riders: new Map(),
      countries: new Map([
        ["a", { ...countryTotals(100, false), championshipCountryId: "a" }],
        ["b", { ...countryTotals(100, false), championshipCountryId: "b" }],
        ["c", { ...countryTotals(50, false), championshipCountryId: "c" }],
      ]),
      runResults: new Map(),
      daysWithResults: [1],
    };

    const tieBreaks = new Map<TieBreakKey, StoredTieBreakRound>([
      [
        "OVERALL:COUNTRY",
        {
          id: "round-1",
          scope: "OVERALL",
          subject: "COUNTRY",
          pegSizeCm: "4",
          timeLimitSeconds: 10,
          maxPoints: 6,
          entries: [
            { key: "a", points: 6, timeSeconds: 8 },
            { key: "b", points: 4, timeSeconds: 8 },
          ],
        },
      ],
    ]);

    const results: ChampionshipResults = {
      totals,
      directory: directoryOf(["a", "b", "c"]),
      tieBreaks,
      confirmedRunCount: 1,
    };

    const { sets } = buildStandingsData(results, t);

    const day1Countries = sets.find((set) => set.scope === "DAY_1" && set.subject === "COUNTRY")!;
    const overallCountries = sets.find((set) => set.scope === "OVERALL" && set.subject === "COUNTRY")!;

    // Overall resolves directly, as before.
    expect(overallCountries.hasUnresolvedTie).toBe(false);
    const overallA = overallCountries.rows.find((row) => row.key === "a")!;
    const overallB = overallCountries.rows.find((row) => row.key === "b")!;
    expect(overallA.rank).toBe(1);
    expect(overallB.rank).toBe(2);

    // Day 1 — which was never directly given a tie-break round — is resolved
    // too, because its tie is identical (same two countries, same total) to
    // the one Overall's round was recorded for.
    expect(day1Countries.hasUnresolvedTie).toBe(false);
    const day1A = day1Countries.rows.find((row) => row.key === "a")!;
    const day1B = day1Countries.rows.find((row) => row.key === "b")!;
    expect(day1A.rank).toBe(1);
    expect(day1B.rank).toBe(2);
  });

  it("does not reuse a tie-break once a later day changes the Overall total away from Day 1's", () => {
    const totals: ChampionshipTotals = {
      riders: new Map(),
      countries: new Map([
        ["a", { ...countryTotals(100, true), championshipCountryId: "a" }],
        ["b", { ...countryTotals(100, false), championshipCountryId: "b" }],
        ["c", { ...countryTotals(50, false), championshipCountryId: "c" }],
      ]),
      runResults: new Map(),
      daysWithResults: [1, 2],
    };

    // Recorded for Day 1's tie (a vs b, both at 100). Country "a" has since
    // scored more on Day 2, so Overall is no longer the same tie.
    const tieBreaks = new Map<TieBreakKey, StoredTieBreakRound>([
      [
        "DAY_1:COUNTRY",
        {
          id: "round-1",
          scope: "DAY_1",
          subject: "COUNTRY",
          pegSizeCm: "4",
          timeLimitSeconds: 10,
          maxPoints: 6,
          entries: [
            { key: "a", points: 6, timeSeconds: 8 },
            { key: "b", points: 4, timeSeconds: 8 },
          ],
        },
      ],
    ]);

    const results: ChampionshipResults = {
      totals,
      directory: directoryOf(["a", "b", "c"]),
      tieBreaks,
      confirmedRunCount: 1,
    };

    const { sets } = buildStandingsData(results, t);

    const day1Countries = sets.find((set) => set.scope === "DAY_1" && set.subject === "COUNTRY")!;
    const overallCountries = sets.find((set) => set.scope === "OVERALL" && set.subject === "COUNTRY")!;

    // Day 1's own round still resolves Day 1 directly.
    expect(day1Countries.hasUnresolvedTie).toBe(false);

    // Overall is a different, untied situation now (a: 105, b: 100), so no
    // tie exists there at all — nothing to misapply the old round to.
    expect(overallCountries.hasUnresolvedTie).toBe(false);
    const overallA = overallCountries.rows.find((row) => row.key === "a")!;
    const overallB = overallCountries.rows.find((row) => row.key === "b")!;
    expect(overallA.rank).toBe(1);
    expect(overallB.rank).toBe(2);
  });
});

function run(status: ChampionshipRunDetail["status"]): ChampionshipRunDetail {
  return { id: "r", runNumber: 1, pegSizeCm: "4", timeLimitSeconds: "7", status, version: 1 };
}

function dayOf(dayNumber: number, statuses: readonly ChampionshipRunDetail["status"][]): ChampionshipDayDetail {
  return {
    id: `day-${dayNumber}`,
    dayNumber,
    competitionDate: "2026-01-01",
    events: [{ id: `event-${dayNumber}`, eventType: "INDIVIDUAL_LANCE", orderIndex: 1, runs: statuses.map(run) }],
  };
}

describe("pdfAvailability", () => {
  it("allows Day 1 and Overall once Day 1 is fully confirmed and Day 2 has not started", () => {
    const days = [dayOf(1, ["CONFIRMED", "CONFIRMED"]), dayOf(2, ["ENTRY_ORDER_PENDING", "ENTRY_ORDER_PENDING"])];
    const result = pdfAvailability(days);
    expect(result.byDay.get(1)).toBe(true);
    expect(result.byDay.get(2)).toBe(false);
    expect(result.overall).toBe(true);
  });

  it("blocks Overall while a day is only partially confirmed", () => {
    const days = [dayOf(1, ["CONFIRMED", "CONFIRMED"]), dayOf(2, ["CONFIRMED", "IN_PROGRESS"])];
    const result = pdfAvailability(days);
    expect(result.byDay.get(1)).toBe(true);
    expect(result.byDay.get(2)).toBe(false);
    expect(result.overall).toBe(false);
  });

  it("allows Overall again once the previously in-progress day is also fully confirmed", () => {
    const days = [dayOf(1, ["CONFIRMED", "CONFIRMED"]), dayOf(2, ["CONFIRMED", "CONFIRMED"])];
    const result = pdfAvailability(days);
    expect(result.byDay.get(2)).toBe(true);
    expect(result.overall).toBe(true);
  });

  it("allows neither Day 1 nor Overall before the championship starts", () => {
    const days = [dayOf(1, ["ENTRY_ORDER_PENDING"])];
    const result = pdfAvailability(days);
    expect(result.byDay.get(1)).toBe(false);
    expect(result.overall).toBe(false);
  });
});

describe("buildStandingsData — a direct tie-break round always applies", () => {
  it("resolves two separate ties in the same scope from one combined round", () => {
    // Country standings: {a,b} tied at 100, {d,e} tied at 80, c alone at 50.
    // The tie-break dialog groups every tied row in a scope into one round,
    // so this round's entries cover both pairs at once.
    const totals: ChampionshipTotals = {
      riders: new Map(),
      countries: new Map([
        ["a", { ...countryTotals(100, false), championshipCountryId: "a" }],
        ["b", { ...countryTotals(100, false), championshipCountryId: "b" }],
        ["c", { ...countryTotals(50, false), championshipCountryId: "c" }],
        ["d", { ...countryTotals(80, false), championshipCountryId: "d" }],
        ["e", { ...countryTotals(80, false), championshipCountryId: "e" }],
      ]),
      runResults: new Map(),
      daysWithResults: [1],
    };

    const tieBreaks = new Map<TieBreakKey, StoredTieBreakRound>([
      [
        "DAY_1:COUNTRY",
        {
          id: "round-1",
          scope: "DAY_1",
          subject: "COUNTRY",
          pegSizeCm: "4",
          timeLimitSeconds: 10,
          maxPoints: 6,
          entries: [
            { key: "a", points: 6, timeSeconds: 8 },
            { key: "b", points: 4, timeSeconds: 8 },
            { key: "d", points: 6, timeSeconds: 8 },
            { key: "e", points: 4, timeSeconds: 8 },
          ],
        },
      ],
    ]);

    const results: ChampionshipResults = {
      totals,
      directory: directoryOf(["a", "b", "c", "d", "e"]),
      tieBreaks,
      confirmedRunCount: 1,
    };

    const { sets } = buildStandingsData(results, t);
    const day1Countries = sets.find((set) => set.scope === "DAY_1" && set.subject === "COUNTRY")!;

    expect(day1Countries.hasUnresolvedTie).toBe(false);
    const rankOf = (key: string) => day1Countries.rows.find((row) => row.key === key)!.rank;
    expect(rankOf("a")).toBeLessThan(rankOf("b"));
    expect(rankOf("d")).toBeLessThan(rankOf("e"));
  });

  it("still resolves the countries a round does cover when one tied country is missing from it", () => {
    // Three-way tie {a,b,g} at 100; g withdrew from the draw, so the saved
    // round (matching the tie-break dialog's own behaviour) only has
    // entries for a and b.
    const totals: ChampionshipTotals = {
      riders: new Map(),
      countries: new Map([
        ["a", { ...countryTotals(100, false), championshipCountryId: "a" }],
        ["b", { ...countryTotals(100, false), championshipCountryId: "b" }],
        ["g", { ...countryTotals(100, false), championshipCountryId: "g" }],
      ]),
      runResults: new Map(),
      daysWithResults: [1],
    };

    const tieBreaks = new Map<TieBreakKey, StoredTieBreakRound>([
      [
        "DAY_1:COUNTRY",
        {
          id: "round-1",
          scope: "DAY_1",
          subject: "COUNTRY",
          pegSizeCm: "4",
          timeLimitSeconds: 10,
          maxPoints: 6,
          entries: [
            { key: "a", points: 6, timeSeconds: 8 },
            { key: "b", points: 4, timeSeconds: 8 },
          ],
        },
      ],
    ]);

    const results: ChampionshipResults = {
      totals,
      directory: directoryOf(["a", "b", "g"]),
      tieBreaks,
      confirmedRunCount: 1,
    };

    const { sets } = buildStandingsData(results, t);
    const day1Countries = sets.find((set) => set.scope === "DAY_1" && set.subject === "COUNTRY")!;

    const rankOf = (key: string) => day1Countries.rows.find((row) => row.key === key)!.rank;
    // a and b are resolved relative to each other by the round...
    expect(rankOf("a")).toBeLessThan(rankOf("b"));
    // ...while g, absent from the round, keeps the shared base rank rather
    // than being silently promoted or demoted.
    expect(rankOf("g")).toBe(1);
  });
});
