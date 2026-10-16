import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getChampionshipDetail } from "@/server/services/championships";
import { Badge } from "@/components/ui/surfaces";
import { formatCompetitionDate } from "@/components/common/formatting";
import { ChampionshipTabs } from "./championship-tabs";

export default async function ChampionshipLayout({
  params,
  children,
}: {
  params: Promise<{ championshipId: string }>;
  children: React.ReactNode;
}) {
  await requirePageUser();
  const { championshipId } = await params;
  const { locale, t } = await getTranslator();

  const championship = await getChampionshipDetail(championshipId);
  if (!championship) notFound();

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <Link
          href="/championships"
          className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
        >
          <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
          {t("championships.title")}
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {championship.name}
            </h1>
            <p className="text-sm text-muted">
              {formatCompetitionDate(championship.startDate, locale)} · {championship.location}
              {championship.organizer ? ` · ${championship.organizer}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            <Badge tone={championship.isPublished ? "primary" : "outline"}>
              {championship.isPublished
                ? t("championships.published")
                : t("championships.notPublished")}
            </Badge>
          </div>
        </div>
      </header>

      <ChampionshipTabs championshipId={championshipId} />

      {children}
    </div>
  );
}
