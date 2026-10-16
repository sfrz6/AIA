"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { deleteChampionshipAction } from "@/server/actions/championships";

/** Permanently deletes a championship from the list row, admin only. */
export function ChampionshipDeleteButton({
  championshipId,
  championshipName,
}: {
  championshipId: string;
  championshipName: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  function remove() {
    startTransition(async () => {
      const result = await deleteChampionshipAction({ championshipId });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      toast.success(t("championships.deletedSuccess"));
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="iconSm"
        variant="ghost"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setConfirming(true);
        }}
        aria-label={`${t("championships.deleteChampionship")}: ${championshipName}`}
      >
        <Trash2 aria-hidden />
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("championships.deleteConfirmTitle")}
        description={t("championships.deleteConfirmBody")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={remove}
      />
    </>
  );
}
