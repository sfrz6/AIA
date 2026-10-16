import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui/surfaces";
import { TemplateEditor } from "../template-editor";

export const metadata = { title: "New championship template" };

export default async function NewTemplatePage() {
  await requirePagePermission("MANAGE_TEMPLATES");
  const { t } = await getTranslator();

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link href="/templates" className="inline-flex items-center gap-1 hover:text-foreground">
            <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden />
            {t("templates.title")}
          </Link>
        }
        title={t("templates.newTemplate")}
        description={t("templates.noTemplatesHint")}
      />

      <TemplateEditor mode="create" />
    </>
  );
}
