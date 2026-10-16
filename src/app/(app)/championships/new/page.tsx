import Link from "next/link";
import { LayoutTemplate } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listCountriesWithRiderCounts } from "@/server/services/registry";
import { getTemplateDetail, listTemplates, type TemplateDetail } from "@/server/services/templates";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/surfaces";
import { ChampionshipWizard, type WizardTemplate } from "./championship-wizard";

export const metadata = { title: "New championship" };

export default async function NewChampionshipPage() {
  await requirePagePermission("CREATE_CHAMPIONSHIP");
  const { locale, t } = await getTranslator();

  // A template without events or runs cannot produce a championship, so it is
  // never offered: the structure is copied as it stands.
  const summaries = (await listTemplates()).filter(
    (summary) => summary.eventCount > 0 && summary.runCount > 0,
  );

  const details = (
    await Promise.all(summaries.map((summary) => getTemplateDetail(summary.id)))
  ).filter((detail): detail is TemplateDetail => detail !== null);

  const templates: readonly WizardTemplate[] = details.map((detail) => ({
    id: detail.id,
    name: detail.name,
    description: detail.description,
    days: detail.days.map((day) => ({
      dayNumber: day.dayNumber,
      events: day.events.map((event) => ({
        eventType: event.eventType,
        runs: event.runs.map((run) => ({
          runNumber: run.runNumber,
          pegSizeCm: run.pegSizeCm,
          timeLimitSeconds: run.timeLimitSeconds,
        })),
      })),
    })),
  }));

  const countries = (await listCountriesWithRiderCounts(locale)).map((country) => ({
    id: country.id,
    iso2: country.iso2,
    name: country.name,
    riderCount: country.riderCount,
  }));

  return (
    <>
      <PageHeader
        title={t("championships.newChampionship")}
        description={t("championships.subtitle")}
      />

      {templates.length === 0 ? (
        <EmptyState
          icon={<LayoutTemplate />}
          title={t("championships.noTemplatesAvailable")}
          description={t("templates.noTemplatesHint")}
          action={
            <Button asChild>
              <Link href="/templates">{t("templates.title")}</Link>
            </Button>
          }
        />
      ) : (
        <ChampionshipWizard templates={templates} countries={countries} />
      )}
    </>
  );
}
