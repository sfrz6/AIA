import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Trophy, Users } from "lucide-react";
import { championshipDisplayName, formatCompetitionDate } from "@/components/common/formatting";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState, PageHeader } from "@/components/ui/surfaces";
import { getTranslator } from "@/lib/i18n/server";
import { listChampionships } from "@/server/services/championships";
import { AutoRefresh } from "./auto-refresh";

/**
 * The root layout keeps the application out of search indexes, because every
 * other route is an operational screen. This page is the opposite: it is the
 * federation's published record, so it opts back in.
 */
export const metadata: Metadata = {
  title: "Official results",
  description:
    "Published championship results of the International Tent Pegging Federation.",
  robots: { index: true, follow: true },
};

/**
 * Standings change only when an official confirms a run, and the published
 * record is read far more often than it changes. Revalidating every 30 seconds
 * means a newly confirmed run reaches the public within half a minute without
 * a rebuild, while a burst of readers is served from the cache.
 */
export const revalidate = 30;

export default async function PublicResultsIndexPage() {
  const { locale, t } = await getTranslator();
  const championships = await listChampionships({ publishedOnly: true });

  return (
    <>
      {/* Lets a visitor who opens this page before anything is published
          still see a championship appear the moment it goes live, without
          needing to reload: see the component for how it avoids resetting
          any client-side state. */}
      <AutoRefresh intervalMs={15_000} />

      <PageHeader title={t("publicResults.title")} description={t("publicResults.subtitle")} />

      {championships.length === 0 ? (
        <EmptyState icon={<Trophy />} title={t("publicResults.noChampionships")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {championships.map((championship) => (
            <li key={championship.id}>
              <Card className="flex h-full flex-col">
                <CardHeader className="flex-col items-start gap-1">
                  <CardTitle className="text-base">
                    {championshipDisplayName(championship.name, championship.nameAr, locale)}
                  </CardTitle>
                  {/*
                    Location is an untranslated proper noun. In Arabic, left
                    as plain text it can be torn apart mid-phrase by the
                    browser's bidi reordering when the line wraps; `bdi`
                    isolates it as one atomic run so it wraps as a whole
                    without disturbing the date's own (already correct)
                    right-to-left flow.
                  */}
                  <p className="text-sm text-muted">
                    {formatCompetitionDate(championship.startDate, locale)} ·{" "}
                    <bdi>{championship.location}</bdi>
                  </p>
                </CardHeader>
                <CardContent className="mt-auto space-y-3">
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Badge tone="success">{t("runs.statusConfirmed")}</Badge>
                    <span className="numeric">
                      {t("publicResults.confirmedRuns", { count: championship.confirmedRuns })}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" asChild>
                      <Link href={`/results/${championship.slug}`}>
                        {t("publicResults.viewResults")}
                        <ChevronRight className="rtl:rotate-180" aria-hidden />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/results/${championship.slug}/participants`}>
                        <Users aria-hidden />
                        {t("publicResults.participatingCountries")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
