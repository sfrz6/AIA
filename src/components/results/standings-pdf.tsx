import { CountryFlag } from "@/components/common/country-flag";
import type { Translator } from "@/lib/i18n";
import type { DayNumber } from "@/domain/results";
import type { StandingsSet } from "./standings-data";

/**
 * One scope's standings, laid out for paper rather than a screen: no sticky
 * columns or horizontal scroll, just a plain table that reads top to bottom.
 * Shares the Rank/Name/Total shape with the on-screen `StandingsTable`, but
 * is its own component because a printed page has none of the interactive
 * concerns (scrolling, theme, touch targets) that one is built around.
 *
 * `days` mirrors the on-screen table's own rule: the Overall scope, once
 * more than one day has results, gets a column per day before the Total so
 * the PDF shows the same day by day breakdown rather than just the sum.
 */
export function StandingsPdfTable({
  set,
  days,
  t,
}: {
  set: StandingsSet;
  days: readonly DayNumber[];
  t: Translator;
}) {
  const isCountry = set.subject === "COUNTRY";
  const showDayBreakdown = set.scope === "OVERALL" && days.length > 1;

  if (set.rows.length === 0) {
    return <p className="px-1 py-2 text-[9pt] text-neutral-600">{t("results.noData")}</p>;
  }

  return (
    <table className="w-full border-collapse text-[9pt]">
      <thead>
        <tr className="border-b border-black bg-neutral-100">
          <th className="w-10 border-e border-black px-1 py-1 text-center">{t("common.rank")}</th>
          <th className="border-e border-black px-2 py-1 text-start">
            {isCountry ? t("common.country") : t("common.rider")}
          </th>
          {isCountry ? (
            <>
              <th className="w-16 border-e border-black px-1 py-1 text-center">
                {t("results.riderPoints")}
              </th>
              <th className="w-16 border-e border-black px-1 py-1 text-center">
                {t("results.countryFaults")}
              </th>
            </>
          ) : null}
          {showDayBreakdown
            ? days.map((day) => (
                <th key={day} className="w-14 border-e border-black px-1 py-1 text-center">
                  {t("results.dayResults", { day })}
                </th>
              ))
            : null}
          <th className="w-16 px-1 py-1 text-center">{t("common.total")}</th>
        </tr>
      </thead>
      <tbody>
        {set.rows.map((row) => {
          const isPodium = row.rank <= 3;
          return (
            <tr
              key={row.key}
              className={`border-b border-neutral-400 last:border-b-0 ${isPodium ? "font-semibold" : ""}`}
            >
              <td className="numeric border-e border-black px-1 py-1.5 text-center">{row.rank}</td>
              <td className="border-e border-black px-2 py-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <CountryFlag iso2={row.iso2} size="sm" />
                  <span>
                    {row.name}
                    {!isCountry ? (
                      <span className="ms-1 text-[8pt] font-normal text-neutral-600">
                        ({row.countryName})
                      </span>
                    ) : null}
                  </span>
                  {row.isTiedAfterTieBreak && isPodium ? (
                    <span className="text-[8pt] font-normal text-neutral-600">
                      [{t("results.tied")}]
                    </span>
                  ) : null}
                </span>
              </td>
              {isCountry ? (
                <>
                  <td className="numeric border-e border-black px-1 py-1.5 text-center">
                    {row.riderPoints}
                  </td>
                  <td className="numeric border-e border-black px-1 py-1.5 text-center">
                    {row.countryFaults}
                  </td>
                </>
              ) : null}
              {showDayBreakdown
                ? row.dayValues.map((value) => (
                    <td key={value.day} className="numeric border-e border-black px-1 py-1.5 text-center">
                      {value.value}
                    </td>
                  ))
                : null}
              <td className="numeric px-1 py-1.5 text-center">{row.total}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
