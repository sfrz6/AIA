"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Shield, Trash2 } from "lucide-react";
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
import { useI18n } from "@/lib/i18n/client";
import {
  addChampionshipClubAction,
  removeChampionshipClubAction,
  reorderChampionshipClubsAction,
  replaceSquadAction,
} from "@/server/actions/championships";
import { listClubRidersAction } from "@/server/actions/registry-queries";
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

export interface ParticipantClub {
  readonly championshipClubId: string;
  readonly clubId: string;
  readonly name: string;
  /** The nominated squad: four active riders in starting order plus a reserve. */
  readonly squad: readonly ParticipantSquadRider[];
  /** Riders this club has on its permanent registry. */
  readonly registry: readonly SquadRiderOption[];
}

export interface AvailableClub {
  readonly id: string;
  readonly name: string;
  readonly riderCount: number;
}

export function ParticipantsManager({
  championshipId,
  clubs,
  availableClubs,
  canManageRiders,
  canManageClubs,
  championshipStarted,
}: {
  championshipId: string;
  clubs: readonly ParticipantClub[];
  availableClubs: readonly AvailableClub[];
  canManageRiders: boolean;
  canManageClubs: boolean;
  /** Once the championship's first run has started, the start list locks. */
  championshipStarted: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [reordering, setReordering] = React.useState(false);

  const canReorder = canManageClubs && !championshipStarted && clubs.length > 1;

  function moveClub(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= clubs.length || reordering) return;
    const next = [...clubs];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;

    setReordering(true);
    void reorderChampionshipClubsAction({
      championshipId,
      orderedChampionshipClubIds: next.map((club) => club.championshipClubId),
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
  const [removeTarget, setRemoveTarget] = React.useState<ParticipantClub | null>(null);

  const [addOpen, setAddOpen] = React.useState(false);
  const [addClubId, setAddClubId] = React.useState("");
  const [addRiders, setAddRiders] = React.useState<readonly SquadRiderOption[]>([]);
  const [addSelection, setAddSelection] = React.useState<SquadSelection>({});
  const [addLoading, setAddLoading] = React.useState(false);

  // Riders created from inside a picker, kept beside the server data so a new
  // rider is selectable before the page is refreshed.
  const [extraRiders, setExtraRiders] = React.useState<
    Record<string, readonly SquadRiderOption[]>
  >({});

  function ridersFor(club: ParticipantClub): readonly SquadRiderOption[] {
    const byId = new Map<string, SquadRiderOption>();
    for (const rider of club.registry) byId.set(rider.id, rider);
    // A squad can hold a rider that has since been retired, and a retired
    // rider is off the registry listing, so the squad is merged back in to
    // keep the current nomination visible and editable.
    for (const rider of club.squad) {
      if (!byId.has(rider.riderId)) {
        byId.set(rider.riderId, { id: rider.riderId, fullName: rider.fullName });
      }
    }
    for (const rider of extraRiders[club.clubId] ?? []) byId.set(rider.id, rider);
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  function startEditing(club: ParticipantClub) {
    setEditing(club.championshipClubId);
    setEditSelection(selectionFromSquad(club.squad));
  }

  function saveSquad(club: ParticipantClub) {
    if (!isSquadSavable(editSelection) || pending) return;
    startTransition(async () => {
      const result = await replaceSquadAction({
        championshipId,
        championshipClubId: club.championshipClubId,
        squad: { clubId: club.clubId, riders: squadRiders(editSelection) },
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

  function remove(club: ParticipantClub) {
    startTransition(async () => {
      const result = await removeChampionshipClubAction({
        championshipId,
        championshipClubId: club.championshipClubId,
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

  function chooseClubToAdd(clubId: string) {
    setAddClubId(clubId);
    setAddSelection({});
    setAddRiders([]);
    if (!clubId) return;
    setAddLoading(true);
    void listClubRidersAction(clubId).then((result) => {
      setAddLoading(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAddRiders(result.data);
    });
  }

  function addClub() {
    if (!addClubId || !isSquadSavable(addSelection) || pending) return;
    startTransition(async () => {
      const result = await addChampionshipClubAction({
        championshipId,
        squad: { clubId: addClubId, riders: squadRiders(addSelection) },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAddOpen(false);
      setAddClubId("");
      setAddSelection({});
      setAddRiders([]);
      toast.success(t("championships.updatedSuccess"));
      router.refresh();
    });
  }

  const addClubName =
    availableClubs.find((club) => club.id === addClubId)?.name ?? "";

  return (
    <div className="space-y-4">
      {canManageClubs ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge tone="outline">
            {t("championships.selectedClubs", { count: clubs.length })}
          </Badge>
          <Button
            onClick={() => {
              setAddOpen(true);
              chooseClubToAdd("");
            }}
            disabled={availableClubs.length === 0}
          >
            <Plus aria-hidden />
            {`${t("common.add")} ${t("common.club")}`}
          </Button>
        </div>
      ) : null}

      {canManageClubs && clubs.length > 1 ? (
        <Callout tone={championshipStarted ? "neutral" : "info"}>
          {championshipStarted
            ? t("championships.clubOrderLocked")
            : t("championships.clubOrderEditableHint")}
        </Callout>
      ) : null}

      {clubs.length === 0 ? (
        <EmptyState
          icon={<Shield />}
          title={t("championships.selectClubs")}
          description={t("championships.selectClubsHint")}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {clubs.map((club, index) => {
            const isEditing = editing === club.championshipClubId;
            const active = [...club.squad]
              .filter((rider) => rider.rosterSlot === "ACTIVE")
              .sort((a, b) => (a.initialOrder ?? 0) - (b.initialOrder ?? 0));
            const reserve = club.squad.find((rider) => rider.rosterSlot === "RESERVE");
            const squadEmpty = club.squad.length === 0;

            return (
              <Card key={club.championshipClubId}>
                <CardHeader>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="numeric inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-xs font-semibold text-muted">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {club.name}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    {canReorder && !isEditing ? (
                      <>
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => moveClub(index, -1)}
                          disabled={index === 0 || reordering}
                          aria-label={`${t("templates.moveUp")}: ${club.name}`}
                        >
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => moveClub(index, 1)}
                          disabled={index === clubs.length - 1 || reordering}
                          aria-label={`${t("templates.moveDown")}: ${club.name}`}
                        >
                          <ArrowDown aria-hidden />
                        </Button>
                      </>
                    ) : null}
                    {canManageRiders && !isEditing ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => startEditing(club)}
                        aria-label={`${t("common.edit")}: ${club.name}`}
                      >
                        <Pencil aria-hidden />
                      </Button>
                    ) : null}
                    {canManageClubs && !isEditing ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setRemoveTarget(club)}
                        aria-label={`${t("common.remove")}: ${club.name}`}
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
                        clubId={club.clubId}
                        clubName={club.name}
                        riders={ridersFor(club)}
                        value={editSelection}
                        onChange={setEditSelection}
                        onRiderAdded={(rider) =>
                          setExtraRiders((previous) => ({
                            ...previous,
                            [club.clubId]: [
                              ...(previous[club.clubId] ?? []),
                              rider,
                            ],
                          }))
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          loading={pending}
                          disabled={!isSquadSavable(editSelection)}
                          onClick={() => saveSquad(club)}
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
            <DialogTitle>{`${t("common.add")} ${t("common.club")}`}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-3">
            <Field label={t("common.club")} htmlFor="add-club" required>
              <Select
                id="add-club"
                value={addClubId}
                onChange={(event) => chooseClubToAdd(event.target.value)}
              >
                <option value="">-</option>
                {availableClubs.map((club) => (
                  <option key={club.id} value={club.id}>
                    {club.name}
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

            {addClubId && !addLoading ? (
              <SquadPicker
                clubId={addClubId}
                clubName={addClubName}
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
              disabled={!addClubId || !isSquadSavable(addSelection)}
              onClick={addClub}
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
