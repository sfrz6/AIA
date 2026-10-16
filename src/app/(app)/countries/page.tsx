import Link from "next/link";
import { ChevronRight, Flag } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listCountriesWithRiderCounts } from "@/server/services/registry";
import { PageHeader, EmptyState, Card } from "@/components/ui/surfaces";
import { CountryFlag } from "@/components/common/country-flag";
import { CountrySearch } from "./country-search";

export const metadata = { title: "Countries and riders" };

export default async function CountriesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePagePermission("MANAGE_RIDERS");
  const { locale, t } = await getTranslator();
  const { q } = await searchParams;
  const list = await listCountriesWithRiderCounts(locale, q);

  return (
    <>
      <PageHeader title={t("countries.title")} description={t("countries.subtitle")} />

      <div className="mb-4 max-w-sm">
        <CountrySearch defaultValue={q ?? ""} />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Flag />} title={t("common.noResults")} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-hairline">
            {list.map((country) => (
              <li key={country.id}>
                <Link
                  href={`/countries/${country.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <CountryFlag iso2={country.iso2} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{country.name}</span>
                    <span className="block text-xs text-muted">
                      {country.iso3} · {t("countries.ridersCount", { count: country.riderCount })}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
