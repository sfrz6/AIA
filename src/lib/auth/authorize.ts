import { hasPermission, type Permission } from "@/domain/permissions";
import { getCurrentPrincipal, type Principal } from "./session";

/**
 * Raised when a request is rejected by the authorization layer. Server actions
 * translate it into a safe message; nothing about the user's capabilities is
 * disclosed beyond the fact that the action is not allowed.
 */
export class AuthorizationError extends Error {
  readonly code: "UNAUTHENTICATED" | "FORBIDDEN";

  constructor(code: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(code === "UNAUTHENTICATED" ? "Sign in required." : "You are not allowed to do this.");
    this.name = "AuthorizationError";
    this.code = code;
  }
}

/** Current principal, or throws when nobody is signed in. */
export async function requireUser(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (!principal) throw new AuthorizationError("UNAUTHENTICATED");
  return principal;
}

/** Current principal, or throws unless the capability is held. */
export async function requirePermission(permission: Permission): Promise<Principal> {
  const principal = await requireUser();
  if (!hasPermission(principal, permission)) throw new AuthorizationError("FORBIDDEN");
  return principal;
}

/** Current principal, or throws unless the user is an administrator. */
export async function requireAdmin(): Promise<Principal> {
  const principal = await requireUser();
  if (!principal.isAdmin) throw new AuthorizationError("FORBIDDEN");
  return principal;
}

export async function currentPrincipalOrNull(): Promise<Principal | null> {
  return getCurrentPrincipal();
}
