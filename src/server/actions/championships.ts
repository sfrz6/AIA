"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { championshipCountries, championshipRiders, championships } from "@/db/schema";
import { requireAdmin, requirePermission } from "@/lib/auth/authorize";
import { ACTIVE_RIDERS_PER_COUNTRY } from "@/domain/scoring/event-types";
import { recordAudit } from "@/server/services/audit";
import {
  createChampionshipFromTemplate,
  deleteChampionship,
  reorderChampionshipCountries,
  replaceSquad,
  type SquadInput,
} from "@/server/services/championship-setup";
import { DomainError, ok, run, type ActionResult } from "./result";

const squadRiderSchema = z.object({
  riderId: z.uuid(),
  rosterSlot: z.enum(["ACTIVE", "RESERVE"]),
  initialOrder: z.number().int().min(1).max(ACTIVE_RIDERS_PER_COUNTRY).nullable(),
});

/**
 * A squad may be left empty, meaning the riders have not been picked yet, or
 * must be the full four active riders plus one reserve. `validateSquad` in the
 * service layer enforces that "all or nothing" rule; here only the shape and
 * the upper bound are checked.
 */
const squadSchema = z.object({
  countryId: z.uuid(),
  riders: z.array(squadRiderSchema).max(16),
});

const createSchema = z.object({
  templateId: z.uuid(),
  name: z.string().trim().min(3).max(160),
  nameAr: z.string().trim().max(160).nullable(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A start date is required."),
  location: z.string().trim().min(2).max(160),
  organizer: z.string().trim().max(160).nullable(),
  squads: z.array(squadSchema).min(2).max(40),
});

export async function createChampionshipAction(
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requirePermission("CREATE_CHAMPIONSHIP");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "The championship details are not valid.",
        "VALIDATION",
      );
    }

    const created = await getDb().transaction((tx) =>
      createChampionshipFromTemplate(tx, actor, {
        ...parsed.data,
        squads: parsed.data.squads as readonly SquadInput[],
      }),
    );

    revalidatePath("/");
    revalidatePath("/championships");
    return ok({ id: created.id });
  });
}

const updateSchema = z.object({
  championshipId: z.uuid(),
  name: z.string().trim().min(3).max(160),
  nameAr: z.string().trim().max(160).nullable(),
  location: z.string().trim().min(2).max(160),
  organizer: z.string().trim().max(160).nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "COMPLETED"]),
});

export async function updateChampionshipAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("EDIT_CHAMPIONSHIP");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "The championship details are not valid.",
        "VALIDATION",
      );
    }

    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: championships.id,
          name: championships.name,
          nameAr: championships.nameAr,
          location: championships.location,
          organizer: championships.organizer,
          status: championships.status,
        })
        .from(championships)
        .where(eq(championships.id, parsed.data.championshipId))
        .limit(1);
      if (!existing) throw new DomainError("Championship not found.", "NOT_FOUND");

      await tx
        .update(championships)
        .set({
          name: parsed.data.name,
          nameAr: parsed.data.nameAr,
          location: parsed.data.location,
          organizer: parsed.data.organizer,
          status: parsed.data.status,
          updatedAt: new Date(),
        })
        .where(eq(championships.id, existing.id));

      await recordAudit(tx, actor, {
        action: "CHAMPIONSHIP_UPDATED",
        entityType: "championship",
        entityId: existing.id,
        championshipId: existing.id,
        before: existing,
        after: {
          name: parsed.data.name,
          nameAr: parsed.data.nameAr,
          location: parsed.data.location,
          organizer: parsed.data.organizer,
          status: parsed.data.status,
        },
      });
    });

    revalidatePath(`/championships/${parsed.data.championshipId}`);
    revalidatePath("/championships");
    revalidatePath("/");
    return ok();
  });
}

const deleteChampionshipSchema = z.object({ championshipId: z.uuid() });

/**
 * Permanently deletes a championship and everything recorded under it.
 *
 * Restricted to administrators: unlike every other championship mutation,
 * this destroys confirmed, possibly already published results and cannot be
 * undone.
 */
