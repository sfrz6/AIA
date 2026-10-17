"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
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
import { deleteClubAction, updateClubAction } from "@/server/actions/clubs";

export interface ClubSettingsData {
  readonly id: string;
  readonly name: string;
  readonly nameAr: string | null;
}

export function ClubSettings({ club }: { club: ClubSettingsData }) {
  const { t } = useI18n();
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [name, setName] = React.useState(club.name);
  const [nameAr, setNameAr] = React.useState(club.nameAr ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function openEdit() {
    setName(club.name);
    setNameAr(club.nameAr ?? "");
    setError(null);
    setEditOpen(true);
  }

  function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await updateClubAction({ clubId: club.id, name: trimmed, nameAr: nameAr.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t("clubs.clubUpdated"));
      setEditOpen(false);
      router.refresh();
    });
  }

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteClubAction({ clubId: club.id });
      if (!result.ok) {
        toast.error(result.error);
        setDeleteOpen(false);
        return;
      }
      toast.success(t("clubs.clubDeleted"));
      router.push("/clubs");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" onClick={openEdit}>
        <Pencil aria-hidden />
        {t("common.edit")}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setDeleteOpen(true)}>
        <Trash2 aria-hidden />
        {t("common.delete")}
      </Button>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("clubs.editClub")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save}>
            <DialogBody className="space-y-4">
              <Field label={t("clubs.clubName")} htmlFor="edit-club-name" required error={error}>
                <Input
                  id="edit-club-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  autoFocus
                  required
                  aria-invalid={error ? true : undefined}
                />
              </Field>
              <Field
                label={t("clubs.clubNameAr")}
                htmlFor="edit-club-name-ar"
                hint={t("common.optional")}
              >
                <Input
                  id="edit-club-name-ar"
                  value={nameAr}
                  onChange={(event) => setNameAr(event.target.value)}
                  maxLength={120}
                  autoComplete="off"
                  dir="rtl"
                />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" loading={pending} disabled={!name.trim()}>
                {t("common.save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`${t("clubs.deleteClub")}: ${club.name}`}
        description={t("clubs.deleteClubConfirm")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
