import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Trophy } from "lucide-react";
import { scopeForDay, type StandingsScope } from "@/domain/results";
import { ItpfLogo } from "@/components/common/itpf-logo";
import {
  championshipDisplayName,
  formatCompetitionDate,
  formatPegSize,
} from "@/components/common/formatting";
import { eventLabel } from "@/components/common/labels";
import { Badge, Callout, EmptyState } from "@/components/ui/surfaces";
import { buildStandingsData, pdfAvailability } from "@/components/results/standings-data";
import { getTranslator } from "@/lib/i18n/server";
import { getChampionshipBySlug, getChampionshipDetail } from "@/server/services/championships";
import {
  getLastConfirmedRun,
  getNextRun,
  loadChampionshipResults,
} from "@/server/services/results";
import { AutoRefresh } from "../auto-refresh";
import { PublicStandings } from "./public-standings";

/**
 * Standings change only when an official confirms a run, and the published
 * record is read far more often than it changes. Revalidating every 30 seconds
 * means a newly confirmed run reaches the public within half a minute without
 * a rebuild, while a burst of readers is served from the cache.
 */
export const revalidate = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const { locale } = await getTranslator();
  const championship = await getChampionshipBySlug(slug);
  if (!championship) return { title: "Official results" };
  const name = championshipDisplayName(championship.name, championship.nameAr, locale);
  return {
    title: `${name} results`,
    description: `Official results of ${name}, ${championship.location}.`,
    robots: { index: true, follow: true },
  };
}

export default async function PublicChampionshipResultsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale, t } = await getTranslator();

  // Only a published championship resolves, so an unpublished competition is
  // indistinguishable from one that does not exist.
  const championship = await getChampionshipBySlug(slug);
  if (!championship) notFound();

  // `loadChampionshipResults` and `getLastConfirmedRun` both read confirmed
  // runs only, so a run still being scored never appears here. `getNextRun`
  // only exposes the schedule (event, run number, peg size) of the run that
  // has not started yet, never any score, so it is safe to show publicly.
  const [results, lastRun, nextRun, detail] = await Promise.all([
    loadChampionshipResults(championship.id, locale),
    getLastConfirmedRun(championship.id),
    getNextRun(championship.id),
    getChampionshipDetail(championship.id),
  ]);

  const { days, sets } = buildStandingsData(results, t);

  // Plain, serialisable shape for the client component: a Map doesn't cross
  // the server/client boundary as cleanly as a record keyed by scope.
  const availability = pdfAvailability(detail?.days ?? []);
  const pdfAvailable: Partial<Record<StandingsScope, boolean>> = { OVERALL: availability.overall };
  for (const [day, ok] of availability.byDay) pdfAvailable[scopeForDay(day)] = ok;

  const currentDay = lastRun?.dayNumber ?? nextRun?.dayNumber ?? null;

  return (
    <div className="space-y-5">
      {/* Keeps the page current for a visitor who leaves it open, without a
          manual reload: see the component for how it avoids resetting their
          selected standings view. */}
      <AutoRefresh intervalMs={15_000} />

      <Link
        href="/results"
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
      >
        <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
        {t("publicResults.backToChampionships")}
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <ItpfLogo width={56} priority />
        <div className="min-w-0 flex-1 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {championshipDisplayName(championship.name, championship.nameAr, locale)}
          </h1>
          {/*
            Location and organizer are untranslated proper nouns. In Arabic,
            left as plain text either can be torn apart mid-phrase by the
            browser's bidi reordering when the line wraps; `bdi` isolates each
            as one atomic run so it wraps as a whole without disturbing the
            date's own (already correct) right-to-left flow.
          */}
          <p className="text-sm text-muted">
            {formatCompetitionDate(championship.startDate, locale)} · <bdi>{championship.location}</bdi>
            {championship.organizer ? (
              <>
                {" "}
                · <bdi>{championship.organizer}</bdi>
              </>
            ) : null}
          </p>
          <p className="text-xs text-muted">{t("publicResults.subtitle")}</p>
        </div>
      </header>

      {currentDay !== null ? (
        <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-muted">{t("common.day")}</dt>
            <dd className="font-medium">
              {t("publicResults.currentDay", { day: currentDay })}
            </dd>
          </div>
          {lastRun ? (
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("publicResults.lastConfirmed")}</dt>
              <dd className="flex flex-wrap items-center gap-2 font-medium">
                <span>{eventLabel(lastRun.eventType, t)}</span>
                <Badge tone="outline">
                  {t("templates.runNumber", { number: lastRun.runNumber })}
                </Badge>
              </dd>
            </div>
          ) : null}
          {nextRun ? (
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("publicResults.nextRun")}</dt>
              <dd className="flex flex-wrap items-center gap-2 font-medium">
                <span>{eventLabel(nextRun.eventType, t)}</span>
                <Badge tone="outline">
                  {t("templates.runNumber", { number: nextRun.runNumber })}
                </Badge>
                <Badge tone="outline">
                  {formatPegSize(nextRun.pegSizeCm)} {t("common.centimetres")}
                </Badge>
              </dd>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge tone="success">{t("publicResults.championshipComplete")}</Badge>
            </div>
          )}
        </dl>
      ) : null}

      <Callout tone="info">{t("publicResults.confirmedRunsOnly")}</Callout>

      {results.confirmedRunCount === 0 ? (
        <EmptyState icon={<Trophy />} title={t("results.noConfirmedRuns")} />
      ) : (
        <PublicStandings days={days} sets={sets} slug={championship.slug} pdfAvailable={pdfAvailable} />
      )}
    </div>
  );
}
