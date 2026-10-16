import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { hasPermission } from "@/domain/permissions";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getChampionshipDetail } from "@/server/services/championships";
import { loadChampionshipResults } from "@/server/services/results";
import { EmptyState } from "@/components/ui/surfaces";
import {
  activeRidersByCountry,
  buildStandingsData,
  pdfAvailability,
  storedTieBreakEntries,
} from "@/components/results/standings-data";
import { scopeForDay, type StandingsScope } from "@/domain/results";
import { ResultsView } from "./results-view";

export const metadata = { title: "Results" };

/**
 * The internal standings of one championship.
 *
 * This is the `/results` tab of the championship shell, so the championship
 * header and the tabs come from the surrounding layout and are not repeated.
 */
export default async function ChampionshipResultsPage({
  params,
}: {
  params: Promise<{ championshipId: string }>;
}) {
  const principal = await requirePagePermission("VIEW_INTERNAL_RESULTS");
  const { championshipId } = await params;
  const { locale, t } = await getTranslator();

  const championship = await getChampionshipDetail(championshipId);
  if (!championship) notFound();

  // `loadChampionshipResults` reads confirmed runs only, so nothing on this
  // page can be derived from work in progress.
  const results = await loadChampionshipResults(championship.id, locale);

  if (results.confirmedRunCount === 0) {
    return <EmptyState icon={<Trophy />} title={t("results.noConfirmedRuns")} />;
  }

  const { days, sets } = buildStandingsData(results, t);

  const availability = pdfAvailability(championship.days);
  const pdfAvailable: Partial<Record<StandingsScope, boolean>> = { OVERALL: availability.overall };
  for (const [day, ok] of availability.byDay) pdfAvailable[scopeForDay(day)] = ok;

  return (
    <ResultsView
      championshipId={championship.id}
      days={days}
      sets={sets}
      canManageTieBreaks={hasPermission(principal, "MANAGE_TIE_BREAKS")}
      activeRiders={activeRidersByCountry(results.directory)}
      storedRounds={storedTieBreakEntries(results.tieBreaks)}
      pdfAvailable={pdfAvailable}
    />
  );
}
