"use client";

import * as React from "react";
import { Printer } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

/**
 * On screen controls for a printable document. Hidden when the document is
 * printed, so the paper (or PDF) copy carries nothing but the official
 * content. Shared by the officials' round sheet and the public standings
 * PDF, which both print the same way.
 */
export function PrintTrigger() {
  const { t } = useI18n();
  return (
    <div className="print-hidden mb-4 flex justify-end">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-md border border-neutral-400 px-3 py-1.5 text-sm text-black transition-colors hover:bg-neutral-100"
      >
        <Printer className="size-4" aria-hidden />
        {t("common.print")}
      </button>
    </div>
  );
}
