"use server";

import { requireUser } from "@/lib/auth/authorize";
import { listRidersForClub } from "@/server/services/registry";
import { ok, run, type ActionResult } from "./result";

/** A rider on a club's registry, as the squad pickers need it. */
export interface RiderOption {
  readonly id: string;
  readonly fullName: string;
}

/**
 * Riders registered under one club.
 *
 * Reading the registry needs no capability beyond being signed in: the pickers
 * that use it are themselves behind the capability that saves the squad.
 */
export async function listClubRidersAction(
  clubId: string,
): Promise<ActionResult<RiderOption[]>> {
  return run(async () => {
    await requireUser();
    const riders = await listRidersForClub(clubId);
    return ok(riders.map((rider) => ({ id: rider.id, fullName: rider.fullName })));
  });
}
