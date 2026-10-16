"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { championshipTemplates } from "@/db/schema";
import { requirePermission } from "@/lib/auth/authorize";
import { getTranslator } from "@/lib/i18n/server";
import { recordAudit } from "@/server/services/audit";
import {
  findAvailableTemplateName,
  getTemplateStructure,
  MAX_TEMPLATE_DESCRIPTION_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  replaceTemplateStructure,
  templateStructureSchema,
} from "@/server/services/templates";
import { DomainError, ok, run, type ActionResult } from "./result";

const nameSchema = z
  .string()
  .trim()
  .min(3, "A template name must be at least 3 characters.")
  .max(MAX_TEMPLATE_NAME_LENGTH, "A template name must be at most 120 characters.");

const descriptionSchema = z
  .string()
  .trim()
  .max(MAX_TEMPLATE_DESCRIPTION_LENGTH, "A description must be at most 500 characters.")
  .optional();

const createSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  structure: templateStructureSchema,
});

const updateSchema = createSchema.extend({ templateId: z.uuid() });

const archiveSchema = z.object({ templateId: z.uuid(), archived: z.boolean() });

export interface TemplateInput {
  readonly name: string;
  readonly description?: string;
  readonly structure: z.input<typeof templateStructureSchema>;
}

const DUPLICATE_NAME_MESSAGE = "A template with this name already exists.";

/** First validation issue, with the field it belongs to when there is one. */
function validationError(error: z.ZodError): DomainError {
  const issue = error.issues[0];
  const message = issue?.message ?? "The template is not valid.";
  const field = issue?.path[0];
  return new DomainError(
    message,
    "VALIDATION",
    typeof field === "string" ? { [field]: message } : undefined,
  );
}

export async function createTemplateAction(
  input: TemplateInput,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_TEMPLATES");
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const { name, description, structure } = parsed.data;

    const created = await getDb().transaction(async (tx) => {
      const [template] = await tx
        .insert(championshipTemplates)
        .values({
          name,
          description: description || null,
          createdByUserId: actor.userId,
        })
        .onConflictDoNothing()
        .returning({ id: championshipTemplates.id });

      if (!template) {
        throw new DomainError(DUPLICATE_NAME_MESSAGE, "CONFLICT", {
          name: DUPLICATE_NAME_MESSAGE,
        });
      }

      const counts = await replaceTemplateStructure(tx, template.id, structure);

      await recordAudit(tx, actor, {
        action: "TEMPLATE_CREATED",
        entityType: "championship_template",
        entityId: template.id,
        after: { name, description: description || null, ...counts },
      });

      return template.id;
    });

    revalidatePath("/templates");
    return ok({ id: created });
  });
}

/**
 * Saves the name, the description and the whole structure of a template.
 *
 * Editing stays available once championships have been created from the
 * template: every championship holds its own copy of the structure, so a later
 * edit can never change a competition that already exists.
 */
export async function updateTemplateAction(
  input: TemplateInput & { templateId: string },
): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_TEMPLATES");
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) throw validationError(parsed.error);
    const { templateId, name, description, structure } = parsed.data;

    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: championshipTemplates.id,
          name: championshipTemplates.name,
          description: championshipTemplates.description,
        })
        .from(championshipTemplates)
        .where(eq(championshipTemplates.id, templateId))
        .limit(1);
      if (!existing) throw new DomainError("Template not found.", "NOT_FOUND");

      const [clash] = await tx
        .select({ id: championshipTemplates.id })
        .from(championshipTemplates)
        .where(
          and(eq(championshipTemplates.name, name), ne(championshipTemplates.id, existing.id)),
        )
        .limit(1);
      if (clash) {
        throw new DomainError(DUPLICATE_NAME_MESSAGE, "CONFLICT", {
          name: DUPLICATE_NAME_MESSAGE,
        });
      }

      await tx
        .update(championshipTemplates)
        .set({ name, description: description || null, updatedAt: new Date() })
        .where(eq(championshipTemplates.id, existing.id));

      const counts = await replaceTemplateStructure(tx, existing.id, structure);

      await recordAudit(tx, actor, {
        action: "TEMPLATE_UPDATED",
        entityType: "championship_template",
        entityId: existing.id,
        before: { name: existing.name, description: existing.description },
        after: { name, description: description || null, ...counts },
      });
    });

    revalidatePath("/templates");
    revalidatePath(`/templates/${templateId}`);
    return ok();
  });
}

/** Deep copies a template, structure included, under a free name. */
export async function duplicateTemplateAction(
  templateId: string,
): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_TEMPLATES");
    const parsed = z.uuid().safeParse(templateId);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");
    const { t } = await getTranslator();

    const created = await getDb().transaction(async (tx) => {
      const [source] = await tx
        .select({
          id: championshipTemplates.id,
          name: championshipTemplates.name,
          description: championshipTemplates.description,
        })
        .from(championshipTemplates)
        .where(eq(championshipTemplates.id, parsed.data))
        .limit(1);
      if (!source) throw new DomainError("Template not found.", "NOT_FOUND");

      const structure = await getTemplateStructure(tx, source.id);
      const name = await findAvailableTemplateName(
        tx,
        `${source.name} (${t("templates.duplicateSuffix")})`,
      );

      const [copy] = await tx
        .insert(championshipTemplates)
        .values({ name, description: source.description, createdByUserId: actor.userId })
        .onConflictDoNothing()
        .returning({ id: championshipTemplates.id });

      if (!copy) throw new DomainError(DUPLICATE_NAME_MESSAGE, "CONFLICT");

      const counts = await replaceTemplateStructure(tx, copy.id, structure);

      await recordAudit(tx, actor, {
        action: "TEMPLATE_DUPLICATED",
        entityType: "championship_template",
        entityId: copy.id,
        before: { sourceTemplateId: source.id, sourceName: source.name },
        after: { name, ...counts },
      });

      return copy.id;
    });

    revalidatePath("/templates");
    return ok({ id: created });
  });
}

/**
 * Archives or restores a template.
 *
 * A template is never deleted: championships record which template they came
 * from, so archiving only removes it from the pickers used to create a new one.
 */
export async function setTemplateArchivedAction(input: {
  templateId: string;
  archived: boolean;
}): Promise<ActionResult<undefined>> {
  return run(async () => {
    const actor = await requirePermission("MANAGE_TEMPLATES");
    const parsed = archiveSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("Invalid request.", "VALIDATION");
    const { templateId, archived } = parsed.data;

    await getDb().transaction(async (tx) => {
      const [existing] = await tx
        .select({
          id: championshipTemplates.id,
          isArchived: championshipTemplates.isArchived,
        })
        .from(championshipTemplates)
        .where(eq(championshipTemplates.id, templateId))
        .limit(1);
      if (!existing) throw new DomainError("Template not found.", "NOT_FOUND");

      await tx
        .update(championshipTemplates)
        .set({ isArchived: archived, updatedAt: new Date() })
        .where(eq(championshipTemplates.id, existing.id));

      await recordAudit(tx, actor, {
        action: archived ? "TEMPLATE_ARCHIVED" : "TEMPLATE_RESTORED",
        entityType: "championship_template",
        entityId: existing.id,
        before: { isArchived: existing.isArchived },
        after: { isArchived: archived },
      });
    });

    revalidatePath("/templates");
    revalidatePath(`/templates/${templateId}`);
    return ok();
  });
}
