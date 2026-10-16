"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Executor } from "@/db";
import {
  championshipCountries,
  championshipRiders,
  championships,
  tieBreakEntries,
  tieBreakEntryScores,
  tieBreakRounds,
} from "@/db/schema";
import { requirePermission } from "@/lib/auth/authorize";
import { TIE_BREAK_DEFAULTS } from "@/domain/scoring/event-types";
import { recordAudit } from "@/server/services/audit";
import { DomainError, ok, run, type ActionResult } from "./result";

const entrySchema = z.object({
  /** A championship rider for an individual round, a championship country for a country round. */
  subjectId: z.uuid(),
  timeSeconds: z
    .string()
    .regex(/^\d{1,4}(\.\d{1,2})?$/, "A time must be a number of seconds."),
  /** One score for an individual round, one per rider taking part for a country round. */
  scores: z
    .array(
      z.object({
        championshipRiderId: z.uuid(),
        points: z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6)]),
      }),
    )
    .min(1)
    .max(8),
});

const saveSchema = z.object({
  championshipId: z.uuid(),
  scope: z.enum(["DAY_1", "DAY_2", "DAY_3", "OVERALL"]),
  subject: z.enum(["INDIVIDUAL", "COUNTRY"]),
  entries: z.array(entrySchema).max(60),
});

type SaveInput = z.infer<typeof saveSchema>;

/**
 * Confirms that every identifier in the round belongs to this championship.
 *
 * Tie-break results are official scoring data, so the subjects and the riders
 * that scored are checked against the championship rather than trusted.
 */
async function assertSubjectsBelong(tx: Executor, input: SaveInput): Promise<void> {
  const riderIds = new Set<string>();
  for (const entry of input.entries) {
    for (const score of entry.scores) riderIds.add(score.championshipRiderId);
    if (input.subject === "INDIVIDUAL") riderIds.add(entry.subjectId);
  }

  if (riderIds.size > 0) {
    const rows = await tx
      .select({ id: championshipRiders.id })
      .from(championshipRiders)
      .innerJoin(
        championshipCountries,
        eq(championshipCountries.id, championshipRiders.championshipCountryId),
      )
      .where(
        and(
          eq(championshipCountries.championshipId, input.championshipId),
          inArray(championshipRiders.id, [...riderIds]),
        ),
      );
    if (rows.length !== riderIds.size) {
      throw new DomainError("A competitor in this round is not in this championship.", "VALIDATION");
    }
  }

  if (input.subject === "COUNTRY") {
    const countryIds = input.entries.map((entry) => entry.subjectId);
    if (countryIds.length > 0) {
      const rows = await tx
        .select({ id: championshipCountries.id })
        .from(championshipCountries)
        .where(
          and(
            eq(championshipCountries.championshipId, input.championshipId),
            inArray(championshipCountries.id, countryIds),
          ),
        );
      if (rows.length !== new Set(countryIds).size) {
        throw new DomainError("A country in this round is not in this championship.", "VALIDATION");
      }
    }
  }
}

/**
 * Records a tie-break round.
 *
 * The round replaces any previous one for the same scope and subject, and the
 * replacement is audited with the complete before and after values, because a
 * tie-break decides official placings exactly like a scored run does.
 */
export async function saveTieBreakRoundAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_TIE_BREAKS");
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "The tie-break round is not valid.",
        "VALIDATION",
      );
    }
    const data = parsed.data;

    const subjects = data.entries.map((entry) => entry.subjectId);
    if (new Set(subjects).size !== subjects.length) {
      throw new DomainError("A competitor appears twice in this round.", "VALIDATION");
    }

    await getDb().transaction(async (tx) => {
      const [championship] = await tx
        .select({ id: championships.id })
        .from(championships)
        .where(eq(championships.id, data.championshipId))
        .limit(1);
      if (!championship) throw new DomainError("Championship not found.", "NOT_FOUND");

      await assertSubjectsBelong(tx, data);

      const [existing] = await tx
        .select({ id: tieBreakRounds.id })
        .from(tieBreakRounds)
        .where(
          and(
            eq(tieBreakRounds.championshipId, data.championshipId),
            eq(tieBreakRounds.scope, data.scope),
            eq(tieBreakRounds.subject, data.subject),
          ),
        )
        .limit(1);

      let before: unknown = null;
      if (existing) {
        before = await tx
          .select({
            entryId: tieBreakEntries.id,
            championshipRiderId: tieBreakEntries.championshipRiderId,
            championshipCountryId: tieBreakEntries.championshipCountryId,
            timeSeconds: tieBreakEntries.timeSeconds,
          })
          .from(tieBreakEntries)
          .where(eq(tieBreakEntries.tieBreakRoundId, existing.id));
        await tx.delete(tieBreakRounds).where(eq(tieBreakRounds.id, existing.id));
      }

      if (data.entries.length === 0) {
        await recordAudit(tx, actor, {
          action: "TIE_BREAK_SAVED",
          entityType: "tie_break_round",
          entityId: existing?.id ?? null,
          championshipId: data.championshipId,
          before,
          after: { scope: data.scope, subject: data.subject, entries: [] },
        });
        return;
      }

      const defaults = TIE_BREAK_DEFAULTS[data.subject];
      const [round] = await tx
        .insert(tieBreakRounds)
        .values({
          championshipId: data.championshipId,
          scope: data.scope,
          subject: data.subject,
          pegSizeCm: defaults.pegSizeCm,
          timeLimitSeconds: defaults.timeLimitSeconds,
          maxPoints: defaults.maxPoints,
          createdByUserId: actor.userId,
        })
        .returning({ id: tieBreakRounds.id });
      if (!round) throw new DomainError("The tie-break round could not be saved.", "UNEXPECTED");

      for (const entry of data.entries) {
        const [created] = await tx
          .insert(tieBreakEntries)
          .values({
            tieBreakRoundId: round.id,
            championshipRiderId: data.subject === "INDIVIDUAL" ? entry.subjectId : null,
            championshipCountryId: data.subject === "COUNTRY" ? entry.subjectId : null,
            timeSeconds: entry.timeSeconds,
          })
          .returning({ id: tieBreakEntries.id });
        if (!created) throw new DomainError("The tie-break round could not be saved.", "UNEXPECTED");

        await tx.insert(tieBreakEntryScores).values(
          entry.scores.map((score) => ({
            tieBreakEntryId: created.id,
            championshipRiderId: score.championshipRiderId,
            points: score.points.toFixed(1),
          })),
        );
      }

      await recordAudit(tx, actor, {
        action: "TIE_BREAK_SAVED",
        entityType: "tie_break_round",
        entityId: round.id,
        championshipId: data.championshipId,
        before,
        after: { scope: data.scope, subject: data.subject, entries: data.entries },
      });
    });

    revalidatePath(`/championships/${data.championshipId}/results`);
    revalidatePath("/results");
    return ok();
  });
}
