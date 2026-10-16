import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ClipboardList,
  Flag,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Trophy,
  Users,
} from "lucide-react";
import { currentPrincipalOrNull } from "@/lib/auth/authorize";
import { hasPermission } from "@/domain/permissions";
import { getTranslator } from "@/lib/i18n/server";
import { AppSidebar, type NavItem } from "@/components/layout/app-nav";
import { LocaleSwitcher, ThemeToggle } from "@/components/layout/toolbar";
import { ItpfLogo } from "@/components/common/itpf-logo";
import { signOutAction } from "@/server/actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipalOrNull();
  if (!principal) redirect("/sign-in");
  const { t } = await getTranslator();

  const items: NavItem[] = [
    { href: "/", labelKey: "nav.dashboard", icon: <LayoutDashboard /> },
    { href: "/championships", labelKey: "nav.championships", icon: <Trophy /> },
  ];

  if (hasPermission(principal, "MANAGE_TEMPLATES")) {
    items.push({ href: "/templates", labelKey: "nav.templates", icon: <ClipboardList /> });
  }
  if (hasPermission(principal, "MANAGE_RIDERS")) {
    items.push({ href: "/countries", labelKey: "nav.countries", icon: <Flag /> });
  }
  if (principal.isAdmin) {
    items.push({ href: "/users", labelKey: "nav.users", icon: <Users /> });
    items.push({ href: "/audit", labelKey: "nav.auditLog", icon: <ScrollText /> });
  }
  items.push({ href: "/results", labelKey: "nav.publicResults", icon: <Trophy /> });

  const header = (
    <Link href="/" className="flex items-center gap-2.5 rounded-md p-1">
      <ItpfLogo width={40} priority />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-shell-foreground">
          {t("common.appNameShort")}
        </span>
        <span className="block truncate text-[0.6875rem] text-shell-muted">
          {t("common.appName")}
        </span>
      </span>
    </Link>
  );

  const footer = (
    <div className="space-y-2 border-t border-shell-border pt-3">
      <div className="px-2">
        <p className="truncate text-sm font-medium text-shell-foreground">{principal.name}</p>
        <p className="truncate text-xs text-shell-muted">
          {principal.isAdmin ? t("users.administrator") : principal.username}
        </p>
      </div>
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-shell-muted transition-colors hover:bg-shell-active hover:text-shell-foreground"
        >
          <LogOut className="size-4 shrink-0" aria-hidden />
          {t("common.signOut")}
        </button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <AppSidebar items={items} header={header} footer={footer} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          data-app-header
          className="sticky top-0 z-30 hidden items-center justify-end gap-1 border-b border-border bg-background/90 px-6 py-2 backdrop-blur lg:flex"
        >
          <LocaleSwitcher />
          <ThemeToggle />
        </header>
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
