"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

const TABS: ReadonlyArray<{ segment: string; labelKey: MessageKey }> = [
  { segment: "", labelKey: "championships.schedule" },
  { segment: "/participants", labelKey: "championships.participants" },
  { segment: "/results", labelKey: "championships.results" },
];

export function ChampionshipTabs({ championshipId }: { championshipId: string }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const base = `/championships/${championshipId}`;

  return (
    <nav
      data-app-nav
      aria-label={t("championships.overview")}
      className="-mb-px flex gap-1 overflow-x-auto border-b border-border"
    >
      {TABS.map((tab) => {
        const href = `${base}${tab.segment}`;
        const active = tab.segment === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link
            key={tab.segment || "schedule"}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t(tab.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
