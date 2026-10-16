import { ScrollText } from "lucide-react";
import { requirePageAdmin } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listAuditEntries } from "@/server/services/audit-query";
import { EmptyState, PageHeader } from "@/components/ui/surfaces";
import { AuditTable } from "./audit-table";

export const metadata = { title: "Audit log" };

export default async function AuditPage() {
  await requirePageAdmin();
  const { t } = await getTranslator();
  const entries = await listAuditEntries();

  return (
    <>
      <PageHeader title={t("audit.title")} description={t("audit.subtitle")} />

      {entries.length === 0 ? (
        <EmptyState icon={<ScrollText />} title={t("audit.noEntries")} />
      ) : (
        <AuditTable entries={entries} />
      )}
    </>
  );
}
