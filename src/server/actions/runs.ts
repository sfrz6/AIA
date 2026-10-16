"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db";
import { requirePermission } from "@/lib/auth/authorize";
import { getRunContext } from "@/server/services/championships";
import {
  confirmCountryEntryOrder,
  confirmRun,
  correctConfirmedRun,
  listEventRunIds,
  saveRunScores,
  startRun,
  type RunScorePayload,
} from "@/server/services/runs";
import { DomainError, ok, run as guard, type ActionResult } from "./result";

const entryOrderSchema = z
  .object({
    runId: z.uuid(),
    championshipCountryId: z.uuid(),
    decision: z.enum(["NO_CHANGE", "CHANGED"]),
    order: z.array(z.uuid()).max(16).optional(),
  })
  .refine((value) => value.decision === "NO_CHANGE" || (value.order?.length ?? 0) > 0, {
    message: "Provide the new entry order.",
    path: ["order"],
  });

/** Revalidates every page that renders this run or the standings it feeds. */
async function revalidateRun(runId: string): Promise<void> {
  const context = await getRunContext(runId);
  if (!context) return;
  revalidatePath(`/championships/${context.championshipId}`);
  revalidatePath(`/championships/${context.championshipId}/runs/${runId}`);
  revalidatePath(`/championships/${context.championshipId}/results`);
  revalidatePath("/results");
}

export async function confirmEntryOrderAction(
  input: unknown,
): Promise<ActionResult<undefined>> {
  return guard(async () => {
    const actor = await requirePermission("MANAGE_ENTRY_ORDERS");
    const parsed = entryOrderSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "The entry order is not valid.",
        "VALIDATION",
      );
    }

    await getDb().transaction((tx) =>
      confirmCountryEntryOrder(tx, actor, {
        runId: parsed.data.runId,
        championshipCountryId: parsed.data.championshipCountryId,
        decision: parsed.data.decision,
        order: parsed.data.order,
      }),
    );

    // Confirming this run's order can silently carry it into every later run
    // of the same event too (see `propagateEntryOrderWithinEvent`), so every
    // sibling run's own page needs revalidating, not just this one.
    const siblingRunIds = await listEventRunIds(parsed.data.runId);
    await Promise.all(siblingRunIds.map((runId) => revalidateRun(runId)));
    return ok();
  });
}

const startSchema = z.object({ runId: z.uuid(), expectedVersion: z.number().int().min(1) });

export async function startRunAction(input: unknown): Promise<ActionResult<undefined>> {
  return guard(async () => {
    const actor = await requirePermission("ENTER_SCORES");
    const parsed = startSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    await getDb().transaction((tx) =>
      startRun(tx, actor, parsed.data.runId, parsed.data.expectedVersion),
    );

    await revalidateRun(parsed.data.runId);
    return ok();
  });
}

const payloadSchema = z.object({
  units: z
    .array(
      z.object({
        runScoringUnitId: z.uuid(),
        timeSeconds: z
          .string()
          .regex(/^\d{1,4}(\.\d{1,2})?$/, "A time must be a number of seconds.")
          .nullable(),
      }),
    )
    .max(200),
  scores: z
    .array(
      z.object({
        runScoreId: z.uuid(),
        targets: z
          .array(z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(6), z.null()]))
          .min(1)
          .max(8),
      }),
    )
    .max(400),
});

const saveSchema = z.object({
  runId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  payload: payloadSchema,
});

export interface SaveScoresResult {
  readonly complete: boolean;
  readonly status: string;
}

export async function saveRunScoresAction(
  input: unknown,
): Promise<ActionResult<SaveScoresResult>> {
  return guard(async () => {
    const actor = await requirePermission("ENTER_SCORES");
    const parsed = saveSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(
        parsed.error.issues[0]?.message ?? "The scores are not valid.",
        "VALIDATION",
      );
    }

    const result = await getDb().transaction((tx) =>
      saveRunScores(tx, actor, {
        runId: parsed.data.runId,
        expectedVersion: parsed.data.expectedVersion,
        payload: parsed.data.payload as RunScorePayload,
      }),
    );

    await revalidateRun(parsed.data.runId);
    return ok(result);
  });
}

const confirmSchema = z.object({ runId: z.uuid(), expectedVersion: z.number().int().min(1) });

export async function confirmRunAction(input: unknown): Promise<ActionResult<undefined>> {
  return guard(async () => {
    const actor = await requirePermission("CONFIRM_RUNS");
    const parsed = confirmSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");

    await getDb().transaction((tx) =>
      confirmRun(tx, actor, {
        runId: parsed.data.runId,
        expectedVersion: parsed.data.expectedVersion,
      }),
    );

    await revalidateRun(parsed.data.runId);
    return ok();
  });
}

const correctSchema = z.object({
  runId: z.uuid(),
  expectedVersion: z.number().int().min(1),
  payload: payloadSchema,
  reason: z.string().trim().min(5, "A reason is required.").max(1000),
});

/**
 * Corrects a run that is already confirmed.
 *
 * The reason is mandatory and is stored with the complete before and after
 * values. Standings are derived from confirmed scores on every read, so they
 * reflect the correction as soon as the transaction commits.
 */
export async function correctRunAction(input: unknown): Promise<ActionResult<undefined>> {
  return guard(async () => {
    const actor = await requirePermission("EDIT_CONFIRMED_RESULTS");
    const parsed = correctSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DomainError(
        issue?.message ?? "The correction is not valid.",
        "VALIDATION",
        issue?.path[0] === "reason" ? { reason: issue.message } : undefined,
      );
    }

    await getDb().transaction((tx) =>
      correctConfirmedRun(tx, actor, {
        runId: parsed.data.runId,
        expectedVersion: parsed.data.expectedVersion,
        payload: parsed.data.payload as RunScorePayload,
        reason: parsed.data.reason,
      }),
    );

    await revalidateRun(parsed.data.runId);
    return ok();
  });
}
