import * as React from "react";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getEventTypeDefinition } from "@/domain/scoring/event-types";
import { buildScoringUnits } from "@/domain/entry-order";
import { getEventPrintState } from "@/server/services/runs";
import { formatCompetitionDate, formatPegSize, formatTime } from "@/components/common/formatting";
import { eventLabel } from "@/components/common/labels";
import { targetLabels } from "@/components/common/target-labels";
import { CountryFlag } from "@/components/common/country-flag";
import { ItpfLogoPrint } from "@/components/common/itpf-logo";
import { PrintTrigger } from "@/components/common/print-trigger";

export const metadata = { title: "Round sheet" };

export default async function EventRoundSheetPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  await requirePagePermission("PRINT_ROUND_SHEETS");
  const { eventId } = await params;
  const { locale, t } = await getTranslator();

  const state = await getEventPrintState(eventId, locale);
  if (!state) notFound();

  const definition = getEventTypeDefinition(state.eventType);
  const headings = targetLabels(state.eventType, definition.targetsPerRider, t);
  const sharedTime = definition.ridersPerScoringUnit > 1;
  const columnsPerRun = headings.length + 3;

  const printedOn = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  return (
    <main className="mx-auto max-w-[297mm] px-6 py-6 print:px-0 print:py-0">
      <PrintTrigger />

      <header className="mb-4 flex items-start justify-between gap-6 border-b-2 border-black pb-3">
        <div className="flex items-start gap-4">
          <ItpfLogoPrint width={96} />
          <div>
            <p className="text-[10pt] font-semibold uppercase tracking-wide">
              {t("common.federation")}
            </p>
            <h1 className="mt-0.5 text-[14pt] font-bold leading-tight">
              {state.championshipName}
            </h1>
            <p className="text-[9pt]">
              {state.championshipLocation}
              {state.championshipOrganizer ? ` · ${state.championshipOrganizer}` : ""}
            </p>
          </div>
        </div>
        <div className="text-end text-[9pt]">
          <p className="text-[11pt] font-bold">{t("print.roundSheet")}</p>
          <p>{t("championships.daysOf", { day: state.dayNumber })}</p>
          <p className="numeric">{formatCompetitionDate(state.competitionDate, locale)}</p>
        </div>
      </header>

      <section className="mb-4 grid grid-cols-3 gap-3 border border-black text-[9pt]">
        <div className="border-e border-black px-2 py-1.5">
          <p className="text-[8pt] uppercase tracking-wide">{t("common.event")}</p>
          <p className="font-semibold">{eventLabel(state.eventType, t)}</p>
        </div>
        <div className="border-e border-black px-2 py-1.5">
          <p className="text-[8pt] uppercase tracking-wide">{t("runs.pegSize")}</p>
          <p className="numeric font-semibold">
            {state.runs
              .map(
                (run) =>
                  `${t("templates.runNumber", { number: run.runNumber })}: ${formatPegSize(run.pegSizeCm)} ${t("common.centimetres")}`,
              )
              .join(" · ")}
          </p>
        </div>
        <div className="px-2 py-1.5">
          <p className="text-[8pt] uppercase tracking-wide">{t("runs.timeLimit")}</p>
          <p className="numeric font-semibold">
            {state.runs
              .map(
                (run) =>
                  `${t("templates.runNumber", { number: run.runNumber })}: ${formatTime(run.timeLimitSeconds)} ${t("common.seconds")}`,
              )
              .join(" · ")}
          </p>
        </div>
      </section>

      <div className="space-y-4">
        {state.countries.map((country) => {
          const names = new Map(
            country.roster.map((member) => [member.championshipRiderId, member.fullName]),
          );
          const units = buildScoringUnits(
            country.confirmedOrder,
            definition.ridersPerScoringUnit,
          );

          return (
            <section
              key={country.championshipCountryId}
              className="print-avoid-break border border-black"
            >
              <h2 className="flex items-center gap-2 border-b border-black bg-neutral-100 px-2 py-1 text-[10pt] font-bold">
                <CountryFlag iso2={country.iso2} size="sm" />
                {country.countryName}
                <span className="ms-auto text-[8pt] font-normal">
                  {country.decision === "CHANGED"
                    ? t("runs.changeOrder")
                    : country.decision === "NO_CHANGE"
                      ? t("runs.noChange")
                      : t("runs.notReviewed")}
                </span>
              </h2>

              {country.confirmedOrder.length === 0 ? (
                <p className="px-2 py-3 text-[9pt]">{t("runs.notReviewed")}</p>
              ) : (
                <table className="w-full border-collapse text-[9pt]">
                  <thead>
                    <tr className="border-b border-black">
                      <th rowSpan={2} className="w-8 border-e border-black px-1 py-1 text-center">
                        #
                      </th>
                      <th
                        rowSpan={2}
                        className="border-e border-black px-2 py-1 text-start"
                      >
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
                            <th
                              key={index}
                              className="w-12 border-e border-black px-1 py-1 text-center"
                            >
                              {heading}
                            </th>
                          ))}
                          <th className="w-14 border-e border-black px-1 py-1 text-center">
                            {t("common.time")}
                          </th>
                          <th className="w-12 border-e border-black px-1 py-1 text-center">
                            {t("runs.penalty")}
                          </th>
                          <th className="w-12 border-e border-black px-1 py-1 text-center">
                            {t("runs.netPoints")}
                          </th>
                        </React.Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {units.map((unit) =>
                      unit.riders.map((rider, riderIndex) => {
                        const position =
                          unit.unitIndex * definition.ridersPerScoringUnit + riderIndex + 1;
                        return (
                          <tr
                            key={rider.championshipRiderId}
                            className="border-b border-neutral-400 last:border-b-0"
                          >
                            <td className="numeric border-e border-black px-1 py-2 text-center">
                              {position}
                            </td>
                            <td className="border-e border-black px-2 py-2">
                              {names.get(rider.championshipRiderId) ?? ""}
                              {definition.ruleType === "PAIR" && riderIndex === 0 ? (
                                <span className="ms-2 text-[8pt]">
                                  ({t("runs.pairLabel", { number: unit.unitIndex + 1 })})
                                </span>
                              ) : null}
                            </td>
                            {state.runs.map((run) => (
                              <React.Fragment key={run.runId}>
                                {headings.map((_, index) => (
                                  <td key={index} className="border-e border-black px-1 py-2" />
                                ))}
                                {/* Time, fault and net belong to the scoring
                                    unit, so for a pair, team or relay they
                                    span the whole block instead of repeating
                                    per rider. */}
                                {!sharedTime || riderIndex === 0
                                  ? ["border-e border-black", "border-e border-black", "border-e border-black"].map(
                                      (border, cellIndex) => (
                                        <td
                                          key={cellIndex}
                                          className={`${border} px-1 py-2`}
                                          rowSpan={sharedTime ? unit.riders.length : undefined}
                                        />
                                      ),
                                    )
                                  : null}
                              </React.Fragment>
                            ))}
                          </tr>
                        );
                      }),
                    )}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>

      <footer className="mt-6 flex items-end justify-between gap-8 text-[9pt]">
        <div className="flex-1">
          <p className="mb-6">{t("print.sheetFooter")}</p>
          <div className="flex gap-10">
            <div className="flex-1">
              <div className="border-t border-black pt-1">{t("print.manualReferee")}</div>
            </div>
            <div className="flex-1">
              <div className="border-t border-black pt-1">{t("print.signature")}</div>
            </div>
          </div>
        </div>
        <p className="shrink-0 text-[8pt]">
          {t("print.printedOn")} {printedOn}
        </p>
      </footer>
    </main>
  );
}
