import type { Executor } from "@/db";
import { auditLogs } from "@/db/schema";
import type { Principal } from "@/lib/auth/session";

export const AUDIT_ACTIONS = [
  "TEMPLATE_CREATED",
  "TEMPLATE_UPDATED",
  "TEMPLATE_DUPLICATED",
  "TEMPLATE_ARCHIVED",
  "TEMPLATE_RESTORED",
  "CHAMPIONSHIP_CREATED",
  "CHAMPIONSHIP_UPDATED",
  "CHAMPIONSHIP_DELETED",
  "CHAMPIONSHIP_PUBLISHED",
  "CHAMPIONSHIP_UNPUBLISHED",
  "CHAMPIONSHIP_COUNTRY_ADDED",
  "CHAMPIONSHIP_COUNTRY_REMOVED",
  "CHAMPIONSHIP_COUNTRIES_REORDERED",
  "CHAMPIONSHIP_SQUAD_UPDATED",
  "RIDER_CREATED",
  "RIDER_UPDATED",
  "RIDER_RETIRED",
  "RIDER_RESTORED",
  "ENTRY_ORDER_CONFIRMED",
  "RUN_STARTED",
  "RUN_SCORES_SAVED",
  "RUN_CONFIRMED",
  "RUN_CORRECTED",
  "TIE_BREAK_SAVED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "USER_PERMISSIONS_CHANGED",
  "USER_PASSWORD_CHANGED",
  "USER_BOOTSTRAPPED",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditInput {
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly championshipId?: string | null;
  readonly reason?: string | null;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * Records an action against official data.
 *
 * Always called inside the same transaction as the change it describes, so an
 * audit entry can never survive a rolled back write, and a successful write can
 * never go unrecorded. Password hashes and session identifiers are never passed
 * in; callers record only the fields an official would need to understand what
 * changed.
 */
export async function recordAudit(
  tx: Executor,
  actor: Pick<Principal, "userId" | "name"> | null,
  input: AuditInput,
): Promise<void> {
  await tx.insert(auditLogs).values({
    actorUserId: actor?.userId ?? null,
    actorName: actor?.name ?? "system",
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    championshipId: input.championshipId ?? null,
    reason: input.reason ?? null,
    beforeData: input.before ?? null,
    afterData: input.after ?? null,
  });
}
