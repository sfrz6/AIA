import { requirePageAdmin } from "@/lib/auth/page-guards";
import { getTranslator } from "@/lib/i18n/server";
import { listUsers } from "@/server/services/users";
import { PageHeader } from "@/components/ui/surfaces";
import { UserManager } from "./user-manager";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const principal = await requirePageAdmin();
  const { t } = await getTranslator();
  const accounts = await listUsers();

  return (
    <>
      <PageHeader title={t("users.title")} description={t("users.subtitle")} />
      <UserManager users={accounts} currentUserId={principal.userId} />
    </>
  );
}
