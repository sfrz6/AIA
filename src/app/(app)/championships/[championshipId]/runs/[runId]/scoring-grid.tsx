"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/surfaces";
import { Input } from "@/components/ui/form-controls";
import { useI18n } from "@/lib/i18n/client";
import {
  allowedTargetPoints,
  getEventTypeDefinition,
  type EventTypeKey,
} from "@/domain/scoring/event-types";
import { scoreRun, type RunScoringInput } from "@/domain/scoring/engine";
import { dec, formatPoints, ZERO } from "@/domain/scoring/decimal";
import { targetLabels } from "@/components/common/target-labels";

export interface ScoringRider {
  readonly runScoreId: string;
  readonly championshipRiderId: string;
  readonly riderName: string;
  readonly positionInUnit: number;
  readonly targets: readonly (string | null)[];
}

export interface ScoringUnit {
  readonly runScoringUnitId: string;
  readonly unitIndex: number;
  readonly timeSeconds: string | null;
  readonly riders: readonly ScoringRider[];
}

export interface ScoringClub {
  readonly championshipClubId: string;
  readonly clubName: string;
  readonly units: readonly ScoringUnit[];
}

export interface ScoringDraft {
  /** Recorded time per scoring unit, as typed. */
  readonly times: Readonly<Record<string, string>>;
  /** Target points per rider, `null` where nothing has been recorded. */
  readonly points: Readonly<Record<string, readonly (number | null)[]>>;
}

export function buildDraft(clubs: readonly ScoringClub[]): ScoringDraft {
  const times: Record<string, string> = {};
  const points: Record<string, (number | null)[]> = {};

  for (const club of clubs) {
    for (const unit of club.units) {
      times[unit.runScoringUnitId] = unit.timeSeconds ?? "";
      for (const rider of unit.riders) {
        points[rider.runScoreId] = rider.targets.map((value) =>
          value === null || value === undefined ? null : Number(value),
        );
      }
    }
  }

  return { times, points };
}

const TIME_PATTERN = /^\d{0,4}(\.\d{0,2})?$/;

export function isDraftComplete(
  clubs: readonly ScoringClub[],
  draft: ScoringDraft,
): boolean {
  for (const club of clubs) {
    for (const unit of club.units) {
      const time = draft.times[unit.runScoringUnitId];
      if (!time || !Number.isFinite(Number(time))) return false;
      for (const rider of unit.riders) {
        const values = draft.points[rider.runScoreId];
        if (!values || values.some((value) => value === null)) return false;
      }
    }
  }
  return clubs.length > 0;
}

/** Converts the draft into the payload the save and correct actions accept. */
export function draftToPayload(
  clubs: readonly ScoringClub[],
  draft: ScoringDraft,
): {
  units: Array<{ runScoringUnitId: string; timeSeconds: string | null }>;
  scores: Array<{ runScoreId: string; targets: Array<number | null> }>;
} {
  const units: Array<{ runScoringUnitId: string; timeSeconds: string | null }> = [];
  const scores: Array<{ runScoreId: string; targets: Array<number | null> }> = [];

  for (const club of clubs) {
    for (const unit of club.units) {
      const raw = draft.times[unit.runScoringUnitId]?.trim() ?? "";
      units.push({
        runScoringUnitId: unit.runScoringUnitId,
        timeSeconds: raw === "" ? null : Number(raw).toFixed(2),
      });
      for (const rider of unit.riders) {
        scores.push({
          runScoreId: rider.runScoreId,
          targets: [...(draft.points[rider.runScoreId] ?? [])],
        });
      }
    }
  }

  return { units, scores };
}

function PointPicker({
  value,
  onChange,
  disabled,
  label,
  options,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled: boolean;
  label: string;
  options: readonly number[];
}) {
  const { t } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label={t("runs.didNotScore")}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          "h-8 w-7 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
          value === null
            ? "bg-surface-sunken font-semibold text-foreground"
            : "bg-surface-raised text-subtle hover:bg-surface-sunken",
        )}
      >
        -
      </button>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            "numeric h-8 w-8 border-s border-border-strong text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            value === option
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

