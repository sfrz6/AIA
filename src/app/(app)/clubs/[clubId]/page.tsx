import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getClub, listRidersForClub } from "@/server/services/registry";
import { PageHeader } from "@/components/ui/surfaces";
import { RiderRegistry } from "./rider-registry";

export default async function ClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ clubId: string }>;
  searchParams: Promise<{ retired?: string }>;
}) {
  await requirePagePermission("MANAGE_RIDERS");
  const { locale, t } = await getTranslator();
  const { clubId } = await params;
  const { retired } = await searchParams;

  const club = await getClub(clubId, locale);
  if (!club) notFound();

  const includeRetired = retired === "1";
  const riders = await listRidersForClub(clubId, { includeRetired });

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link
            href="/clubs"
            className="inline-flex items-center gap-1 hover:text-foreground"
          >
            <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {t("clubs.title")}
          </Link>
        }
        title={club.name}
        description={t("clubs.subtitle")}
      />

      <RiderRegistry
        clubId={club.id}
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
