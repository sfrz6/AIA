import { createHash, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, userPermissions, users } from "@/db/schema";
import { serverEnv, isProduction } from "@/lib/env";
import type { Permission } from "@/domain/permissions";

export const SESSION_COOKIE = "itpf_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // One competition day.
const RENEW_WHEN_REMAINING_MS = 2 * 60 * 60 * 1000;

export interface Principal {
  readonly userId: string;
  readonly name: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly permissions: readonly Permission[];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Session cookies carry `id.signature`. The signature binds the cookie to the
 * server secret so that a forged or tampered identifier is rejected before any
 * database lookup happens.
 */
function sign(value: string): string {
  return createHmac("sha256", serverEnv().SESSION_SECRET).update(value).digest("base64url");
}

function parseCookieValue(raw: string): string | null {
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return null;
  const token = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  const expected = sign(token);
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return token;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await getDb().insert(sessions).values({ id: hashToken(token), userId, expiresAt });

  const store = await cookies();
  store.set(SESSION_COOKIE, `${token}.${sign(token)}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    expires: expiresAt,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  if (!raw) return;
  const token = parseCookieValue(raw);
  if (!token) return;
  await getDb().delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function destroySessionsForUser(userId: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Resolves the current principal from the session cookie.
 *
 * Returns null for an absent, forged, expired or revoked session, and for a
 * user that has been deactivated since signing in.
 */
export async function getCurrentPrincipal(): Promise<Principal | null> {
  const store = await cookies();
  const raw = store.get(SESSION_COOKIE)?.value;
  if (!raw) return null;

  const token = parseCookieValue(raw);
  if (!token) return null;

  const sessionId = hashToken(token);
  const db = getDb();

  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastUsedAt: sessions.lastUsedAt,
      userId: users.id,
      name: users.name,
      username: users.username,
      isAdmin: users.isAdmin,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  if (!row.isActive) {
    await db.delete(sessions).where(eq(sessions.userId, row.userId));
    return null;
  }

  const granted = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, row.userId));

  const remaining = row.expiresAt.getTime() - Date.now();
  if (remaining < RENEW_WHEN_REMAINING_MS) {
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS), lastUsedAt: new Date() })
      .where(eq(sessions.id, sessionId));
  }

  return {
    userId: row.userId,
    name: row.name,
    username: row.username,
    isAdmin: row.isAdmin,
    permissions: granted.map((entry) => entry.permission),
  };
}

/** Removes expired rows. Called opportunistically after a successful sign in. */
export async function pruneExpiredSessions(): Promise<void> {
  await getDb().delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
