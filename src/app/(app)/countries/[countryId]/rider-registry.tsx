"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, RotateCcw, UserMinus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form-controls";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Badge,
} from "@/components/ui/surfaces";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import {
  createRiderAction,
  renameRiderAction,
  setRiderRetiredAction,
} from "@/server/actions/riders";

export interface RiderRow {
  readonly id: string;
  readonly fullName: string;
  readonly isActive: boolean;
}

export function RiderRegistry({
  countryId,
  riders,
  includeRetired,
}: {
  countryId: string;
  riders: readonly RiderRow[];
  includeRetired: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [newName, setNewName] = React.useState("");
  const [addError, setAddError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState("");
  const [retireTarget, setRetireTarget] = React.useState<RiderRow | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function add(event: React.FormEvent) {
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
      toast.success(t("countries.riderAdded"));
      inputRef.current?.focus();
      router.refresh();
    });
  }

  function saveRename(riderId: string) {
    const fullName = editingName.trim();
    if (!fullName) return;
    startTransition(async () => {
      const result = await renameRiderAction({ riderId, fullName });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditingId(null);
      toast.success(t("countries.riderUpdated"));
      router.refresh();
    });
  }

  function toggleRetired(rider: RiderRow) {
    startTransition(async () => {
      const result = await setRiderRetiredAction({
        riderId: rider.id,
        retired: rider.isActive,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setRetireTarget(null);
      toast.success(rider.isActive ? t("countries.riderRetired") : t("countries.riderRestored"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("countries.addRider")}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="flex flex-wrap items-end gap-3">
            <Field
              label={t("countries.riderName")}
              htmlFor="new-rider-name"
              error={addError}
              className="min-w-0 flex-1"
            >
              <Input
                id="new-rider-name"
                ref={inputRef}
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                maxLength={120}
                autoComplete="off"
                aria-invalid={addError ? true : undefined}
              />
            </Field>
            <Button type="submit" loading={pending} disabled={!newName.trim()}>
              <Plus aria-hidden />
              {t("common.add")}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">
          {t("countries.ridersCount", { count: riders.filter((r) => r.isActive).length })}
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
          <Checkbox
            checked={includeRetired}
            onCheckedChange={(checked) => {
              const url = new URL(window.location.href);
              if (checked) url.searchParams.set("retired", "1");
              else url.searchParams.delete("retired");
              router.replace(`${url.pathname}${url.search}`, { scroll: false });
            }}
          />
          {t("countries.showRetired")}
        </label>
      </div>

      {riders.length === 0 ? (
        <EmptyState icon={<Users />} title={t("countries.noRiders")} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-hairline">
            {riders.map((rider) => (
              <li key={rider.id} className="flex items-center gap-3 px-4 py-2.5">
                {editingId === rider.id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") saveRename(rider.id);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      maxLength={120}
                      autoFocus
                      className="h-8 flex-1"
                      aria-label={t("countries.riderName")}
                    />
                    <Button
                      size="iconSm"
                      variant="ghost"
                      onClick={() => saveRename(rider.id)}
                      aria-label={t("common.save")}
                      loading={pending}
                    >
                      <Check aria-hidden />
                    </Button>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      aria-label={t("common.cancel")}
                    >
                      <X aria-hidden />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {rider.fullName}
                      {!rider.isActive ? (
                        <Badge tone="neutral" className="ms-2">
                          {t("countries.retired")}
                        </Badge>
                      ) : null}
                    </span>
                    <Button
                      size="iconSm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(rider.id);
                        setEditingName(rider.fullName);
                      }}
                      aria-label={`${t("common.edit")}: ${rider.fullName}`}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    {rider.isActive ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => setRetireTarget(rider)}
                        aria-label={`${t("countries.retire")}: ${rider.fullName}`}
                      >
                        <UserMinus aria-hidden />
                      </Button>
                    ) : (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => toggleRetired(rider)}
                        aria-label={`${t("common.restore")}: ${rider.fullName}`}
                        loading={pending}
                      >
                        <RotateCcw aria-hidden />
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ConfirmDialog
        open={retireTarget !== null}
        onOpenChange={(open) => !open && setRetireTarget(null)}
        title={`${t("countries.retire")}: ${retireTarget?.fullName ?? ""}`}
        description={t("countries.riderInUse")}
        confirmLabel={t("countries.retire")}
        cancelLabel={t("common.cancel")}
        loading={pending}
        onConfirm={() => retireTarget && toggleRetired(retireTarget)}
      />
    </div>
  );
}
