import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getCountry, listRidersForCountry } from "@/server/services/registry";
import { PageHeader } from "@/components/ui/surfaces";
import { CountryFlag } from "@/components/common/country-flag";
import { RiderRegistry } from "./rider-registry";

export default async function CountryPage({
  params,
  searchParams,
}: {
  params: Promise<{ countryId: string }>;
  searchParams: Promise<{ retired?: string }>;
}) {
  await requirePagePermission("MANAGE_RIDERS");
  const { locale, t } = await getTranslator();
  const { countryId } = await params;
  const { retired } = await searchParams;

  const country = await getCountry(countryId, locale);
  if (!country) notFound();

  const includeRetired = retired === "1";
  const riders = await listRidersForCountry(countryId, { includeRetired });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/countries"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {t("countries.title")}
          </Link>
        }
        title={
          <span className="inline-flex items-center gap-3">
            <CountryFlag iso2={country.iso2} size="lg" />
            {country.name}
          </span>
        }
        description={t("countries.subtitle")}
      />

      <RiderRegistry
        countryId={country.id}
        riders={riders.map((rider) => ({
          id: rider.id,
          fullName: rider.fullName,
          isActive: rider.isActive,
        }))}
        includeRetired={includeRetired}
      />
    </>
  );
}
