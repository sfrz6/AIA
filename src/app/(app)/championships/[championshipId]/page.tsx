import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarDays, ChevronRight } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guards";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import { getChampionshipDetail } from "@/server/services/championships";
import { getEventTypeDefinition } from "@/domain/scoring/event-types";
import { Badge, Card, CardContent, CardHeader, CardTitle, EmptyState } from "@/components/ui/surfaces";
import { formatCompetitionDate, formatPegSize, formatTime } from "@/components/common/formatting";
import { eventLabel, runStatusLabel, runStatusTone } from "@/components/common/labels";
import { ChampionshipSettings } from "./championship-settings";

export default async function ChampionshipSchedulePage({
  params,
}: {
  params: Promise<{ championshipId: string }>;
}) {
  const principal = await requirePageUser();
  const { championshipId } = await params;
  const { locale, t } = await getTranslator();

  const championship = await getChampionshipDetail(championshipId);
  if (!championship) notFound();

  const canEdit = hasPermission(principal, "EDIT_CHAMPIONSHIP");
  const canPublish = hasPermission(principal, "MANAGE_PUBLIC_RESULTS");

  return (
    <div className="space-y-5">
      {canEdit || canPublish ? (
        <ChampionshipSettings
          championship={{
            id: championship.id,
            name: championship.name,
            nameAr: championship.nameAr,
            location: championship.location,
            organizer: championship.organizer,
            status: championship.status,
            isPublished: championship.isPublished,
            slug: championship.slug,
          }}
          canEdit={canEdit}
          canPublish={canPublish}
        />
      ) : null}

      {championship.days.every((day) => day.events.length === 0) ? (
        <EmptyState icon={<CalendarDays />} title={t("results.noData")} />
      ) : (
        <div className="space-y-5">
          {championship.days.map((day) => (
            <Card key={day.id}>
              <CardHeader>
                <div>
                  <CardTitle>{t("championships.daysOf", { day: day.dayNumber })}</CardTitle>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatCompetitionDate(day.competitionDate, locale)}
                  </p>
                </div>
                <Badge tone="outline">
                  {t("championships.eventsCount", { count: day.events.length })}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {day.events.length === 0 ? (
                  <p className="text-sm text-muted">{t("templates.noEventsOnDay")}</p>
                ) : (
                  day.events.map((event) => {
                    const definition = getEventTypeDefinition(event.eventType);
                    return (
                      <div
                        key={event.id}
                        className="rounded-md border border-border bg-surface-sunken"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                          <h3 className="text-sm font-medium">
                            {eventLabel(event.eventType, t)}
                          </h3>
                          <span className="text-xs text-muted">
                            {t("championships.runsCount", { count: event.runs.length })} ·{" "}
                            {definition.ridersPerScoringUnit > 1
                              ? `${definition.ridersPerScoringUnit} ${t("common.rider")}`
                              : t("common.rider")}
                          </span>
                        </div>
                        <ul className="divide-hairline border-t border-border">
                          {event.runs.map((runItem) => (
                            <li key={runItem.id}>
                              <Link
                                href={`/championships/${championship.id}/runs/${runItem.id}`}
                                className="flex items-center gap-3 bg-surface-raised px-3 py-2.5 transition-colors hover:bg-surface-sunken"
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm">
                                    {t("templates.runNumber", { number: runItem.runNumber })}
                                  </span>
                                  <span className="numeric block text-xs text-muted">
                                    {formatPegSize(runItem.pegSizeCm)} {t("common.centimetres")} ·{" "}
                                    {formatTime(runItem.timeLimitSeconds)} {t("common.seconds")}
                                  </span>
                                </span>
                                <Badge tone={runStatusTone(runItem.status)}>
                                  {runStatusLabel(runItem.status, t)}
                                </Badge>
                                <ChevronRight
                                  className="size-4 shrink-0 text-subtle rtl:rotate-180"
                                  aria-hidden
                                />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
