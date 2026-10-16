"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "@/db";
import { userPermissions, users } from "@/db/schema";
import { PERMISSIONS, type Permission } from "@/domain/permissions";
import { requireAdmin } from "@/lib/auth/authorize";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { destroySessionsForUser } from "@/lib/auth/session";
import type { MessageKey, Translator } from "@/lib/i18n";
import { getTranslator } from "@/lib/i18n/server";
import { recordAudit } from "@/server/services/audit";
import {
  countActiveAdmins,
  findUserIdByUsername,
  listPermissionsForUser,
} from "@/server/services/users";
import { DomainError, ok, run, type ActionResult } from "./result";

/**
 * Validation issues carry a short code instead of a sentence, which the action
 * resolves against the dictionary. Messages therefore reach the operator in the
 * language they are working in, and no English copy lives in this file.
 */
const MESSAGE_KEYS = {
  required: "common.required",
  passwordRule: "users.passwordHint",
  passwordTooLong: "users.passwordTooLong",
  nameTooLong: "users.nameTooLong",
  usernameInvalid: "users.usernameInvalid",
  notFound: "users.notFound",
  invalid: "common.somethingWentWrong",
} as const satisfies Record<string, MessageKey>;

type MessageCode = keyof typeof MESSAGE_KEYS;

function isMessageCode(value: string): value is MessageCode {
  return Object.prototype.hasOwnProperty.call(MESSAGE_KEYS, value);
}

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,64}$/;

const nameSchema = z
  .string()
  .trim()
  .min(2, "required" satisfies MessageCode)
  .max(120, "nameTooLong" satisfies MessageCode);

const usernameSchema = z
  .string()
  .trim()
  .min(1, "required" satisfies MessageCode)
  .regex(USERNAME_PATTERN, "usernameInvalid" satisfies MessageCode);

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "passwordRule" satisfies MessageCode)
  .max(PASSWORD_MAX_LENGTH, "passwordTooLong" satisfies MessageCode);

/**
 * An unknown capability is rejected rather than dropped: silently ignoring it
 * would let a stale client believe it granted something it did not.
 */
const permissionsSchema = z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length);

const createSchema = z.object({
  name: nameSchema,
  username: usernameSchema,
  password: passwordSchema,
  isAdmin: z.boolean(),
  permissions: permissionsSchema,
});

const updateSchema = z.object({
  userId: z.uuid(),
  name: nameSchema,
  username: usernameSchema,
  password: passwordSchema.optional(),
  isAdmin: z.boolean(),
  permissions: permissionsSchema,
});

const setActiveSchema = z.object({ userId: z.uuid(), active: z.boolean() });

/** Turns a failed parse into a field keyed, translated validation error. */
function validationError(issues: readonly z.core.$ZodIssue[], t: Translator): DomainError {
  const fieldErrors: Record<string, string> = {};

  for (const issue of issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || fieldErrors[field]) continue;
    const code: MessageCode = isMessageCode(issue.message) ? issue.message : "invalid";
    fieldErrors[field] = t(MESSAGE_KEYS[code]);
  }

  const first = Object.values(fieldErrors)[0];
  return new DomainError(first ?? t(MESSAGE_KEYS.invalid), "VALIDATION", fieldErrors);
}

function usernameTaken(t: Translator): DomainError {
  return new DomainError(t("users.usernameTaken"), "CONFLICT", {
    username: t("users.usernameTaken"),
  });
}

/** Administrators hold every capability, so no explicit row is ever stored for them. */
function effectiveGrants(isAdmin: boolean, requested: readonly Permission[]): Permission[] {
  if (isAdmin) return [];
  return [...new Set(requested)];
}

function sameGrants(before: readonly Permission[], after: readonly Permission[]): boolean {
  if (before.length !== after.length) return false;
  const sortedBefore = [...before].sort();
  const sortedAfter = [...after].sort();
  return sortedBefore.every((permission, index) => permission === sortedAfter[index]);
}

interface AccountState {
  readonly name: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly isActive: boolean;
  readonly permissions: readonly Permission[];
}

/** Replaces a user's capabilities, attributing the grant to the acting administrator. */
async function replaceGrants(
  tx: Executor,
  userId: string,
  grants: readonly Permission[],
  grantedByUserId: string,
): Promise<void> {
  await tx.delete(userPermissions).where(eq(userPermissions.userId, userId));
  if (grants.length === 0) return;
  await tx
    .insert(userPermissions)
    .values(grants.map((permission) => ({ userId, permission, grantedByUserId })));
}

export async function createUserAction(input: {
  name: string;
  username: string;
  password: string;
  isAdmin: boolean;
  permissions: readonly string[];
}): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requireAdmin();
    const { t } = await getTranslator();

    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error.issues, t);

    const { name, username, password, isAdmin } = parsed.data;
    const grants = effectiveGrants(isAdmin, parsed.data.permissions);

    // Hashing costs a quarter of a second, so it happens before the
    // transaction opens rather than holding a connection while it runs.
    const passwordHash = await hashPassword(password);

    const created = await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ name, username, passwordHash, isAdmin, isActive: true })
        .onConflictDoNothing()
        .returning({ id: users.id });

      // The unique index on lower(username) is the real guard, so a clash is
      // detected here and a race between two administrators is caught too.
      if (!row) throw usernameTaken(t);

      await replaceGrants(tx, row.id, grants, actor.userId);

      const after: AccountState = {
        name,
        username,
        isAdmin,
        isActive: true,
        permissions: grants,
      };

      await recordAudit(tx, actor, {
        action: "USER_CREATED",
        entityType: "user",
        entityId: row.id,
        after,
      });

      return row;
    });

    revalidatePath("/users");
    return ok({ id: created.id });
  });
}

