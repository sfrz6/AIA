import Link from "next/link";
import { ChevronRight, Plus, Trophy } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guards";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import { listChampionships, type ChampionshipSummary } from "@/server/services/championships";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/surfaces";
import { Button } from "@/components/ui/button";
import { formatCompetitionDate } from "@/components/common/formatting";
import type { Locale } from "@/lib/i18n/config";
import type { Translator } from "@/lib/i18n";

export const metadata = { title: "Dashboard" };

function statusTone(status: ChampionshipSummary["status"]) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "COMPLETED") return "neutral" as const;
  return "warning" as const;
}

function statusLabel(status: ChampionshipSummary["status"], t: Translator) {
  if (status === "ACTIVE") return t("championships.statusActive");
  if (status === "COMPLETED") return t("championships.statusCompleted");
  return t("championships.statusDraft");
}

function ChampionshipCard({
  championship,
  locale,
  t,
}: {
  championship: ChampionshipSummary;
  locale: Locale;
  t: Translator;
}) {
  return (
    <Link
      href={`/championships/${championship.id}`}
      className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-surface-sunken"
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{championship.name}</span>
          <Badge tone={statusTone(championship.status)}>
            {statusLabel(championship.status, t)}
          </Badge>
          {championship.isPublished ? (
            <Badge tone="primary">{t("championships.published")}</Badge>
          ) : null}
        </span>
        <span className="block text-xs text-muted">
          {formatCompetitionDate(championship.startDate, locale)} · {championship.location} ·{" "}
          {t("championships.eventsCount", { count: championship.countryCount })}
        </span>
      </span>
      <span className="numeric hidden shrink-0 text-xs text-muted sm:block">
        {championship.confirmedRuns} / {championship.totalRuns} {t("common.run")}
      </span>
      <ChevronRight className="size-4 shrink-0 text-subtle rtl:rotate-180" aria-hidden />
    </Link>
  );
}

export default async function DashboardPage() {
  const principal = await requirePageUser();
  const { locale, t } = await getTranslator();
  const all = await listChampionships();

  const groups = [
    { key: "active", label: t("dashboard.activeChampionships"), items: all.filter((c) => c.status === "ACTIVE") },
    { key: "draft", label: t("dashboard.draftChampionships"), items: all.filter((c) => c.status === "DRAFT") },
    {
      key: "completed",
      label: t("dashboard.completedChampionships"),
      items: all.filter((c) => c.status === "COMPLETED"),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <>
      <PageHeader
        title={t("dashboard.title")}
        description={t("dashboard.subtitle")}
        actions={
          hasPermission(principal, "CREATE_CHAMPIONSHIP") ? (
            <Button asChild>
              <Link href="/championships/new">
                <Plus aria-hidden />
                {t("championships.newChampionship")}
              </Link>
            </Button>
          ) : null
        }
      />

      {all.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title={t("dashboard.noChampionships")}
          description={t("dashboard.createFirst")}
          action={
            hasPermission(principal, "CREATE_CHAMPIONSHIP") ? (
              <Button asChild>
                <Link href="/championships/new">
                  <Plus aria-hidden />
                  {t("championships.newChampionship")}
                </Link>
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.key} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {group.label}
              </h2>
              <Card className="overflow-hidden">
                <ul className="divide-hairline">
                  {group.items.map((championship) => (
                    <li key={championship.id}>
                      <ChampionshipCard championship={championship} locale={locale} t={t} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
