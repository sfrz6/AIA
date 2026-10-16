import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentPrincipalOrNull } from "@/lib/auth/authorize";
import { getTranslator } from "@/lib/i18n/server";
import { ItpfLogo } from "@/components/common/itpf-logo";
import { LocaleSwitcher, ThemeToggle } from "@/components/layout/toolbar";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage() {
  if (await currentPrincipalOrNull()) redirect("/");
  const { t } = await getTranslator();

  return (
    <main className="flex min-h-dvh flex-col bg-surface">
      <div className="flex items-center justify-end gap-1 p-3">
        <LocaleSwitcher />
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <ItpfLogo width={150} priority />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">{t("common.appName")}</h1>
              <p className="mt-1 text-sm text-muted">{t("auth.signInSubtitle")}</p>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface-raised p-5 shadow-sm">
            <SignInForm />
          </div>

          <p className="mt-6 text-center text-xs text-subtle">{t("common.federation")}</p>
        </div>
      </div>
    </main>
  );
}
