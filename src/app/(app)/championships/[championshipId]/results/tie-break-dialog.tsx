"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { CountryFlag } from "@/components/common/country-flag";
import { formatPegSize, formatTime } from "@/components/common/formatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { Callout } from "@/components/ui/surfaces";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import type { StandingsScope, StandingsSubject } from "@/domain/results";
import {
  ALLOWED_TARGET_POINTS,
  TIE_BREAK_DEFAULTS,
} from "@/domain/scoring/event-types";
import { saveTieBreakRoundAction } from "@/server/actions/tie-breaks";
import type {
  StandingRow,
  StoredTieBreakEntry,
  TieBreakRiderOption,
} from "@/components/results/standings-data";

/**
 * Records one round of draws for a single scope and subject.
 *
 * The round replaces whatever was stored for that scope and subject. Leaving
 * every time blank therefore submits an empty round, which the action accepts
 * and which clears a round that was recorded by mistake.
 */

type AllowedPoints = (typeof ALLOWED_TARGET_POINTS)[number];

interface EntryDraft {
  readonly time: string;
  /** Points per rider taking part in the draw, keyed by championship rider id. */
  readonly points: Readonly<Record<string, AllowedPoints>>;
}

const TIME_PATTERN = /^\d{0,4}(\.\d{0,2})?$/;

function toAllowedPoints(value: number): AllowedPoints {
  return ALLOWED_TARGET_POINTS.find((option) => option === value) ?? 0;
}