export async function updateUserAction(input: {
  userId: string;
  name: string;
  username: string;
  password?: string;
  isAdmin: boolean;
  permissions: readonly string[];
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requireAdmin();
    const { t } = await getTranslator();

    // A blank password field means "keep the current password", so it is
    // dropped before validation and the stored hash is left untouched.
    const password = input.password && input.password.length > 0 ? input.password : undefined;
    const parsed = updateSchema.safeParse({ ...input, password });
    if (!parsed.success) throw validationError(parsed.error.issues, t);

    const { userId, name, username, isAdmin } = parsed.data;
    const grants = effectiveGrants(isAdmin, parsed.data.permissions);
    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : undefined;

    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          isAdmin: users.isAdmin,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!existing) throw new DomainError(t("users.notFound"), "NOT_FOUND");

      const clashId = await findUserIdByUsername(tx, username);
      if (clashId && clashId !== existing.id) throw usernameTaken(t);

      const demoting = existing.isAdmin && !isAdmin;
      if (demoting && existing.id === actor.userId) {
        throw new DomainError(t("users.cannotDemoteSelf"), "CONFLICT");
      }
      // Only an active administrator counts towards the total, so demoting a
      // deactivated account cannot be what empties it.
      if (demoting && existing.isActive) {
        const remaining = await countActiveAdmins(tx, existing.id);
        if (remaining === 0) throw new DomainError(t("users.lastAdmin"), "CONFLICT");
      }

      const previousGrants = await listPermissionsForUser(tx, existing.id);

      await tx
        .update(users)
        .set({
          name,
          username,
          isAdmin,
          updatedAt: new Date(),
          ...(passwordHash ? { passwordHash } : {}),
        })
        .where(eq(users.id, existing.id));

      await replaceGrants(tx, existing.id, grants, actor.userId);

      const before: AccountState = {
        name: existing.name,
        username: existing.username,
        isAdmin: existing.isAdmin,
        isActive: existing.isActive,
        permissions: previousGrants,
      };
      const after: AccountState = {
        name,
        username,
        isAdmin,
        isActive: existing.isActive,
        permissions: grants,
      };

      await recordAudit(tx, actor, {
        action: "USER_UPDATED",
        entityType: "user",
        entityId: existing.id,
        before,
        after,
      });

      if (!sameGrants(previousGrants, grants)) {
        await recordAudit(tx, actor, {
          action: "USER_PERMISSIONS_CHANGED",
          entityType: "user",
          entityId: existing.id,
          before: { permissions: previousGrants },
          after: { permissions: grants },
        });
      }

      // Nothing about the password itself is recorded, only that it changed.
      if (passwordHash) {
        await recordAudit(tx, actor, {
          action: "USER_PASSWORD_CHANGED",
          entityType: "user",
          entityId: existing.id,
          after: { passwordChanged: true },
        });
      }
    });

    revalidatePath("/users");
    return ok();
  });
}

/**
 * Deactivates or reactivates an account.
 *
 * A user row is never deleted: audit entries reference it, so access is removed
 * by clearing the active flag and revoking the sessions that flag would
 * otherwise outlive.
 */
export async function setUserActiveAction(input: {
  userId: string;
  active: boolean;
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requireAdmin();
    const { t } = await getTranslator();

    const parsed = setActiveSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error.issues, t);

    const { userId, active } = parsed.data;
    if (!active && userId === actor.userId) {
      throw new DomainError(t("users.cannotDeactivateSelf"), "CONFLICT");
    }

    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: users.id,
          name: users.name,
          username: users.username,
          isAdmin: users.isAdmin,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!existing) throw new DomainError(t("users.notFound"), "NOT_FOUND");

      if (!active && existing.isAdmin && existing.isActive) {
        const remaining = await countActiveAdmins(tx, existing.id);
        if (remaining === 0) throw new DomainError(t("users.lastAdmin"), "CONFLICT");
      }

      const permissions = await listPermissionsForUser(tx, existing.id);

      await tx
        .update(users)
        .set({ isActive: active, updatedAt: new Date() })
        .where(eq(users.id, existing.id));

      const base = {
        name: existing.name,
        username: existing.username,
        isAdmin: existing.isAdmin,
        permissions,
      };
      const before: AccountState = { ...base, isActive: existing.isActive };
      const after: AccountState = { ...base, isActive: active };

      await recordAudit(tx, actor, {
        action: active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        entityType: "user",
        entityId: existing.id,
        before,
        after,
      });
    });

    // Outside the transaction because session rows live on their own handle;
    // a signed in user loses access the moment the change is committed.
    if (!active) await destroySessionsForUser(userId);

    revalidatePath("/users");
    return ok();
  });
}
