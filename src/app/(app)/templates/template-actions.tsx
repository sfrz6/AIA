"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, Copy, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import {
  duplicateTemplateAction,
  setTemplateArchivedAction,
} from "@/server/actions/templates";

/** Row actions on the template list: duplicate, and archive or restore. */
export function TemplateActions({
  templateId,
  templateName,
  isArchived,
}: {
  templateId: string;
  templateName: string;
  isArchived: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [confirming, setConfirming] = React.useState(false);

  function duplicate() {
    startTransition(async () => {
      const result = await duplicateTemplateAction(templateId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("templates.duplicatedSuccess"));
      router.refresh();
    });
  }

  function setArchived(archived: boolean) {
    startTransition(async () => {
      const result = await setTemplateArchivedAction({ templateId, archived });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirming(false);
      toast.success(
        archived ? t("templates.archivedSuccess") : t("templates.restoredSuccess"),
      );
      router.refresh();
    });
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="iconSm"
        variant="ghost"
        onClick={duplicate}
        loading={pending}
        aria-label={`${t("common.duplicate")}: ${templateName}`}
      >
        <Copy aria-hidden />
      </Button>
      {isArchived ? (
        <Button
          size="iconSm"
          variant="ghost"
          onClick={() => setArchived(false)}
          loading={pending}
          aria-label={`${t("common.restore")}: ${templateName}`}
        >
          <RotateCcw aria-hidden />
        </Button>
      ) : (
        <Button
          size="iconSm"
          variant="ghost"
          onClick={() => setConfirming(true)}
          aria-label={`${t("common.archive")}: ${templateName}`}
        >
          <Archive aria-hidden />
        </Button>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("templates.deleteConfirmTitle")}
        description={t("templates.deleteConfirmBody")}
        confirmLabel={t("common.archive")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={pending}
        onConfirm={() => setArchived(true)}
      />
    </div>
  );
}
