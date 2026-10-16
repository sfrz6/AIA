import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db";
import { userPermissions, users } from "@/db/schema";
import type { Permission } from "@/domain/permissions";

/**
 * Account as shown to an administrator.
 *
 * The password hash is deliberately absent from this type: no query in this
 * module selects it, so it cannot reach a page, a log or an audit entry.
 */
export interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly permissions: readonly Permission[];
}

export type UserDetail = UserSummary;

const accountColumns = {
  id: users.id,
  name: users.name,
  username: users.username,
  isAdmin: users.isAdmin,
  isActive: users.isActive,
  createdAt: users.createdAt,
};

/** Granted capabilities for several users, grouped by user. */
async function permissionsByUser(
  executor: Executor,
  userIds: readonly string[],
): Promise<Map<string, Permission[]>> {
  const grouped = new Map<string, Permission[]>();
  if (userIds.length === 0) return grouped;

  const rows = await executor
    .select({ userId: userPermissions.userId, permission: userPermissions.permission })
    .from(userPermissions)
    .where(inArray(userPermissions.userId, [...userIds]));

  for (const row of rows) {
    const existing = grouped.get(row.userId);
    if (existing) existing.push(row.permission);
    else grouped.set(row.userId, [row.permission]);
  }
  return grouped;
}

/**
 * Every account, active ones first and then alphabetically.
 *
 * Permissions are fetched for the whole page in one extra query and grouped in
 * memory, so adding users never adds queries.
 */
export async function listUsers(): Promise<readonly UserSummary[]> {
  const db = getDb();

  const rows = await db
    .select(accountColumns)
    .from(users)
    .orderBy(desc(users.isActive), asc(users.name));

  const grouped = await permissionsByUser(
    db,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({ ...row, permissions: grouped.get(row.id) ?? [] }));
}

export async function getUser(userId: string): Promise<UserDetail | null> {
  const db = getDb();

  const [row] = await db.select(accountColumns).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;

  const grouped = await permissionsByUser(db, [row.id]);
  return { ...row, permissions: grouped.get(row.id) ?? [] };
}

/** Capabilities granted to one user, used to build audit before and after states. */
export async function listPermissionsForUser(
  executor: Executor,
  userId: string,
): Promise<readonly Permission[]> {
  const rows = await executor
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));
  return rows.map((row) => row.permission);
}

/**
 * How many accounts can still administer the system.
 *
 * `excludingUserId` answers the question the guards actually ask: how many
 * administrators would be left if this account were deactivated or demoted.
 */
export async function countActiveAdmins(
  executor: Executor,
  excludingUserId?: string,
): Promise<number> {
  const active = and(eq(users.isAdmin, true), eq(users.isActive, true));

  const [row] = await executor
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(excludingUserId ? and(active, ne(users.id, excludingUserId)) : active);

  return row?.count ?? 0;
}

/** Finds an account by its login name, which is unique case insensitively. */
export async function findUserIdByUsername(
  executor: Executor,
  username: string,
): Promise<string | null> {
  const [row] = await executor
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  return row?.id ?? null;
}
