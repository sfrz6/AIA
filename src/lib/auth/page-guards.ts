import { redirect } from "next/navigation";
import { hasPermission, type Permission } from "@/domain/permissions";
import { getCurrentPrincipal, type Principal } from "./session";

/**
 * Authorization for pages, as opposed to actions.
 *
 * A page cannot usefully throw: a visitor who is simply not signed in should
 * land on the sign in form, and a signed in user who lacks a capability should
 * see an explanation rather than a stack trace. Server actions keep using the
 * throwing guards in `authorize.ts`, because they translate the error into a
 * result the client can display.
 *
 * Next.js renders a layout and its page in parallel, so a page that throws
 * while its layout redirects still logs an unhandled error. Redirecting from
 * the page itself keeps the server log clean.
 */
export async function requirePageUser(): Promise<Principal> {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/sign-in");
  return principal;
}

export async function requirePagePermission(permission: Permission): Promise<Principal> {
  const principal = await requirePageUser();
  if (!hasPermission(principal, permission)) redirect("/no-access");
  return principal;
}

export async function requirePageAdmin(): Promise<Principal> {
  const principal = await requirePageUser();
  if (!principal.isAdmin) redirect("/no-access");
  return principal;
}
