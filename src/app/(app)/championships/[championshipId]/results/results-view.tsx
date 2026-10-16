"use client";

import * as React from "react";
import Link from "next/link";
import { Download, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/surfaces";
import { useI18n } from "@/lib/i18n/client";
import type { DayNumber, StandingsScope, StandingsSubject } from "@/domain/results";
import {
  availableScopes,
  scopeLabelKey,
  tieBreakKeyOf,
  type StandingsSet,
  type StoredTieBreakEntry,
  type TieBreakRiderOption,
} from "@/components/results/standings-data";
import {
  StandingsTable,
  StandingsToggle,
  type ToggleOption,
} from "@/components/results/standings-table";
import { TieBreakDialog } from "./tie-break-dialog";

/**
 * The internal standings tab.
 *
 * Subject and scope are two plain button groups rather than a tab library, so
 * the whole table stays in one document and keyboard order.
 */
export function ResultsView({
  championshipId,
  days,
  sets,
  canManageTieBreaks,
  activeRiders,
  storedRounds,
  pdfAvailable,
}: {
  championshipId: string;
  days: readonly DayNumber[];
  sets: readonly StandingsSet[];
  canManageTieBreaks: boolean;
  activeRiders: Readonly<Record<string, readonly TieBreakRiderOption[]>>;
  storedRounds: Readonly<Record<string, readonly StoredTieBreakEntry[]>>;
  /** Whether a PDF can be produced for each scope, see `pdfAvailability`. */
  pdfAvailable: Partial<Record<StandingsScope, boolean>>;
}) {
  const { t } = useI18n();
  const [subject, setSubject] = React.useState<StandingsSubject>("INDIVIDUAL");
  const [scope, setScope] = React.useState<StandingsScope>("OVERALL");
  const [tieBreakOpen, setTieBreakOpen] = React.useState(false);

  const scopes = availableScopes(days);
  const activeScope = scopes.includes(scope) ? scope : "OVERALL";

  const subjectOptions: readonly ToggleOption<StandingsSubject>[] = [
    { value: "INDIVIDUAL", label: t("results.individual") },
    { value: "COUNTRY", label: t("results.countries") },
  ];
  const scopeOptions: readonly ToggleOption<StandingsScope>[] = scopes.map((value) => ({
    value,
    label: t(scopeLabelKey(value)),
  }));

  const set = sets.find((item) => item.scope === activeScope && item.subject === subject);
  const rows = set?.rows ?? [];
  const tiedRows = rows.filter((row) => row.isTiedAfterTieBreak);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StandingsToggle
          label={t("results.selectSubject")}
          value={subject}
          options={subjectOptions}
          onChange={(value) => setSubject(value)}
        />
        <StandingsToggle
          label={t("results.selectScope")}
          value={activeScope}
          options={scopeOptions}
          onChange={(value) => setScope(value)}
        />
        {pdfAvailable[activeScope] ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/print/results/${championshipId}/${activeScope}`} target="_blank">
              <Download aria-hidden />
              {t("publicResults.downloadPdf")}
            </Link>
          </Button>
        ) : null}
      </div>

      <Callout tone="info">{t("results.onlyConfirmed")}</Callout>

      {set?.hasUnresolvedTie ? (
        <Callout tone="warning" title={t("results.tieBreakNeeded")}>
          <p>{t("results.tieBreakHint")}</p>
          {canManageTieBreaks ? (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={() => setTieBreakOpen(true)}
            >
              <Scale aria-hidden />
              {t("results.openTieBreak")}
            </Button>
          ) : null}
        </Callout>
      ) : null}

      <StandingsTable subject={subject} scope={activeScope} days={days} rows={rows} />

      {tieBreakOpen ? (
        <TieBreakDialog
          key={tieBreakKeyOf(activeScope, subject)}
          championshipId={championshipId}
          scope={activeScope}
          subject={subject}
          tiedRows={tiedRows}
          activeRiders={activeRiders}
          storedEntries={storedRounds[tieBreakKeyOf(activeScope, subject)] ?? []}
          onClose={() => setTieBreakOpen(false)}
        />
      ) : null}
    </div>
  );
}
