import Link from "next/link";
import { ChevronRight, Shield } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listClubsWithRiderCounts } from "@/server/services/registry";
import { PageHeader, EmptyState, Card } from "@/components/ui/surfaces";
import { ClubSearch } from "./club-search";
import { CreateClubDialog } from "./create-club-dialog";

export const metadata = { title: "Clubs and riders" };

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requirePagePermission("MANAGE_RIDERS");
  const { locale, t } = await getTranslator();
  const { q } = await searchParams;
  const list = await listClubsWithRiderCounts(locale, q);

  return (
    <>
      <PageHeader
        title={t("clubs.title")}
        description={t("clubs.subtitle")}
        actions={<CreateClubDialog />}
      />

      <div className="mb-4 max-w-sm">
        <ClubSearch defaultValue={q ?? ""} />
      </div>

      {list.length === 0 ? (
        <EmptyState icon={<Shield />} title={t("common.noResults")} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-hairline">
            {list.map((club) => (
              <li key={club.id}>
                <Link
                  href={`/clubs/${club.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{club.name}</span>
                    <span className="block text-xs text-muted">
                      {t("clubs.ridersCount", { count: club.riderCount })}
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
