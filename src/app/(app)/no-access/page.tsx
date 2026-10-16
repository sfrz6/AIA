import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { requirePageUser } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/surfaces";

export const metadata = { title: "Not allowed" };

export default async function NoAccessPage() {
  await requirePageUser();
  const { t } = await getTranslator();

  return (
    <EmptyState
      icon={<ShieldAlert />}
      title={t("common.forbiddenTitle")}
      description={t("common.forbiddenBody")}
      action={
        <Button asChild variant="secondary">
          <Link href="/">{t("common.backToDashboard")}</Link>
        </Button>
      }
      className="mt-10"
    />
  );
}
