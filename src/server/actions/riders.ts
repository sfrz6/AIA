"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { riders } from "@/db/schema";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/server/services/audit";
import { countChampionshipParticipations, createRider } from "@/server/services/registry";
import { DomainError, ok, run, type ActionResult } from "./result";

const riderNameSchema = z
  .string()
  .trim()
  .min(2, "A rider name must be at least 2 characters.")
  .max(120, "A rider name must be at most 120 characters.");

const createSchema = z.object({
  countryId: z.uuid(),
  fullName: riderNameSchema,
});

export interface CreatedRider {
  readonly id: string;
  readonly fullName: string;
}

export async function createRiderAction(input: {
  countryId: string;
  fullName: string;
}): Promise<ActionResult<CreatedRider>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid rider.", "VALIDATION", {
        fullName: parsed.error.issues[0]?.message ?? "",
      });
    }

    const created = await getDb().transaction(async (tx) => {
      const rider = await createRider(tx, parsed.data);
      await recordAudit(tx, actor, {
        action: "RIDER_CREATED",
        entityType: "rider",
        entityId: rider.id,
        after: { countryId: rider.countryId, fullName: rider.fullName },
      });
      return rider;
    });

    revalidatePath(`/countries/${parsed.data.countryId}`);
    revalidatePath("/countries");
    return ok({ id: created.id, fullName: created.fullName });
  });
}

const renameSchema = z.object({ riderId: z.uuid(), fullName: riderNameSchema });

export async function renameRiderAction(input: {
  riderId: string;
  fullName: string;
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = renameSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid rider.", "VALIDATION");
    }

    const fullName = parsed.data.fullName.replace(/\s+/g, " ");

    const countryId = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: riders.id, fullName: riders.fullName, countryId: riders.countryId })
        .from(riders)
        .where(eq(riders.id, parsed.data.riderId))
        .limit(1);
      if (!existing) throw new DomainError("Rider not found.", "NOT_FOUND");

      const [clash] = await tx
        .select({ id: riders.id })
        .from(riders)
        .where(
          and(
            eq(riders.countryId, existing.countryId),
            sql`lower(btrim(${riders.fullName})) = lower(btrim(${fullName}))`,
            sql`${riders.id} <> ${existing.id}`,
          ),
        )
        .limit(1);
      if (clash) {
        throw new DomainError(
          "A rider with this name already exists for this country.",
          "CONFLICT",
          { fullName: "A rider with this name already exists for this country." },
        );
      }

      await tx
        .update(riders)
        .set({ fullName, updatedAt: new Date() })
        .where(eq(riders.id, existing.id));

      await recordAudit(tx, actor, {
        action: "RIDER_UPDATED",
        entityType: "rider",
        entityId: existing.id,
        before: { fullName: existing.fullName },
        after: { fullName },
      });

      return existing.countryId;
    });

    revalidatePath(`/countries/${countryId}`);
    return ok();
  });
}

const retireSchema = z.object({ riderId: z.uuid(), retired: z.boolean() });

/**
 * Retires or restores a rider.
 *
 * A rider is never deleted: results and future ranking points are tied to the
 * rider identity, so retiring only removes the rider from the pickers.
 */
export async function setRiderRetiredAction(input: {
  riderId: string;
  retired: boolean;
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = retireSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    const countryId = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: riders.id, countryId: riders.countryId, isActive: riders.isActive })
        .from(riders)
        .where(eq(riders.id, parsed.data.riderId))
        .limit(1);
      if (!existing) throw new DomainError("Rider not found.", "NOT_FOUND");

      await tx
        .update(riders)
        .set({ isActive: !parsed.data.retired, updatedAt: new Date() })
        .where(eq(riders.id, existing.id));

      await recordAudit(tx, actor, {
        action: parsed.data.retired ? "RIDER_RETIRED" : "RIDER_RESTORED",
        entityType: "rider",
        entityId: existing.id,
        before: { isActive: existing.isActive },
        after: { isActive: !parsed.data.retired },
      });

      return existing.countryId;
    });

    revalidatePath(`/countries/${countryId}`);
    revalidatePath("/countries");
    return ok();
  });
}

/** Reports whether a rider may be hidden from the registry without confusion. */
export async function riderParticipationCountAction(
  riderId: string,
): Promise<ActionResult<number>> {
  return run(async () => {
    await requirePermission("MANAGE_RIDERS");
    const count = await countChampionshipParticipations(getDb(), riderId);
    return ok(count);
  });
}
