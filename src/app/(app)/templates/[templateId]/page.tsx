import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { getTemplateDetail } from "@/server/services/templates";
import { Badge, Callout, PageHeader } from "@/components/ui/surfaces";
import { TemplateEditor } from "../template-editor";

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  await requirePagePermission("MANAGE_TEMPLATES");
  const { t } = await getTranslator();
  const { templateId } = await params;

  const template = await getTemplateDetail(templateId);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/templates" className="inline-flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {t("templates.title")}
          </Link>
        }
        title={template.name}
        description={t("templates.subtitle")}
        actions={
          template.isArchived ? (
            <Badge tone="warning">{t("templates.archived")}</Badge>
          ) : undefined
        }
      />

      <Callout tone="info" className="mb-4">
        {t("templates.editWarning")}
      </Callout>

      <TemplateEditor
        mode="edit"
        template={{
          id: template.id,
          name: template.name,
          description: template.description,
          structure: template.days,
        }}
      />
    </>
  );
}
