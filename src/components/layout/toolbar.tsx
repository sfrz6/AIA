"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { useI18n } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS } from "@/lib/i18n/config";
import { setLocaleAction } from "@/server/actions/preferences";

/**
 * Cycles light, dark and system.
 *
 * `useTheme` reports no theme until the provider has read the stored
 * preference, which is after hydration, so both the server and the first client
 * render fall back to "system" and the markup matches.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();

  const order = ["light", "dark", "system"] as const;
  const current = (theme ?? "system") as (typeof order)[number];
  const next = order[(order.indexOf(current) + 1) % order.length]!;
  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;
  const label =
    current === "light"
      ? t("common.themeLight")
      : current === "dark"
        ? t("common.themeDark")
        : t("common.themeSystem");

  return (
    <Button
      variant="ghost"
      size="iconSm"
      onClick={() => setTheme(next)}
      title={`${t("common.theme")}: ${label}`}
      aria-label={`${t("common.theme")}: ${label}`}
    >
      <Icon aria-hidden />
    </Button>
  );
}

export function LocaleSwitcher({ className }: { className?: string }) {
  const { locale, t } = useI18n();
  const [pending, startTransition] = React.useTransition();

  return (
    <label className={className}>
      <span className="sr-only">{t("common.language")}</span>
      <span className="relative inline-flex items-center">
        <Languages className="pointer-events-none absolute start-2.5 size-3.5 text-muted" aria-hidden />
        <Select
          value={locale}
          disabled={pending}
          onChange={(event) => {
            const formData = new FormData();
            formData.set("locale", event.target.value);
            startTransition(async () => {
              await setLocaleAction(formData);
            });
          }}
          className="h-8 w-auto ps-8 pe-8 text-xs"
        >
          {LOCALES.map((value) => (
            <option key={value} value={value}>
              {LOCALE_LABELS[value]}
            </option>
          ))}
        </Select>
      </span>
    </label>
  );
}
