"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n";

export interface NavItem {
  readonly href: string;
  readonly labelKey: MessageKey;
  readonly icon: React.ReactNode;
  /** Highlight the item for any route under `href`, not only an exact match. */
  readonly matchPrefix?: boolean;
}

function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  return item.matchPrefix === false ? pathname === item.href : pathname.startsWith(item.href);
}

function NavLinks({ items, onNavigate }: { items: readonly NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                "[&_svg]:size-4 [&_svg]:shrink-0",
                active
                  ? "bg-shell-active font-medium text-white"
                  : "text-shell-muted hover:bg-shell-active/60 hover:text-shell-foreground",
              )}
            >
              <span aria-hidden>{item.icon}</span>
              <span className="truncate">{t(item.labelKey)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function AppSidebar({
  items,
  header,
  footer,
}: {
  items: readonly NavItem[];
  header: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const { t } = useI18n();

  return (
    <>
      {/* Compact bar on phones and small tablets. */}
      <div
        data-app-nav
        className="flex items-center gap-2 border-b border-shell-border bg-shell px-3 py-2 lg:hidden"
      >
        <Button
          variant="ghost"
          size="iconSm"
          onClick={() => setOpen(true)}
          aria-label={t("nav.mainMenu")}
          className="text-shell-foreground hover:bg-shell-active"
        >
          <Menu aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">{header}</div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink-950/60"
            aria-label={t("common.close")}
            onClick={() => setOpen(false)}
          />
          <nav
            data-app-sidebar
            aria-label={t("nav.mainMenu")}
            className="absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col gap-4 bg-shell p-3"
          >
            <div className="flex items-start justify-between gap-2">
              {header}
              <Button
                variant="ghost"
                size="iconSm"
                onClick={() => setOpen(false)}
                aria-label={t("common.close")}
                className="text-shell-foreground hover:bg-shell-active"
              >
                <X aria-hidden />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks items={items} onNavigate={() => setOpen(false)} />
            </div>
            {footer}
          </nav>
        </div>
      ) : null}

      <nav
        data-app-sidebar
        aria-label={t("nav.mainMenu")}
        className="hidden w-64 shrink-0 flex-col gap-4 border-e border-shell-border bg-shell p-3 lg:sticky lg:top-0 lg:flex lg:h-dvh"
      >
        {header}
        <div className="flex-1 overflow-y-auto">
          <NavLinks items={items} />
        </div>
        {footer}
      </nav>
    </>
  );
}