export async function deleteChampionshipAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requireAdmin();
    const parsed = deleteChampionshipSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    const slug = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({ slug: championships.slug })
        .from(championships)
        .where(eq(championships.id, parsed.data.championshipId))
        .limit(1);
      if (!existing) throw new DomainError("Championship not found.", "NOT_FOUND");

      await deleteChampionship(tx, actor, parsed.data.championshipId);
      return existing.slug;
    });

    revalidatePath("/");
    revalidatePath("/championships");
    revalidatePath("/results");
    revalidatePath(`/results/${slug}`);
    return ok();
  });
}

const publishSchema = z.object({ championshipId: z.uuid(), published: z.boolean() });

/**
 * Publishes or hides the public results page.
 *
 * Publishing never exposes work in progress: the public pages read confirmed
 * runs only, so this switch controls visibility of the championship itself.
 */
export async function setChampionshipPublishedAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_PUBLIC_RESULTS");
    const parsed = publishSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    const slug = await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: championships.id,
          slug: championships.slug,
          isPublished: championships.isPublished,
        })
        .from(championships)
        .where(eq(championships.id, parsed.data.championshipId))
        .limit(1);
      if (!existing) throw new DomainError("Championship not found.", "NOT_FOUND");

      await tx
        .update(championships)
        .set({ isPublished: parsed.data.published, updatedAt: new Date() })
        .where(eq(championships.id, existing.id));

      await recordAudit(tx, actor, {
        action: parsed.data.published ? "CHAMPIONSHIP_PUBLISHED" : "CHAMPIONSHIP_UNPUBLISHED",
        entityType: "championship",
        entityId: existing.id,
        championshipId: existing.id,
        before: { isPublished: existing.isPublished },
        after: { isPublished: parsed.data.published },
      });

      return existing.slug;
    });

    revalidatePath(`/championships/${parsed.data.championshipId}`);
    revalidatePath("/results");
    revalidatePath(`/results/${slug}`);
    return ok();
  });
}

const replaceSquadSchema = z.object({
  championshipId: z.uuid(),
  championshipCountryId: z.uuid(),
  squad: squadSchema,
});

export async function replaceSquadAction(input: unknown): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_RIDERS");
    const parsed = replaceSquadSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid squad.", "VALIDATION");
    }

    await getDb().transaction(async (tx) => {
      const [participant] = await tx
        .select({
          id: championshipCountries.id,
          championshipId: championshipCountries.championshipId,
          countryId: championshipCountries.countryId,
        })
        .from(championshipCountries)
        .where(eq(championshipCountries.id, parsed.data.championshipCountryId))
        .limit(1);

      if (!participant || participant.championshipId !== parsed.data.championshipId) {
        throw new DomainError("This country does not take part in this championship.", "NOT_FOUND");
      }
      if (participant.countryId !== parsed.data.squad.countryId) {
        throw new DomainError("The squad does not match the country.", "VALIDATION");
      }

      await replaceSquad(tx, actor, {
        championshipId: parsed.data.championshipId,
        championshipCountryId: parsed.data.championshipCountryId,
        squad: parsed.data.squad as SquadInput,
      });
    });

    revalidatePath(`/championships/${parsed.data.championshipId}/participants`);
    return ok();
  });
}

const addCountrySchema = z.object({
  championshipId: z.uuid(),
  squad: squadSchema,
});

