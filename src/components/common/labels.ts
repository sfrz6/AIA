import type { Translator, MessageKey } from "@/lib/i18n";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import type { Permission } from "@/domain/permissions";
import type { RunStatus } from "@/server/services/runs";

export function eventLabel(eventType: EventTypeKey, t: Translator): string {
  return t(`events.${eventType}` as MessageKey);
}

export function permissionLabel(permission: Permission, t: Translator): string {
  return t(`permissions.${permission}` as MessageKey);
}

const RUN_STATUS_KEYS: Record<RunStatus, MessageKey> = {
  ENTRY_ORDER_PENDING: "runs.statusEntryOrderPending",
  READY: "runs.statusReady",
  IN_PROGRESS: "runs.statusInProgress",
  REVIEW: "runs.statusReview",
  CONFIRMED: "runs.statusConfirmed",
};

export function runStatusLabel(status: RunStatus, t: Translator): string {
  return t(RUN_STATUS_KEYS[status]);
}

export function runStatusTone(
  status: RunStatus,
): "neutral" | "primary" | "accent" | "success" | "warning" | "danger" | "outline" {
  switch (status) {
    case "CONFIRMED":
      return "success";
    case "REVIEW":
      return "accent";
    case "IN_PROGRESS":
      return "primary";
    case "READY":
      return "warning";
    default:
      return "neutral";
  }
}
