"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, CircleDashed, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge, Callout, Card, CardContent, CardHeader, CardTitle } from "@/components/ui/surfaces";
import { RadioGroup, RadioGroupItem } from "@/components/ui/form-controls";
import { CountryFlag } from "@/components/common/country-flag";
import { useI18n } from "@/lib/i18n/client";
import { confirmEntryOrderAction } from "@/server/actions/runs";
import {
  inheritedEntryOrder,
  validateEntryOrder,
  type RosterMember,
} from "@/domain/entry-order";
import { RIDERS_PER_COUNTRY_PER_RUN } from "@/domain/scoring/event-types";

export interface EntryOrderRoster {
  readonly championshipRiderId: string;
  readonly fullName: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  readonly initialOrder: number | null;
}

export interface EntryOrderCountry {
  readonly championshipCountryId: string;
  readonly iso2: string;
  readonly countryName: string;
  readonly decision: "NO_CHANGE" | "CHANGED" | null;
  readonly previousOrder: readonly string[];
  readonly confirmedOrder: readonly string[];
  readonly roster: readonly EntryOrderRoster[];
}

function toRosterMembers(roster: readonly EntryOrderRoster[]): RosterMember[] {
  return roster.map((member) => ({
    championshipRiderId: member.championshipRiderId,
    rosterSlot: member.rosterSlot,
    initialOrder: member.initialOrder,
  }));
}

