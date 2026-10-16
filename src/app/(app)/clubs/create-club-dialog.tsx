"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form-controls";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { createClubAction } from "@/server/actions/clubs";

/**
 * A club is entered by name only, so this is the entirety of club creation:
 * no flag, logo or code to pick, unlike the national federations the system
 * used to model.
 */
export function CreateClubDialog() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [nameAr, setNameAr] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reset() {
    setName("");
    setNameAr("");
    setError(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    startTransition(async () => {
      const result = await createClubAction({ name: trimmed, nameAr: nameAr.trim() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(t("clubs.clubAdded"));
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus aria-hidden />
        {t("clubs.addClub")}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("clubs.addClub")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <DialogBody className="space-y-4">
            <Field label={t("clubs.clubName")} htmlFor="new-club-name" required error={error}>
              <Input
                id="new-club-name"
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
              htmlFor="new-club-name-ar"
              hint={t("common.optional")}
            >
              <Input
                id="new-club-name-ar"
                value={nameAr}
                onChange={(event) => setNameAr(event.target.value)}
                maxLength={120}
                autoComplete="off"
                dir="rtl"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" loading={pending} disabled={!name.trim()}>
              {t("common.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