export function ScoringGrid({
  eventType,
  timeLimitSeconds,
  clubs,
  draft,
  onChange,
  readOnly = false,
  confirmedDayTotalByClub,
}: {
  eventType: EventTypeKey;
  timeLimitSeconds: string;
  clubs: readonly ScoringClub[];
  draft: ScoringDraft;
  onChange: (next: ScoringDraft) => void;
  readOnly?: boolean;
  /** Every other confirmed run's contribution today, per club, so the day total can be shown live. */
  confirmedDayTotalByClub: Readonly<Record<string, string>>;
}) {
  const { t } = useI18n();
  const definition = getEventTypeDefinition(eventType);
  const labels = targetLabels(eventType, definition.targetsPerRider, t);
  const isTeamUnit = definition.ridersPerScoringUnit > 1;

  // The same pure engine that scores the run on the server computes the
  // preview, so what the operator sees while typing is exactly what will be
  // stored once the run is confirmed.
  const computed = React.useMemo(() => {
    const input: RunScoringInput = {
      eventTypeKey: eventType,
      timeLimitSeconds,
      units: clubs.flatMap((club) =>
        club.units.map((unit) => {
          const raw = draft.times[unit.runScoringUnitId]?.trim() ?? "";
          return {
            unitIndex: unit.unitIndex,
            championshipClubId: club.championshipClubId,
            timeSeconds: raw === "" || !Number.isFinite(Number(raw)) ? null : raw,
            riders: unit.riders.map((rider) => ({
              championshipRiderId: rider.championshipRiderId,
              positionInUnit: rider.positionInUnit,
              targets: [...(draft.points[rider.runScoreId] ?? [])],
            })),
          };
        }),
      ),
    };

    const result = scoreRun(input);
    const unitsByKey = new Map(
      result.units.map((unit) => [`${unit.championshipClubId}:${unit.unitIndex}`, unit]),
    );
    const ridersById = new Map(
      result.riders.map((rider) => [rider.championshipRiderId, rider]),
    );
    const clubsById = new Map(
      result.clubs.map((club) => [club.championshipClubId, club]),
    );
    return { unitsByKey, ridersById, clubsById };
  }, [clubs, draft, eventType, timeLimitSeconds]);

  function setTime(unitId: string, value: string) {
    if (!TIME_PATTERN.test(value)) return;
    onChange({ ...draft, times: { ...draft.times, [unitId]: value } });
  }

  function setPoint(scoreId: string, targetIndex: number, value: number | null) {
    const current = [...(draft.points[scoreId] ?? [])];
    current[targetIndex] = value;
    onChange({ ...draft, points: { ...draft.points, [scoreId]: current } });
  }

  return (
    <div className="space-y-4">
      {clubs.map((club) => {
        const clubResult = computed.clubsById.get(club.championshipClubId);
        return (
          <Card key={club.championshipClubId} className="print-avoid-break">
            <CardHeader className="py-2.5">
              <CardTitle className="flex items-center gap-2 text-sm">
                {club.clubName}
              </CardTitle>
              {clubResult ? (
                <dl className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted">{t("runs.rawPoints")}</dt>
                    <dd className="numeric font-semibold">
                      {formatPoints(clubResult.riderPointsTotal)}
                    </dd>
                  </div>
                  {isTeamUnit ? (
                    <div className="flex items-center gap-1.5">
                      <dt className="text-muted">{t("runs.penalty")}</dt>
                      <dd className="numeric font-semibold text-danger">
                        {formatPoints(clubResult.clubPenaltyTotal)}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted">{t("common.total")}</dt>
                    <dd className="numeric font-semibold">
                      {formatPoints(clubResult.total)}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-muted">{t("runs.dayTotal")}</dt>
                    <dd className="numeric font-semibold text-primary">
                      {formatPoints(
                        dec(confirmedDayTotalByClub[club.championshipClubId] ?? ZERO).plus(
                          clubResult.total,
                        ),
                      )}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </CardHeader>

            <CardContent className="space-y-3">
              {club.units.map((unit) => {
                const unitResult = computed.unitsByKey.get(
                  `${club.championshipClubId}:${unit.unitIndex}`,
                );
                const unitTitle =
                  definition.ruleType === "PAIR"
                    ? t("runs.pairLabel", { number: unit.unitIndex + 1 })
                    : definition.ruleType === "TEAM" || definition.ruleType === "RELAY"
                      ? t("runs.teamLabel")
                      : null;

                return (
                  <div
                    key={unit.runScoringUnitId}
                    className="overflow-hidden rounded-md border border-border"
                  >
                    {unitTitle ? (
                      <div className="border-b border-border bg-surface-sunken px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                        {unitTitle}
                      </div>
                    ) : null}

                    <div className="divide-hairline">
                      {unit.riders.map((rider) => {
                        const riderResult = computed.ridersById.get(rider.championshipRiderId);
                        return (
                          <div
                            key={rider.runScoreId}
                            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2"
                          >
                            <span className="flex min-w-0 flex-1 basis-40 items-center gap-2">
                              <span className="numeric inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-xs font-semibold text-muted">
                                {rider.positionInUnit}
                              </span>
                              <span className="truncate text-sm">{rider.riderName}</span>
                            </span>

                            <span className="flex flex-wrap items-center gap-3">
                              {Array.from({ length: definition.targetsPerRider }, (_, index) => (
                                <span key={index} className="flex flex-col gap-1">
                                  {definition.targetsPerRider > 1 ? (
                                    <span className="text-[0.625rem] uppercase tracking-wide text-subtle">
                                      {labels[index]}
                                    </span>
                                  ) : null}
                                  <PointPicker
                                    value={draft.points[rider.runScoreId]?.[index] ?? null}
                                    onChange={(value) => setPoint(rider.runScoreId, index, value)}
                                    disabled={readOnly}
                                    label={`${rider.riderName}: ${labels[index] ?? ""}`}
                                    options={allowedTargetPoints(definition, index)}
                                  />
                                </span>
                              ))}
                            </span>

                            {!isTeamUnit && definition.ruleType !== "PAIR" ? (
                              <span className="flex items-center gap-2">
                                <label
                                  className="text-[0.625rem] uppercase tracking-wide text-subtle"
                                  htmlFor={`time-${unit.runScoringUnitId}`}
                                >
                                  {t("runs.enterTime")}
                                </label>
                                <Input
                                  id={`time-${unit.runScoringUnitId}`}
                                  value={draft.times[unit.runScoringUnitId] ?? ""}
                                  onChange={(event) =>
                                    setTime(unit.runScoringUnitId, event.target.value)
                                  }
                                  disabled={readOnly}
                                  inputMode="decimal"
                                  autoComplete="off"
                                  className="numeric h-8 w-20 text-end"
                                  aria-label={`${rider.riderName}: ${t("runs.enterTime")}`}
                                />
                              </span>
                            ) : null}

                            {riderResult ? (
                              <span className="numeric ms-auto text-sm font-semibold tabular-nums">
                                {formatPoints(riderResult.netPoints)}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>

                    {isTeamUnit || definition.ruleType === "PAIR" ? (
                      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-border bg-surface-sunken px-3 py-2">
                        <span className="flex items-center gap-2">
                          <label
                            className="text-xs text-muted"
                            htmlFor={`time-${unit.runScoringUnitId}`}
                          >
                            {t("runs.enterTime")}
                          </label>
                          <Input
                            id={`time-${unit.runScoringUnitId}`}
                            value={draft.times[unit.runScoringUnitId] ?? ""}
                            onChange={(event) =>
                              setTime(unit.runScoringUnitId, event.target.value)
                            }
                            disabled={readOnly}
                            inputMode="decimal"
                            autoComplete="off"
                            className="numeric h-8 w-20 text-end"
                            aria-label={`${unitTitle ?? club.clubName}: ${t("runs.enterTime")}`}
                          />
                        </span>
                        {unitResult ? (
                          <>
                            <span className="text-xs text-muted">
                              {t("runs.penalty")}{" "}
                              <span className="numeric font-semibold text-danger">
                                {formatPoints(unitResult.penalty)}
                              </span>
                            </span>
                            <span className="text-xs text-muted">
                              {t("runs.netPoints")}{" "}
                              <span className="numeric font-semibold text-foreground">
                                {formatPoints(unitResult.netPoints)}
                              </span>
                            </span>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
