"use server";

import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { burnPasswordComparison, verifyPassword } from "@/lib/auth/password";
import {
  createSession,
  destroyCurrentSession,
  pruneExpiredSessions,
} from "@/lib/auth/session";
import { getTranslator } from "@/lib/i18n/server";
import { fail, ok, run, type ActionResult } from "./result";

const signInSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * Credential sign in.
 *
 * A wrong user name, a wrong password and a deactivated account all return the
 * same message and all perform one password comparison, so neither the response
 * text nor its timing reveals which accounts exist.
 */
export async function signInAction(
  _previous: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const { t } = await getTranslator();
    const parsed = signInSchema.safeParse({
      username: formData.get("username"),
      password: formData.get("password"),
    });

    if (!parsed.success) {
      return fail(t("auth.invalidCredentials"));
    }

    const db = getDb();
    const [account] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        isActive: users.isActive,
      })
      .from(users)
      .where(sql`lower(${users.username}) = lower(${parsed.data.username})`)
      .limit(1);

    if (!account) {
      await burnPasswordComparison(parsed.data.password);
      return fail(t("auth.invalidCredentials"), "FORBIDDEN");
    }

    const valid = await verifyPassword(parsed.data.password, account.passwordHash);
    if (!valid || !account.isActive) {
      return fail(t("auth.invalidCredentials"), "FORBIDDEN");
    }

    await createSession(account.id);
    void pruneExpiredSessions().catch(() => undefined);
    return ok();
  });
}

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/sign-in");
}
