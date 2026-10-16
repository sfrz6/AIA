import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ItpfLogo } from "@/components/common/itpf-logo";
import { CountryFlag } from "@/components/common/country-flag";
import { championshipDisplayName } from "@/components/common/formatting";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/surfaces";
import { getTranslator } from "@/lib/i18n/server";
import {
  getChampionshipBySlug,
  listChampionshipCountries,
  listChampionshipRiders,
} from "@/server/services/championships";

/**
 * Standings change often enough to warrant a 30 second revalidation; a
 * squad only changes before a championship starts, so this page can afford
 * to read fresh on every request without a cache window of its own.
 */
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
    title: `${name} participants`,
    robots: { index: true, follow: true },
  };
}

export default async function PublicParticipantsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { locale, t } = await getTranslator();

  // Only a published championship resolves, matching the results page: a
  // squad is not public before the championship it belongs to is.
  const championship = await getChampionshipBySlug(slug);
  if (!championship) notFound();

  const [countries, riders] = await Promise.all([
    listChampionshipCountries(championship.id, locale),
    listChampionshipRiders(championship.id, locale),
  ]);

  return (
    <div className="space-y-5">
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
          <p className="text-xs text-muted">{t("publicResults.participatingCountries")}</p>
        </div>
      </header>

      {countries.length === 0 ? (
        <EmptyState title={t("publicResults.noParticipantsYet")} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {countries.map((country) => {
            const squad = riders.filter(
              (rider) => rider.championshipCountryId === country.championshipCountryId,
            );

            return (
              <li key={country.championshipCountryId}>
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CountryFlag iso2={country.iso2} size="md" />
                      <span className="truncate">{country.name}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {squad.length === 0 ? (
                      <p className="text-sm text-muted">
                        {t("championships.ridersNotSelectedYet")}
                      </p>
                    ) : (
                      <ul className="space-y-0.5 text-sm">
                        {squad.map((rider) => (
                          <li key={rider.championshipRiderId}>{rider.fullName}</li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