function PointsPicker({
  value,
  onChange,
  label,
}: {
  value: AllowedPoints;
  onChange: (value: AllowedPoints) => void;
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      {ALLOWED_TARGET_POINTS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          onClick={() => onChange(option)}
          className={cn(
            "numeric h-8 w-8 border-s border-border-strong text-sm transition-colors first:border-s-0",
            option === value
              ? "bg-primary font-semibold text-primary-foreground"
              : "bg-surface-raised text-foreground hover:bg-surface-sunken",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function TieBreakDialog({
  championshipId,
  scope,
  subject,
  tiedRows,
  activeRiders,
  storedEntries,
  onClose,
}: {
  championshipId: string;
  scope: StandingsScope;
  subject: StandingsSubject;
  /** Rows that still share a rank, which are exactly the rows that ride the draw. */
  tiedRows: readonly StandingRow[];
  /** The four active riders of each country, for a country round. */
  activeRiders: Readonly<Record<string, readonly TieBreakRiderOption[]>>;
  /** The round already stored for this scope and subject, if any. */
  storedEntries: readonly StoredTieBreakEntry[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const defaults = TIE_BREAK_DEFAULTS[subject];
  const isCountry = subject === "COUNTRY";

  const ridersOf = React.useCallback(
    (row: StandingRow): readonly TieBreakRiderOption[] =>
      isCountry
        ? (activeRiders[row.key] ?? [])
        : [{ championshipRiderId: row.key, riderName: row.name }],
    [activeRiders, isCountry],
  );

  const [drafts, setDrafts] = React.useState<Readonly<Record<string, EntryDraft>>>(() => {
    const initial: Record<string, EntryDraft> = {};
    for (const row of tiedRows) {
      const stored = storedEntries.find((entry) => entry.key === row.key);
      const points: Record<string, AllowedPoints> = {};
      for (const rider of ridersOf(row)) points[rider.championshipRiderId] = 0;
      // An individual round stores one score, which prefills exactly. A country
      // round is stored as one total for the four riders, so only its time can
      // be restored rider by rider.
      if (stored && !isCountry) points[row.key] = toAllowedPoints(stored.points);
      initial[row.key] = { time: stored ? stored.timeSeconds : "", points };
    }
    return initial;
  });

  const groups = React.useMemo(() => {
    const byBaseRank = new Map<number, StandingRow[]>();
    for (const row of tiedRows) {
      const bucket = byBaseRank.get(row.baseRank);
      if (bucket) bucket.push(row);
      else byBaseRank.set(row.baseRank, [row]);
    }
    return [...byBaseRank.entries()].map(([baseRank, rows]) => ({ baseRank, rows }));
  }, [tiedRows]);

  function setTime(key: string, value: string) {
    if (!TIME_PATTERN.test(value)) return;
    setDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      return { ...current, [key]: { ...draft, time: value } };
    });
  }

  function setPoints(key: string, championshipRiderId: string, value: AllowedPoints) {
    setDrafts((current) => {
      const draft = current[key];
      if (!draft) return current;
      return {
        ...current,
        [key]: { ...draft, points: { ...draft.points, [championshipRiderId]: value } },
      };
    });
  }

  function save() {
    const entries = tiedRows.flatMap((row) => {
      const draft = drafts[row.key];
      if (!draft) return [];
      const raw = draft.time.trim();
      const seconds = Number(raw);
      // A competitor without a recorded time did not ride the draw.
      if (raw === "" || !Number.isFinite(seconds)) return [];
      const scores = ridersOf(row).map((rider) => ({
        championshipRiderId: rider.championshipRiderId,
        points: draft.points[rider.championshipRiderId] ?? 0,
      }));
      if (scores.length === 0) return [];
      return [{ subjectId: row.key, timeSeconds: seconds.toFixed(2), scores }];
    });

    startTransition(async () => {
      const result = await saveTieBreakRoundAction({
        championshipId,
        scope,
        subject,
        entries,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("results.tieBreakSaved"));
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("results.tieBreakRound")}</DialogTitle>
          <DialogDescription>{t("results.tieBreakHint")}</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <dl className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("runs.pegSize")}</dt>
              <dd className="numeric font-medium">
                {formatPegSize(defaults.pegSizeCm)} {t("common.centimetres")}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("runs.timeLimit")}</dt>
              <dd className="numeric font-medium">
                {formatTime(defaults.timeLimitSeconds)} {t("common.seconds")}
              </dd>
            </div>
          </dl>

          {groups.length === 0 ? (
            <Callout tone="neutral">{t("results.noData")}</Callout>
          ) : (
            groups.map((group) => (
              <section key={group.baseRank} className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {t("common.rank")} {group.baseRank}
                </h3>

                <div className="space-y-2">
                  {group.rows.map((row) => {
                    const draft = drafts[row.key];
                    const timeInputId = `tie-break-time-${row.key}`;
                    return (
                      <div
                        key={row.key}
                        className="space-y-2 rounded-md border border-border bg-surface-raised px-3 py-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                            <CountryFlag iso2={row.iso2} />
                            <span className="truncate">{row.name}</span>
                            {isCountry ? null : (
                              <span className="truncate text-xs text-muted">
                                {row.countryName}
                              </span>
                            )}
                          </span>

                          <span className="flex items-center gap-2">
                            {isCountry ? null : (
                              <PointsPicker
                                label={`${t("results.tieBreakPoints")}: ${row.name}`}
                                value={draft?.points[row.key] ?? 0}
                                onChange={(value) => setPoints(row.key, row.key, value)}
                              />
                            )}
                            <label htmlFor={timeInputId} className="sr-only">
                              {t("results.tieBreakTime")}
                            </label>
                            <Input
                              id={timeInputId}
                              value={draft?.time ?? ""}
                              onChange={(event) => setTime(row.key, event.target.value)}
                              inputMode="decimal"
                              autoComplete="off"
                              placeholder={t("common.time")}
                              className="numeric h-8 w-20 text-end"
                            />
                          </span>
                        </div>

                        {isCountry ? (
                          <ul className="space-y-1.5 border-t border-border pt-2">
                            {ridersOf(row).map((rider) => (
                              <li
                                key={rider.championshipRiderId}
                                className="flex flex-wrap items-center justify-between gap-2"
                              >
                                <span className="min-w-0 truncate text-sm">
                                  {rider.riderName}
                                </span>
                                <PointsPicker
                                  label={`${t("results.tieBreakPoints")}: ${rider.riderName}`}
                                  value={draft?.points[rider.championshipRiderId] ?? 0}
                                  onChange={(value) =>
                                    setPoints(row.key, rider.championshipRiderId, value)
                                  }
                                />
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </Button>
          <Button loading={pending} onClick={save}>
            <Save aria-hidden />
            {t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
