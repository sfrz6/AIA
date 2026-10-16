import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listTemplates } from "@/server/services/templates";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, EmptyState, PageHeader } from "@/components/ui/surfaces";
import { TemplateActions } from "./template-actions";

export const metadata = { title: "Championship templates" };

export default async function TemplatesPage() {
  await requirePagePermission("MANAGE_TEMPLATES");
  const { t } = await getTranslator();
  const templates = await listTemplates({ includeArchived: true });

  const newTemplateButton = (
    <Button asChild>
      <Link href="/templates/new">
        <Plus aria-hidden />
        {t("templates.newTemplate")}
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title={t("templates.title")}
        description={t("templates.subtitle")}
        actions={newTemplateButton}
      />

      <Callout tone="info" className="mb-4">
        {t("templates.editWarning")}
      </Callout>

      {templates.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={t("templates.noTemplates")}
          description={t("templates.noTemplatesHint")}
          action={newTemplateButton}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-hairline">
            {templates.map((template) => (
              <li key={template.id} className="flex items-center gap-3 px-4 py-3">
                <Link
                  href={`/templates/${template.id}`}
                  className="min-w-0 flex-1 rounded-md transition-colors hover:text-primary"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{template.name}</span>
                    <Badge tone={template.isArchived ? "warning" : "success"}>
                      {template.isArchived ? t("templates.archived") : t("templates.active")}
                    </Badge>
                  </span>
                  {template.description ? (
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {template.description}
                    </span>
                  ) : null}
                  <span className="mt-0.5 block text-xs text-muted">
                    {t("championships.eventsCount", { count: template.eventCount })}
                    {" · "}
                    {t("championships.runsCount", { count: template.runCount })}
                  </span>
                  {template.championshipCount > 0 ? (
                    <span className="mt-0.5 block text-xs text-muted">
                      {t("templates.usedByChampionships", { count: template.championshipCount })}
                    </span>
                  ) : null}
                </Link>
                <TemplateActions
                  templateId={template.id}
                  templateName={template.name}
                  isArchived={template.isArchived}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
