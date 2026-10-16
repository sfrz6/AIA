import Link from "next/link";
import { ChevronRight, Plus, Trophy } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guards";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import { listChampionships } from "@/server/services/championships";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/surfaces";
import { Button } from "@/components/ui/button";
import { formatCompetitionDate } from "@/components/common/formatting";
import { ChampionshipDeleteButton } from "./championship-delete-button";

export const metadata = { title: "Championships" };

export default async function ChampionshipsPage() {
  const principal = await requirePageUser();
  const { locale, t } = await getTranslator();
  const list = await listChampionships();

  const newButton = hasPermission(principal, "CREATE_CHAMPIONSHIP") ? (
    <Button asChild>
      <Link href="/championships/new">
        <Plus aria-hidden />
        {t("championships.newChampionship")}
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title={t("championships.title")}
        description={t("championships.subtitle")}
        actions={newButton}
      />

      {list.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={t("championships.noChampionships")}
          description={t("dashboard.createFirst")}
          action={newButton}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-hairline">
            {list.map((championship) => (
              <li
                key={championship.id}
                className="flex items-center gap-1 transition-colors hover:bg-surface-sunken"
              >
                <Link
                  href={`/championships/${championship.id}`}
                  className="flex min-w-0 flex-1 items-center gap-4 px-4 py-3.5"
                >
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{championship.name}</span>
                      <Badge
                        tone={
                          championship.status === "ACTIVE"
                            ? "success"
                            : championship.status === "COMPLETED"
                              ? "neutral"
                              : "warning"
                        }
                      >
                        {championship.status === "ACTIVE"
                          ? t("championships.statusActive")
                          : championship.status === "COMPLETED"
                            ? t("championships.statusCompleted")
                            : t("championships.statusDraft")}
                      </Badge>
                      {championship.isPublished ? (
                        <Badge tone="primary">{t("championships.published")}</Badge>
                      ) : null}
                    </span>
                    <span className="block text-xs text-muted">
                      {formatCompetitionDate(championship.startDate, locale)} ·{" "}
                      {championship.location}
                    </span>
                  </span>
                  <span className="numeric hidden shrink-0 text-xs text-muted sm:block">
                    {championship.confirmedRuns} / {championship.totalRuns}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" aria-hidden />
                </Link>
                {principal.isAdmin ? (
                  <span className="shrink-0 pe-3">
                    <ChampionshipDeleteButton
                      championshipId={championship.id}
                      championshipName={championship.name}
                    />
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
