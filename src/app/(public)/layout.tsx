import type { Metadata } from "next";
import Link from "next/link";
import { ItpfLogo } from "@/components/common/itpf-logo";
import { LocaleSwitcher, ThemeToggle } from "@/components/layout/toolbar";
import { getTranslator } from "@/lib/i18n/server";

/**
 * Overrides the root app's manifest (start_url "/", the sign-in-gated
 * dashboard) with one whose start_url is the public results index, so a
 * visitor who adds this section to their home screen launches back into the
 * results they were reading instead of the officials' sign-in page.
 */
export const metadata: Metadata = {
  manifest: "/manifest-public.webmanifest",
};

/**
 * Shell for the published results.
 *
 * Deliberately free of any authentication call: a spectator, a journalist or a
 * federation officer reads these pages without an account, so the shell offers
 * nothing but the federation identity, the language choice and the theme.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const { t } = await getTranslator();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/results" className="flex min-w-0 items-center gap-2.5 rounded-md">
            <ItpfLogo width={40} priority />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">
                {t("common.appNameShort")}
              </span>
              <span className="block truncate text-[0.6875rem] text-muted">
                {t("publicResults.title")}
              </span>
            </span>
          </Link>
          <div className="ms-auto flex shrink-0 items-center gap-1">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">{children}</main>

      <footer className="border-t border-border py-5">
        <p className="mx-auto w-full max-w-5xl px-4 text-center text-xs text-muted sm:px-6">
          {t("common.federation")}
        </p>
      </footer>
    </div>
  );
}