/** Adds a country and its squad to a championship that is already set up. */
export async function addChampionshipCountryAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_CHAMPIONSHIP_COUNTRIES");
    const parsed = addCountrySchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(parsed.error.issues[0]?.message ?? "Invalid squad.", "VALIDATION");
    }

    await getDb().transaction(async (tx) => {
      const [clash] = await tx
        .select({ id: championshipCountries.id })
        .from(championshipCountries)
        .where(
          and(
            eq(championshipCountries.championshipId, parsed.data.championshipId),
            eq(championshipCountries.countryId, parsed.data.squad.countryId),
          ),
        )
        .limit(1);
      if (clash) {
        throw new DomainError("This country is already taking part.", "CONFLICT");
      }

      // Appended to the end of the current start list.
      const [nextOrder] = await tx
        .select({
          nextOrderIndex: sql<number>`coalesce(max(${championshipCountries.orderIndex}), -1) + 1`,
        })
        .from(championshipCountries)
        .where(eq(championshipCountries.championshipId, parsed.data.championshipId));

      const [participant] = await tx
        .insert(championshipCountries)
        .values({
          championshipId: parsed.data.championshipId,
          countryId: parsed.data.squad.countryId,
          orderIndex: nextOrder?.nextOrderIndex ?? 0,
        })
        .returning({ id: championshipCountries.id });
      if (!participant) throw new DomainError("The country could not be added.", "UNEXPECTED");

      await replaceSquad(tx, actor, {
        championshipId: parsed.data.championshipId,
        championshipCountryId: participant.id,
        squad: parsed.data.squad as SquadInput,
      });

      await recordAudit(tx, actor, {
        action: "CHAMPIONSHIP_COUNTRY_ADDED",
        entityType: "championship_country",
        entityId: participant.id,
        championshipId: parsed.data.championshipId,
        after: { countryId: parsed.data.squad.countryId },
      });
    });

    revalidatePath(`/championships/${parsed.data.championshipId}/participants`);
    return ok();
  });
}

const removeCountrySchema = z.object({
  championshipId: z.uuid(),
  championshipCountryId: z.uuid(),
});

/**
 * Removes a country from a championship.
 *
 * Refused once the country has ridden, because removing it would delete the
 * participation rows that its confirmed scores reference.
 */
export async function removeChampionshipCountryAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_CHAMPIONSHIP_COUNTRIES");
    const parsed = removeCountrySchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    await getDb().transaction(async (tx) => {
      const [participant] = await tx
        .select({
          id: championshipCountries.id,
          championshipId: championshipCountries.championshipId,
          countryId: championshipCountries.countryId,
        })
        .from(championshipCountries)
        .where(eq(championshipCountries.id, parsed.data.championshipCountryId))
        .limit(1);

      if (!participant || participant.championshipId !== parsed.data.championshipId) {
        throw new DomainError("This country does not take part in this championship.", "NOT_FOUND");
      }

      const [used] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(championshipRiders)
        .where(
          and(
            eq(championshipRiders.championshipCountryId, participant.id),
            sql`exists (
              select 1 from run_scores rs
              where rs.championship_rider_id = championship_riders.id
            )`,
          ),
        );

      if ((used?.count ?? 0) > 0) {
        throw new DomainError(
          "This country has already taken part in a run and cannot be removed.",
          "CONFLICT",
        );
      }

      await tx.delete(championshipCountries).where(eq(championshipCountries.id, participant.id));

      await recordAudit(tx, actor, {
        action: "CHAMPIONSHIP_COUNTRY_REMOVED",
        entityType: "championship_country",
        entityId: participant.id,
        championshipId: parsed.data.championshipId,
        before: { countryId: participant.countryId },
      });
    });

    revalidatePath(`/championships/${parsed.data.championshipId}/participants`);
    return ok();
  });
}

const reorderCountriesSchema = z.object({
  championshipId: z.uuid(),
  orderedChampionshipCountryIds: z.array(z.uuid()).min(1).max(64),
});

/**
 * Sets the championship's start list order (team 1, team 2, ...). Refused
 * once the championship's first run has started, enforced again by
 * {@link reorderChampionshipCountries} inside the transaction.
 */
export async function reorderChampionshipCountriesAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_CHAMPIONSHIP_COUNTRIES");
    const parsed = reorderCountriesSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    await getDb().transaction((tx) =>
      reorderChampionshipCountries(tx, actor, {
        championshipId: parsed.data.championshipId,
        orderedChampionshipCountryIds: parsed.data.orderedChampionshipCountryIds,
      }),
    );

    revalidatePath(`/championships/${parsed.data.championshipId}/participants`);
    revalidatePath(`/championships/${parsed.data.championshipId}/runs`);
    return ok();
  });
}
