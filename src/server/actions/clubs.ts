"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth/authorize";
import { recordAudit } from "@/server/services/audit";
import { createClub, deleteClub, updateClub } from "@/server/services/registry";
import { DomainError, ok, run, type ActionResult } from "./result";

const clubNameSchema = z
  .string()
  .trim()
  .min(2, "A club name must be at least 2 characters.")
  .max(120, "A club name must be at most 120 characters.");

const createSchema = z.object({
  name: clubNameSchema,
  nameAr: z.string().trim().max(120, "A club name must be at most 120 characters.").optional(),
});

export interface CreatedClub {
  readonly id: string;
  readonly name: string;
}

export async function createClubAction(input: {
  name: string;
  nameAr?: string;
}): Promise<ActionResult<CreatedClub>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid club.", "VALIDATION", {
        name: parsed.error.issues[0]?.message ?? "",
      });
    }

    const created = await getDb().transaction(async (tx) => {
      const club = await createClub(tx, {
        name: parsed.data.name,
        nameAr: parsed.data.nameAr?.trim() || null,
      });
      await recordAudit(tx, actor, {
        action: "CLUB_CREATED",
        entityType: "club",
        entityId: club.id,
        after: { name: club.name },
      });
      return club;
    });

    revalidatePath("/clubs");
    return ok(created);
  });
}

const updateSchema = z.object({
  clubId: z.uuid(),
  name: clubNameSchema,
  nameAr: z.string().trim().max(120, "A club name must be at most 120 characters.").optional(),
});

export async function updateClubAction(input: {
  clubId: string;
  name: string;
  nameAr?: string;
}): Promise<ActionResult<{ id: string; name: string }>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid club.", "VALIDATION", {
        name: parsed.error.issues[0]?.message ?? "",
      });
    }

    const updated = await getDb().transaction(async (tx) => {
      const club = await updateClub(tx, {
        clubId: parsed.data.clubId,
        name: parsed.data.name,
        nameAr: parsed.data.nameAr?.trim() || null,
      });
      await recordAudit(tx, actor, {
        action: "CLUB_UPDATED",
        entityType: "club",
        entityId: club.id,
        after: { name: club.name },
      });
      return club;
    });

    revalidatePath("/clubs");
    revalidatePath(`/clubs/${parsed.data.clubId}`);
    return ok(updated);
  });
}

const deleteSchema = z.object({ clubId: z.uuid() });

export async function deleteClubAction(input: {
  clubId: string;
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = deleteSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    await getDb().transaction(async (tx) => {
      const club = await deleteClub(tx, parsed.data.clubId);
      await recordAudit(tx, actor, {
        action: "CLUB_DELETED",
        entityType: "club",
        entityId: parsed.data.clubId,
        before: { name: club.name },
      });
    });

    revalidatePath("/clubs");
    return ok();
  });
}
