"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import { Badge, Callout } from "@/components/ui/surfaces";
import { CountryLabel } from "@/components/common/country-flag";
import {
  ACTIVE_RIDERS_PER_COUNTRY,
  RESERVE_RIDERS_PER_COUNTRY,
} from "@/domain/scoring/event-types";
import { useI18n } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n";
import { createRiderAction } from "@/server/actions/riders";

/** A rider on a country's permanent registry, as the picker needs it. */
export interface SquadRiderOption {
  readonly id: string;
  readonly fullName: string;
}

export const RESERVE_SLOT = "RESERVE";

/** A starting position 1 to 4, or the reserve place. */
export type SquadSlot = number | typeof RESERVE_SLOT;

/**
 * The chosen place of every nominated rider, keyed by rider identifier.
 *
 * Active or reserve is a property of this participation only: a rider carries
 * no such attribute on the registry.
 */
export type SquadSelection = Readonly<Record<string, SquadSlot>>;

export const ACTIVE_POSITIONS: readonly number[] = Array.from(
  { length: ACTIVE_RIDERS_PER_COUNTRY },
  (_, index) => index + 1,
);

function entriesOf(value: SquadSelection): ReadonlyArray<readonly [string, SquadSlot]> {
  return Object.entries(value);
}

export function countActive(value: SquadSelection): number {
  return entriesOf(value).filter(([, slot]) => slot !== RESERVE_SLOT).length;
}

export function countReserve(value: SquadSelection): number {
  return entriesOf(value).filter(([, slot]) => slot === RESERVE_SLOT).length;
}

export function isSquadComplete(value: SquadSelection): boolean {
  return (
    countActive(value) === ACTIVE_RIDERS_PER_COUNTRY &&
    countReserve(value) === RESERVE_RIDERS_PER_COUNTRY
  );
}

/** No rider nominated at all: a legitimate "decide this later" state. */
export function isSquadEmpty(value: SquadSelection): boolean {
  return entriesOf(value).length === 0;
}

/**
 * Whether a squad may be saved as it stands: the full four active riders plus
 * one reserve, or nothing at all. A squad picked halfway cannot be saved,
 * because it has no sensible meaning for the entry order screen.
 */
export function isSquadSavable(value: SquadSelection): boolean {
  return isSquadComplete(value) || isSquadEmpty(value);
}

/**
 * Live validation messages for one squad.
 *
 * Empty once the squad is complete, and also empty while nothing has been
 * picked yet, because an empty squad is a deliberate choice to decide the
 * riders later, not a mistake to flag.
 */
export function squadIssues(value: SquadSelection, t: Translator): readonly string[] {
  if (isSquadEmpty(value)) return [];
  const issues: string[] = [];
  if (countActive(value) !== ACTIVE_RIDERS_PER_COUNTRY) {
    issues.push(t("championships.needFourActive"));
  }
  if (countReserve(value) !== RESERVE_RIDERS_PER_COUNTRY) {
    issues.push(t("championships.needOneReserve"));
  }
  return issues;
}

/** Rider identifiers of the active riders, in starting order. */
export function activeInOrder(value: SquadSelection): readonly string[] {
  return entriesOf(value)
    .filter((entry): entry is readonly [string, number] => entry[1] !== RESERVE_SLOT)
    .sort((a, b) => a[1] - b[1])
    .map(([riderId]) => riderId);
}

export function reserveRiderId(value: SquadSelection): string | null {
  const entry = entriesOf(value).find(([, slot]) => slot === RESERVE_SLOT);
  return entry ? entry[0] : null;
}

/** The selection as the payload shape the server actions accept. */
export function squadRiders(value: SquadSelection): ReadonlyArray<{
  readonly riderId: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  readonly initialOrder: number | null;
}> {
  return entriesOf(value).map(([riderId, slot]) =>
    slot === RESERVE_SLOT
      ? { riderId, rosterSlot: "RESERVE" as const, initialOrder: null }
      : { riderId, rosterSlot: "ACTIVE" as const, initialOrder: slot },
  );
}

/** Rebuilds a selection from a stored squad. */
export function selectionFromSquad(
  squad: ReadonlyArray<{
    readonly riderId: string;
    readonly rosterSlot: "ACTIVE" | "RESERVE";
    readonly initialOrder: number | null;
  }>,
): SquadSelection {
  const selection: Record<string, SquadSlot> = {};
  for (const rider of squad) {
    if (rider.rosterSlot === "RESERVE") {
      selection[rider.riderId] = RESERVE_SLOT;
    } else if (rider.initialOrder !== null) {
      selection[rider.riderId] = rider.initialOrder;
    }
  }
  return selection;
}

function parseSlot(raw: string): SquadSlot | null {
  if (raw === RESERVE_SLOT) return RESERVE_SLOT;
  const position = Number(raw);
  return ACTIVE_POSITIONS.includes(position) ? position : null;
}

