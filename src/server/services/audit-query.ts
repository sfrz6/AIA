import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditLogs, users } from "@/db/schema";

/**
 * One recorded action.
 *
 * `beforeData` and `afterData` stay `unknown`: every writer records the fields
 * that matter for its own entity, so the viewer renders them as formatted JSON
 * rather than pretending they share one shape.
 */
export interface AuditEntry {
  readonly id: string;
  readonly actorName: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly championshipId: string | null;
  readonly reason: string | null;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly createdAt: Date;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export interface AuditQueryOptions {
  readonly championshipId?: string;
  readonly limit?: number;
  readonly before?: Date;
}

/**
 * Recorded actions, newest first.
 *
 * The actor's current name is taken from the user row so a renamed official
 * reads consistently across the log, falling back to the name stored at the
 * time when the account has since been removed or the action came from a
 * maintenance script.
 */
export async function listAuditEntries(
  options: AuditQueryOptions = {},
): Promise<readonly AuditEntry[]> {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );

  const filters = [
    options.championshipId ? eq(auditLogs.championshipId, options.championshipId) : undefined,
    options.before ? lt(auditLogs.createdAt, options.before) : undefined,
  ].filter((filter) => filter !== undefined);

  return getDb()
    .select({
      id: auditLogs.id,
      actorName: sql<string>`coalesce(${users.name}, ${auditLogs.actorName})`,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      championshipId: auditLogs.championshipId,
      reason: auditLogs.reason,
      beforeData: auditLogs.beforeData,
      afterData: auditLogs.afterData,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
