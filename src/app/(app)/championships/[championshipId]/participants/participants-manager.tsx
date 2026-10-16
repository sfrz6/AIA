"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Flag, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form-controls";
import { Badge, Callout, Card, CardContent, CardHeader, EmptyState } from "@/components/ui/surfaces";
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CountryLabel } from "@/components/common/country-flag";
import { useI18n } from "@/lib/i18n/client";
import {
  addChampionshipCountryAction,
  removeChampionshipCountryAction,
  reorderChampionshipCountriesAction,
  replaceSquadAction,
} from "@/server/actions/championships";
import { listCountryRidersAction } from "@/server/actions/registry-queries";
import {
  SquadPicker,
  isSquadSavable,
  selectionFromSquad,
  squadRiders,
  type SquadRiderOption,
  type SquadSelection,
} from "../../squad-picker";

export interface ParticipantSquadRider {
  readonly riderId: string;
  readonly fullName: string;
  readonly rosterSlot: "ACTIVE" | "RESERVE";
  readonly initialOrder: number | null;
}

export interface ParticipantCountry {
  readonly championshipCountryId: string;
  readonly countryId: string;
  readonly iso2: string;
  readonly name: string;
  /** The nominated squad: four active riders in starting order plus a reserve. */
  readonly squad: readonly ParticipantSquadRider[];
  /** Riders this country has on its permanent registry. */
  readonly registry: readonly SquadRiderOption[];
}

export interface AvailableCountry {
  readonly id: string;
  readonly iso2: string;
  readonly name: string;
  readonly riderCount: number;
}