function CountryEntryOrder({
  championshipId,
  runId,
  country,
  canManage,
  onSaved,
}: {
  championshipId: string;
  runId: string;
  country: EntryOrderCountry;
  canManage: boolean;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const members = React.useMemo(() => toRosterMembers(country.roster), [country.roster]);
  const names = React.useMemo(
    () => new Map(country.roster.map((member) => [member.championshipRiderId, member.fullName])),
    [country.roster],
  );

  const baseline = React.useMemo(
    () =>
      country.confirmedOrder.length > 0
        ? [...country.confirmedOrder]
        : [...inheritedEntryOrder(country.previousOrder, members)],
    [country.confirmedOrder, country.previousOrder, members],
  );

  const [mode, setMode] = React.useState<"NO_CHANGE" | "CHANGED">(
    country.decision ?? "NO_CHANGE",
  );
  const [order, setOrder] = React.useState<string[]>(baseline);
  const [pending, startTransition] = React.useTransition();

  const reserves = country.roster.filter(
    (member) => !order.includes(member.championshipRiderId),
  );
  const invalid = validateEntryOrder(members, order, RIDERS_PER_COUNTRY_PER_RUN);

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    const current = next[index]!;
    next[index] = next[target]!;
    next[target] = current;
    setOrder(next);
  }

  function substitute(index: number, championshipRiderId: string) {
    const next = [...order];
    next[index] = championshipRiderId;
    setOrder(next);
  }

  function save() {
    startTransition(async () => {
      const result = await confirmEntryOrderAction({
        runId,
        championshipCountryId: country.championshipCountryId,
        decision: mode,
        order: mode === "CHANGED" ? order : undefined,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("runs.entryOrderSaved"));
      onSaved();
    });
  }

  const confirmed = country.decision !== null;

  return (
    <Card
      className={cn(
        "print-avoid-break",
        confirmed ? "border-success/40" : "border-warning/40",
      )}
    >
      <CardHeader className="py-2.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <CountryFlag iso2={country.iso2} size="md" />
          {country.countryName}
        </CardTitle>
        {confirmed ? (
          <Badge tone="success">
            <Check className="size-3" aria-hidden />
            {country.decision === "NO_CHANGE" ? t("runs.noChange") : t("runs.changeOrder")}
          </Badge>
        ) : (
          <Badge tone="warning">
            <CircleDashed className="size-3" aria-hidden />
            {t("runs.notReviewed")}
          </Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {canManage ? (
          <RadioGroup
            value={mode}
            onValueChange={(value) => {
              const next = value as "NO_CHANGE" | "CHANGED";
              setMode(next);
              if (next === "NO_CHANGE") {
                setOrder([...inheritedEntryOrder(country.previousOrder, members)]);
              }
            }}
            className="flex flex-wrap gap-4"
          >
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="NO_CHANGE" id={`nc-${country.championshipCountryId}`} />
              {t("runs.noChange")}
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <RadioGroupItem value="CHANGED" id={`ch-${country.championshipCountryId}`} />
              {t("runs.changeOrder")}
            </label>
          </RadioGroup>
        ) : null}

        <ol className="divide-hairline overflow-hidden rounded-md border border-border">
          {order.map((riderId, index) => (
            <li
              key={`${riderId}-${index}`}
              className="flex items-center gap-2 bg-surface-raised px-3 py-2"
            >
              <span className="numeric inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-xs font-semibold text-muted">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {names.get(riderId) ?? t("common.unknown")}
              </span>
              {canManage && mode === "CHANGED" ? (
                <>
                  {reserves.length > 0 ? (
                    <select
                      value=""
                      onChange={(event) => {
                        if (event.target.value) substitute(index, event.target.value);
                      }}
                      aria-label={`${t("runs.substitute")}: ${names.get(riderId) ?? ""}`}
                      className="h-7 rounded-md border border-border-strong bg-surface-raised px-2 text-xs"
                    >
                      <option value="">{t("runs.substitute")}</option>
                      {reserves.map((member) => (
                        <option key={member.championshipRiderId} value={member.championshipRiderId}>
                          {member.fullName}
                          {member.rosterSlot === "RESERVE"
                            ? ` (${t("runs.reserveAvailable")})`
                            : ""}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={t("templates.moveUp")}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    size="iconSm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === order.length - 1}
                    aria-label={t("templates.moveDown")}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                </>
              ) : null}
            </li>
          ))}
        </ol>

        {invalid ? (
          <Callout tone="danger">
            <p>{invalid.message}</p>
            {invalid.code === "INCOMPLETE_ROSTER" ? (
              <Button variant="secondary" size="sm" className="mt-2" asChild>
                <Link href={`/championships/${championshipId}/participants`}>
                  <UserPlus aria-hidden />
                  {t("runs.addRidersLink")}
                </Link>
              </Button>
            ) : null}
          </Callout>
        ) : null}

        {canManage ? (
          <div className="flex justify-end">
            <Button size="sm" loading={pending} disabled={invalid !== null} onClick={save}>
              <Check aria-hidden />
              {confirmed ? t("common.save") : t("runs.confirmCountry")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function EntryOrderPanel({
  championshipId,
  runId,
  countries,
  confirmedCount,
  totalCount,
  canManage,
  locked,
  editableWhileScoring,
}: {
  championshipId: string;
  runId: string;
  countries: readonly EntryOrderCountry[];
  confirmedCount: number;
  totalCount: number;
  canManage: boolean;
  /**
   * True for every run after the first in its event: the lineup can only be
   * set once per event, so these runs carry over the first run's order
   * automatically once every country has confirmed it there, rather than
   * asking for a fresh confirmation before each run.
   */
  locked: boolean;
  /** True when this panel is showing again mid-scoring, before any score is saved. */
  editableWhileScoring?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{t("runs.entryOrdersTitle")}</h3>
        <Callout tone={editableWhileScoring ? "warning" : "info"}>
          {locked
            ? t("runs.entryOrdersLockedHint")
            : editableWhileScoring
              ? t("runs.entryOrdersEditableWhileScoringHint")
              : t("runs.entryOrdersHint")}
        </Callout>
        <p className="text-xs text-muted">
          {t("runs.countriesConfirmed", { confirmed: confirmedCount, total: totalCount })}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {countries.map((country) => (
          <CountryEntryOrder
            key={country.championshipCountryId}
            championshipId={championshipId}
            runId={runId}
            country={country}
            canManage={canManage}
            onSaved={() => router.refresh()}
          />
        ))}
      </div>
    </section>
  );
}
