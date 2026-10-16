import * as React from "react";
import { getEventTypeDefinition } from "@/domain/scoring/event-types";
import { buildScoringUnits } from "@/domain/entry-order";
import type { EventResultsPrintState } from "@/server/services/runs";
import { formatPegSize, formatTime } from "@/components/common/formatting";
import { eventLabel } from "@/components/common/labels";
import { targetLabels } from "@/components/common/target-labels";
import { CountryFlag } from "@/components/common/country-flag";
import type { Translator } from "@/lib/i18n";

/**
 * One event's actual recorded scores, laid out exactly like the referees'
 * blank Round sheet (grouped by country, a column group per run), but filled
 * in — this is what makes a Day PDF a full record of the day rather than
 * just its final standings.
 */
export function EventResultsPdfTable({
  state,
  t,
}: {
  state: EventResultsPrintState;
  t: Translator;
}) {
  const definition = getEventTypeDefinition(state.eventType);
  const headings = targetLabels(state.eventType, definition.targetsPerRider, t);
  const sharedTime = definition.ridersPerScoringUnit > 1;
  const columnsPerRun = headings.length + 3;
  const resultsByRun = new Map(state.runResults.map((run) => [run.runId, run]));

  return (
    <section className="print-avoid-break space-y-2">
      <h2 className="text-[10pt] font-bold uppercase tracking-wide">
        {eventLabel(state.eventType, t)}
      </h2>

      <div className="space-y-3">
        {state.countries.map((country) => {
          const names = new Map(
            country.roster.map((member) => [member.championshipRiderId, member.fullName]),
          );
          const units = buildScoringUnits(country.confirmedOrder, definition.ridersPerScoringUnit);

          if (units.length === 0) return null;

          return (
            <div key={country.championshipCountryId} className="print-avoid-break border border-black">
              <h3 className="flex items-center gap-2 border-b border-black bg-neutral-100 px-2 py-1 text-[9pt] font-bold">
                <CountryFlag iso2={country.iso2} size="sm" />
                {country.countryName}
              </h3>

              <table className="w-full border-collapse text-[8.5pt]">
                <thead>
                  <tr className="border-b border-black">
                    <th rowSpan={2} className="w-7 border-e border-black px-1 py-1 text-center">
                      #
                    </th>
                    <th rowSpan={2} className="border-e border-black px-2 py-1 text-start">
                      {t("common.rider")}
                    </th>
                    {state.runs.map((run) => (
                      <th
                        key={run.runId}
                        colSpan={columnsPerRun}
                        className="border-e border-black px-1 py-1 text-center"
                      >
                        {t("templates.runNumber", { number: run.runNumber })} ·{" "}
                        {formatPegSize(run.pegSizeCm)} {t("common.centimetres")}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-b border-black">
                    {state.runs.map((run) => (
                      <React.Fragment key={run.runId}>
                        {headings.map((heading, index) => (
                          <th key={index} className="w-9 border-e border-black px-1 py-1 text-center">
                            {heading}
                          </th>
                        ))}
                        <th className="w-12 border-e border-black px-1 py-1 text-center">
                          {t("common.time")}
                        </th>
                        <th className="w-10 border-e border-black px-1 py-1 text-center">
                          {t("runs.penalty")}
                        </th>
                        <th className="w-10 border-e border-black px-1 py-1 text-center">
                          {t("runs.netPoints")}
                        </th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) =>
                    unit.riders.map((rider, riderIndex) => {
                      const position = unit.unitIndex * definition.ridersPerScoringUnit + riderIndex + 1;
                      return (
                        <tr key={rider.championshipRiderId} className="border-b border-neutral-400 last:border-b-0">
                          <td className="numeric border-e border-black px-1 py-1 text-center">
                            {position}
                          </td>
                          <td className="border-e border-black px-2 py-1">
                            {names.get(rider.championshipRiderId) ?? ""}
                            {definition.ruleType === "PAIR" && riderIndex === 0 ? (
                              <span className="ms-2 text-[7.5pt]">
                                ({t("runs.pairLabel", { number: unit.unitIndex + 1 })})
                              </span>
                            ) : null}
                          </td>
                          {state.runs.map((run) => {
                            const runValues = resultsByRun.get(run.runId);
                            const riderValues = runValues?.ridersById.get(rider.championshipRiderId);
                            const unitValues = runValues?.unitsByKey.get(
                              `${country.championshipCountryId}:${unit.unitIndex}`,
                            );
                            const showUnitCells = !sharedTime || riderIndex === 0;
                            return (
                              <React.Fragment key={run.runId}>
                                {headings.map((_, index) => (
                                  <td key={index} className="numeric border-e border-black px-1 py-1 text-center">
                                    {riderValues?.targets[index] ?? ""}
                                  </td>
                                ))}
                                {showUnitCells ? (
                                  <>
                                    <td
                                      className="numeric border-e border-black px-1 py-1 text-center"
                                      rowSpan={sharedTime ? unit.riders.length : undefined}
                                    >
                                      {unitValues?.timeSeconds !== undefined && unitValues?.timeSeconds !== null
                                        ? formatTime(unitValues.timeSeconds)
                                        : ""}
                                    </td>
                                    <td
                                      className="numeric border-e border-black px-1 py-1 text-center"
                                      rowSpan={sharedTime ? unit.riders.length : undefined}
                                    >
                                      {unitValues?.penalty ?? ""}
                                    </td>
                                    <td
                                      className="numeric border-e border-black px-1 py-1 text-center"
                                      rowSpan={sharedTime ? unit.riders.length : undefined}
                                    >
                                      {sharedTime ? (unitValues?.netPoints ?? "") : (riderValues?.netPoints ?? "")}
                                    </td>
                                  </>
                                ) : null}
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}