export interface SquadPickerProps {
  readonly countryId: string;
  readonly countryName: string;
  readonly iso2: string;
  readonly riders: readonly SquadRiderOption[];
  readonly value: SquadSelection;
  readonly onChange: (value: SquadSelection) => void;
  readonly onRiderAdded: (rider: SquadRiderOption) => void;
}

/**
 * Nominates one country's squad: four active riders in starting order plus one
 * reserve.
 *
 * A place already taken is offered as disabled rather than hidden, so two
 * riders can never hold the same starting position and the operator still sees
 * the whole grid. The remaining checks are reported live and the server
 * revalidates the squad in every case.
 */
export function SquadPicker({
  countryId,
  countryName,
  iso2,
  riders,
  value,
  onChange,
  onRiderAdded,
}: SquadPickerProps) {
  const { t } = useI18n();
  const [newName, setNewName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const takenBy = new Map<string, string>();
  for (const [riderId, slot] of entriesOf(value)) {
    takenBy.set(String(slot), riderId);
  }

  const issues = squadIssues(value, t);

  function select(riderId: string, raw: string) {
    const next: Record<string, SquadSlot> = { ...value };
    delete next[riderId];
    const slot = parseSlot(raw);
    if (slot !== null) {
      // A place can be held by one rider only, so the previous holder of the
      // chosen place loses it.
      for (const [otherId, otherSlot] of entriesOf(next)) {
        if (otherSlot === slot) delete next[otherId];
      }
      next[riderId] = slot;
    }
    onChange(next);
  }

  function addRider(event: React.FormEvent) {
    event.preventDefault();
    const fullName = newName.trim();
    if (!fullName) return;
    setAddError(null);
    startTransition(async () => {
      const result = await createRiderAction({ countryId, fullName });
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setNewName("");
      onRiderAdded({ id: result.data.id, fullName: result.data.fullName });
      inputRef.current?.focus();
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CountryLabel iso2={iso2} name={countryName} size="md" className="min-w-0 flex-1 text-sm font-medium" />
        <Badge tone={countActive(value) === ACTIVE_RIDERS_PER_COUNTRY ? "success" : "outline"}>
          {t("championships.activeRiders")} {countActive(value)}/{ACTIVE_RIDERS_PER_COUNTRY}
        </Badge>
        <Badge tone={countReserve(value) === RESERVE_RIDERS_PER_COUNTRY ? "success" : "outline"}>
          {t("championships.reserveRider")} {countReserve(value)}/{RESERVE_RIDERS_PER_COUNTRY}
        </Badge>
      </div>

      {riders.length === 0 ? (
        <p className="text-sm text-muted">{t("championships.noRidersRegistered")}</p>
      ) : (
        <ul className="divide-hairline rounded-md border border-border">
          {riders.map((rider) => {
            const slot = value[rider.id];
            return (
              <li
                key={rider.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{rider.fullName}</span>
                <div className="w-full sm:w-40">
                  <Select
                    aria-label={`${rider.fullName}, ${countryName}`}
                    value={slot === undefined ? "" : String(slot)}
                    onChange={(event) => select(rider.id, event.target.value)}
                  >
                    <option value="">-</option>
                    <optgroup label={t("championships.activeRiders")}>
                      {ACTIVE_POSITIONS.map((position) => {
                        const holder = takenBy.get(String(position));
                        return (
                          <option
                            key={position}
                            value={String(position)}
                            disabled={holder !== undefined && holder !== rider.id}
                          >
                            {position}
                          </option>
                        );
                      })}
                    </optgroup>
                    <option
                      value={RESERVE_SLOT}
                      disabled={
                        takenBy.get(RESERVE_SLOT) !== undefined &&
                        takenBy.get(RESERVE_SLOT) !== rider.id
                      }
                    >
                      {t("championships.reserveRider")}
                    </option>
                  </Select>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {issues.length > 0 ? (
        <Callout tone="warning">
          <ul className="list-inside list-disc space-y-0.5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Callout>
      ) : isSquadEmpty(value) ? (
        <Callout tone="info">{t("championships.ridersOptionalHint")}</Callout>
      ) : null}

      <form onSubmit={addRider} className="flex flex-wrap items-end gap-2">
        <Field
          label={t("championships.riderName")}
          htmlFor={`squad-new-rider-${countryId}`}
          error={addError}
          className="min-w-0 flex-1"
        >
          <Input
            id={`squad-new-rider-${countryId}`}
            ref={inputRef}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            aria-invalid={addError ? true : undefined}
          />
        </Field>
        <Button type="submit" variant="secondary" loading={pending} disabled={!newName.trim()}>
          <Plus aria-hidden />
          {t("championships.addRider")}
        </Button>
      </form>
    </div>
  );
}