export function ParticipantsManager({
  championshipId,
  countries,
  availableCountries,
  canManageRiders,
  canManageCountries,
  championshipStarted,
}: {
  championshipId: string;
  countries: readonly ParticipantCountry[];
  availableCountries: readonly AvailableCountry[];
  canManageRiders: boolean;
  canManageCountries: boolean;
  /** Once the championship's first run has started, the start list locks. */
  championshipStarted: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reordering, setReordering] = React.useState(false);

  const canReorder = canManageCountries && !championshipStarted && countries.length > 1;

  function moveCountry(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= countries.length || reordering) return;
    const next = [...countries];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;

    setReordering(true);
    void reorderChampionshipCountriesAction({
      championshipId,
      orderedChampionshipCountryIds: next.map((country) => country.championshipCountryId),
    }).then((result) => {
      setReordering(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  const [editing, setEditing] = React.useState<string | null>(null);
  const [editSelection, setEditSelection] = React.useState<SquadSelection>({});
  const [removeTarget, setRemoveTarget] = React.useState<ParticipantCountry | null>(null);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addCountryId, setAddCountryId] = React.useState("");
  const [addRiders, setAddRiders] = React.useState<readonly SquadRiderOption[]>([]);
  const [addSelection, setAddSelection] = React.useState<SquadSelection>({});
  const [addLoading, setAddLoading] = React.useState(false);

  // Riders created from inside a picker, kept beside the server data so a new
  // rider is selectable before the page is refreshed.
  const [extraRiders, setExtraRiders] = React.useState<
    Record<string, readonly SquadRiderOption[]>
  >({});

  function ridersFor(country: ParticipantCountry): readonly SquadRiderOption[] {
    const byId = new Map<string, SquadRiderOption>();
    for (const rider of country.registry) byId.set(rider.id, rider);
    // A squad can hold a rider that has since been retired, and a retired
    // rider is off the registry listing, so the squad is merged back in to
    // keep the current nomination visible and editable.
    for (const rider of country.squad) {
      if (!byId.has(rider.riderId)) {
        byId.set(rider.riderId, { id: rider.riderId, fullName: rider.fullName });
      }
    }
    for (const rider of extraRiders[country.countryId] ?? []) byId.set(rider.id, rider);
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function startEditing(country: ParticipantCountry) {
    setEditing(country.championshipCountryId);
    setEditSelection(selectionFromSquad(country.squad));
  }

  function saveSquad(country: ParticipantCountry) {
    if (!isSquadSavable(editSelection) || pending) return;
    startTransition(async () => {
      const result = await replaceSquadAction({
        championshipId,
        championshipCountryId: country.championshipCountryId,
        squad: { countryId: country.countryId, riders: squadRiders(editSelection) },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(null);
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  function remove(country: ParticipantCountry) {
    startTransition(async () => {
      const result = await removeChampionshipCountryAction({
        championshipId,
        championshipCountryId: country.championshipCountryId,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRemoveTarget(null);
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  function chooseCountryToAdd(countryId: string) {
    setAddCountryId(countryId);
    setAddSelection({});
    setAddRiders([]);
    if (!countryId) return;
    setAddLoading(true);
    void listCountryRidersAction(countryId).then((result) => {
      setAddLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAddRiders(result.data);
    });
  }

  function addCountry() {
    if (!addCountryId || !isSquadSavable(addSelection) || pending) return;
    startTransition(async () => {
      const result = await addChampionshipCountryAction({
        championshipId,
        squad: { countryId: addCountryId, riders: squadRiders(addSelection) },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAddOpen(false);
      setAddCountryId("");
      setAddSelection({});
      setAddRiders([]);
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  const addCountryName =
    availableCountries.find((country) => country.id === addCountryId)?.name ?? "";
  const addCountryIso2 =
    availableCountries.find((country) => country.id === addCountryId)?.iso2 ?? "";

  return (
    <div className="space-y-4">
      {canManageCountries ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone="outline">
            {t("championships.selectedCountries", { count: countries.length })}
          </Badge>
          <Button
            onClick={() => {
              setAddOpen(true);
              chooseCountryToAdd("");
            }}
            disabled={availableCountries.length === 0}
          >
            <Plus aria-hidden />
            {`${t("common.add")} ${t("common.country")}`}
          </Button>
        </div>
      ) : null}

      {canManageCountries && countries.length > 1 ? (
        <Callout tone={championshipStarted ? "neutral" : "info"}>
          {championshipStarted
            ? t("championships.countryOrderLocked")
            : t("championships.countryOrderEditableHint")}
        </Callout>
      ) : null}

      {countries.length === 0 ? (
        <EmptyState
          icon={<Flag />}
          title={t("championships.selectCountries")}
          description={t("championships.selectCountriesHint")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {countries.map((country, index) => {
            const isEditing = editing === country.championshipCountryId;
            const active = [...country.squad]
              .filter((rider) => rider.rosterSlot === "ACTIVE")
              .sort((a, b) => (a.initialOrder ?? 0) - (b.initialOrder ?? 0));
            const reserve = country.squad.find((rider) => rider.rosterSlot === "RESERVE");
            const squadEmpty = country.squad.length === 0;

            return (
              <Card key={country.championshipCountryId}>
                <CardHeader>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="numeric inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-xs font-semibold text-muted">
                      {index + 1}
                    </span>
                    <CountryLabel
                      iso2={country.iso2}
                      name={country.name}
                      size="md"
                      className="min-w-0 flex-1 text-sm font-semibold"
                    />
                  </span>
                  <div className="flex items-center gap-1">
                    {canReorder && !isEditing ? (
                      <>
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => moveCountry(index, -1)}
                          disabled={index === 0 || reordering}
                          aria-label={`${t("templates.moveUp")}: ${country.name}`}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => moveCountry(index, 1)}
                          disabled={index === countries.length - 1 || reordering}
                          aria-label={`${t("templates.moveDown")}: ${country.name}`}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                      </>
                    ) : null}
                    {canManageRiders && !isEditing ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => startEditing(country)}
                        aria-label={`${t("common.edit")}: ${country.name}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    ) : null}
                    {canManageCountries && !isEditing ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setRemoveTarget(country)}
                        aria-label={`${t("common.remove")}: ${country.name}`}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent>
                  {isEditing ? (
                    <div className="space-y-3">
                      <SquadPicker
                        countryId={country.countryId}
                        countryName={country.name}
                        iso2={country.iso2}
                        riders={ridersFor(country)}
                        value={editSelection}
                        onChange={setEditSelection}
                        onRiderAdded={(rider) =>
                          setExtraRiders((previous) => ({
                            ...previous,
                            [country.countryId]: [
                              ...(previous[country.countryId] ?? []),
                              rider,
                            ],
                          }))
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          loading={pending}
                          disabled={!isSquadSavable(editSelection)}
                          onClick={() => saveSquad(country)}
                        >
                          {t("common.save")}
                        </Button>
                        <Button variant="ghost" onClick={() => setEditing(null)}>
                          {t("common.cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : squadEmpty ? (
                    <Callout tone="info">{t("championships.ridersNotSelectedYet")}</Callout>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                        {t("championships.activeRiders")}
                      </p>
                      {active.length === 0 ? (
                        <p className="text-sm text-muted">
                          {t("championships.needFourActive")}
                        </p>
                      ) : (
                        <ol className="divide-hairline rounded-md border border-border">
                          {active.map((rider) => (
                            <li
                              key={rider.riderId}
                              className="flex items-center gap-3 px-3 py-2"
                            >
                              <span className="numeric w-5 text-xs text-muted">
                                {rider.initialOrder}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {rider.fullName}
                              </span>
                            </li>
                          ))}
                        </ol>
                      )}
                      <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-muted">
                        {t("championships.reserveRider")}
                      </p>
                      {reserve ? (
                        <p className="rounded-md border border-border px-3 py-2 text-sm">
                          {reserve.fullName}
                        </p>
                      ) : (
                        <p className="text-sm text-muted">{t("championships.needOneReserve")}</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`${t("common.add")} ${t("common.country")}`}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label={t("common.country")} htmlFor="add-country" required>
              <Select
                id="add-country"
                value={addCountryId}
                onChange={(event) => chooseCountryToAdd(event.target.value)}
              >
                <option value="">-</option>
                {availableCountries.map((country) => (
                  <option key={country.id} value={country.id}>
                    {country.name}
                  </option>
                ))}
              </Select>
            </Field>

            {addLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                {t("common.loading")}
              </p>
            ) : null}

            {addCountryId && !addLoading ? (
              <SquadPicker
                countryId={addCountryId}
                countryName={addCountryName}
                iso2={addCountryIso2}
                riders={addRiders}
                value={addSelection}
                onChange={setAddSelection}
                onRiderAdded={(rider) => setAddRiders((previous) => [...previous, rider])}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={pending}
              disabled={!addCountryId || !isSquadSavable(addSelection)}
              onClick={addCountry}
            >
              {t("common.add")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={`${t("common.remove")}: ${removeTarget?.name ?? ""}`}
        confirmLabel={t("common.remove")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={() => removeTarget && remove(removeTarget)}
      />
    </div>
  );
}
