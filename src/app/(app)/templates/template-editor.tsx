"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, CalendarDays, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form-controls";
import {
  Badge,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
} from "@/components/ui/surfaces";
import { formatPegSize, formatTime } from "@/components/common/formatting";
import {
  EVENT_TYPE_KEYS,
  getEventTypeDefinition,
  type EventTypeKey,
} from "@/domain/scoring/event-types";
import { useI18n } from "@/lib/i18n/client";
import { createTemplateAction, updateTemplateAction } from "@/server/actions/templates";

export interface TemplateEditorRun {
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
}

export interface TemplateEditorEvent {
  readonly eventType: EventTypeKey;
  readonly runs: readonly TemplateEditorRun[];
}

export interface TemplateEditorDay {
  readonly dayNumber: number;
  readonly events: readonly TemplateEditorEvent[];
}

export interface TemplateEditorValue {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly structure: readonly TemplateEditorDay[];
}

export type TemplateEditorProps =
  | { readonly mode: "create"; readonly template?: undefined }
  | { readonly mode: "edit"; readonly template: TemplateEditorValue };

const DAY_NUMBERS = [1, 2, 3] as const;
const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

interface RunDraft {
  readonly key: string;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
}

interface EventDraft {
  readonly key: string;
  readonly eventType: EventTypeKey;
  readonly runs: readonly RunDraft[];
}

interface DayDraft {
  readonly dayNumber: number;
  readonly events: readonly EventDraft[];
}

/** Stable React keys for rows that have no identifier until they are saved. */
let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `draft-${keyCounter}`;
}

function isPositive(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function toDraft(structure: readonly TemplateEditorDay[] | undefined): DayDraft[] {
  return DAY_NUMBERS.map((dayNumber) => {
    const day = structure?.find((entry) => entry.dayNumber === dayNumber);
    return {
      dayNumber,
      events: (day?.events ?? []).map((event) => ({
        key: nextKey(),
        eventType: event.eventType,
        runs: event.runs.map((entry) => ({
          key: nextKey(),
          pegSizeCm: formatPegSize(entry.pegSizeCm),
          timeLimitSeconds: formatTime(entry.timeLimitSeconds),
        })),
      })),
    };
  });
}

export function TemplateEditor(props: TemplateEditorProps) {
  const existing = props.mode === "edit" ? props.template : null;
  const { t } = useI18n();
  const router = useRouter();

  const [name, setName] = React.useState(existing?.name ?? "");
  const [description, setDescription] = React.useState(existing?.description ?? "");
  const [days, setDays] = React.useState<DayDraft[]>(() => toDraft(existing?.structure));
  const [selection, setSelection] = React.useState<Record<number, string>>({});
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function mapDay(dayNumber: number, change: (day: DayDraft) => DayDraft) {
    setDays((previous) =>
      previous.map((day) => (day.dayNumber === dayNumber ? change(day) : day)),
    );
  }

  function mapEvent(
    dayNumber: number,
    eventKey: string,
    change: (event: EventDraft) => EventDraft,
  ) {
    mapDay(dayNumber, (day) => ({
      ...day,
      events: day.events.map((event) => (event.key === eventKey ? change(event) : event)),
    }));
  }

  /** Adds an event, seeded with the catalogue defaults for its runs. */
  function addEvent(dayNumber: number, eventType: EventTypeKey) {
    const definition = getEventTypeDefinition(eventType);
    mapDay(dayNumber, (day) => ({
      ...day,
      events: [
        ...day.events,
        {
          key: nextKey(),
          eventType,
          runs: definition.defaultPegSizesCm.map((pegSizeCm) => ({
            key: nextKey(),
            pegSizeCm: formatPegSize(pegSizeCm),
            timeLimitSeconds: formatTime(definition.defaultTimeLimitSeconds),
          })),
        },
      ],
    }));
    setSelection((previous) => ({ ...previous, [dayNumber]: "" }));
  }

  function removeEvent(dayNumber: number, eventKey: string) {
    mapDay(dayNumber, (day) => ({
      ...day,
      events: day.events.filter((event) => event.key !== eventKey),
    }));
  }

  function moveEvent(dayNumber: number, index: number, delta: -1 | 1) {
    mapDay(dayNumber, (day) => {
      const target = index + delta;
      if (target < 0 || target >= day.events.length) return day;
      const events = [...day.events];
      const [moved] = events.splice(index, 1);
      if (!moved) return day;
      events.splice(target, 0, moved);
      return { ...day, events };
    });
  }

  /**
   * Adds a run, seeded with the catalogue default for that run when the event
   * type defines one and otherwise with the values of the previous run. The
   * template, never the event type, decides how many runs an event has.
   */
  function addRun(dayNumber: number, eventKey: string) {
    mapEvent(dayNumber, eventKey, (event) => {
      const definition = getEventTypeDefinition(event.eventType);
      const previous = event.runs[event.runs.length - 1];
      const seeded = definition.defaultPegSizesCm[event.runs.length];
      return {
        ...event,
        runs: [
          ...event.runs,
          {
            key: nextKey(),
            pegSizeCm: seeded === undefined ? (previous?.pegSizeCm ?? "") : formatPegSize(seeded),
            timeLimitSeconds:
              previous?.timeLimitSeconds ?? formatTime(definition.defaultTimeLimitSeconds),
          },
        ],
      };
    });
  }

  function removeRun(dayNumber: number, eventKey: string, runKey: string) {
    mapEvent(dayNumber, eventKey, (event) => ({
      ...event,
      runs: event.runs.filter((entry) => entry.key !== runKey),
    }));
  }

  function updateRun(
    dayNumber: number,
    eventKey: string,
    runKey: string,
    patch: Partial<Omit<RunDraft, "key">>,
  ) {
    mapEvent(dayNumber, eventKey, (event) => ({
      ...event,
      runs: event.runs.map((entry) => (entry.key === runKey ? { ...entry, ...patch } : entry)),
    }));
  }

  /**
   * Tidies a run once the operator leaves it: a peg size or a time limit must
   * be greater than zero, so a value that was cleared or mistyped falls back to
   * the catalogue default for that run rather than blocking the save.
   */
  function normalizeRun(dayNumber: number, eventKey: string, runKey: string, runIndex: number) {
    mapEvent(dayNumber, eventKey, (event) => {
      const definition = getEventTypeDefinition(event.eventType);
      const pegFallback =
        definition.defaultPegSizesCm[runIndex] ?? definition.defaultPegSizesCm.at(-1);
      return {
        ...event,
        runs: event.runs.map((entry) => {
          if (entry.key !== runKey) return entry;
          const peg = isPositive(entry.pegSizeCm)
            ? formatPegSize(entry.pegSizeCm)
            : pegFallback === undefined
              ? entry.pegSizeCm
              : formatPegSize(pegFallback);
          return {
            ...entry,
            pegSizeCm: peg,
            timeLimitSeconds: isPositive(entry.timeLimitSeconds)
              ? formatTime(entry.timeLimitSeconds)
              : formatTime(definition.defaultTimeLimitSeconds),
          };
        }),
      };
    });
  }

  const trimmedName = name.trim();
  const eventTotal = days.reduce((total, day) => total + day.events.length, 0);
  const hasRunlessEvent = days.some((day) => day.events.some((event) => event.runs.length === 0));
  const allRunsValid = days.every((day) =>
    day.events.every((event) =>
      event.runs.every(
        (entry) => isPositive(entry.pegSizeCm) && isPositive(entry.timeLimitSeconds),
      ),
    ),
  );

  const issues: string[] = [];
  if (eventTotal === 0) issues.push(t("templates.atLeastOneEvent"));
  if (hasRunlessEvent) issues.push(t("templates.atLeastOneRun"));

  const canSubmit =
    issues.length === 0 &&
    allRunsValid &&
    trimmedName.length >= MIN_NAME_LENGTH &&
    trimmedName.length <= MAX_NAME_LENGTH;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setNameError(null);

    const structure = {
      days: days.map((day) => ({
        dayNumber: day.dayNumber,
        events: day.events.map((entry, index) => ({
          eventType: entry.eventType,
          orderIndex: index + 1,
          runs: entry.runs.map((item, runIndex) => ({
            runNumber: runIndex + 1,
            pegSizeCm: Number(item.pegSizeCm),
            timeLimitSeconds: Number(item.timeLimitSeconds),
          })),
        })),
      })),
    };

    const payload = { name: trimmedName, description: description.trim(), structure };

    startTransition(async () => {
      if (existing) {
        const result = await updateTemplateAction({ ...payload, templateId: existing.id });
        if (!result.ok) {
          setNameError(result.fieldErrors?.name ?? null);
          toast.error(result.error);
          return;
        }
        toast.success(t("templates.updatedSuccess"));
        router.refresh();
        return;
      }

      const result = await createTemplateAction(payload);
      if (!result.ok) {
        setNameError(result.fieldErrors?.name ?? null);
        toast.error(result.error);
        return;
      }
      toast.success(t("templates.createdSuccess"));
      router.push(`/templates/${result.data.id}`);
    });
  }

  // Validation is done here rather than by the browser: the peg size steps in
  // half centimetres from a floor of a tenth, so a perfectly valid size such as
  // 6 does not sit on the native step grid and would be rejected by it.
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>
            {props.mode === "create" ? t("templates.newTemplate") : t("templates.editTemplate")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t("templates.templateName")}
            htmlFor="template-name"
            required
            error={nameError}
          >
            <Input
              id="template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              minLength={MIN_NAME_LENGTH}
              maxLength={MAX_NAME_LENGTH}
              required
              autoComplete="off"
              aria-invalid={nameError ? true : undefined}
            />
          </Field>
          <Field
            label={t("templates.description")}
            htmlFor="template-description"
            hint={t("common.optional")}
          >
            <Input
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={MAX_DESCRIPTION_LENGTH}
              autoComplete="off"
            />
          </Field>
        </CardContent>
      </Card>

      {days.map((day) => {
        const used = new Set(day.events.map((event) => event.eventType));
        const available = EVENT_TYPE_KEYS.filter((key) => !used.has(key));
        const chosen = available.find((key) => key === selection[day.dayNumber]);
        const dayHeading = t("templates.dayHeading", { day: day.dayNumber });

        return (
          <Card key={day.dayNumber}>
            <CardHeader>
              <CardTitle>{dayHeading}</CardTitle>
              <Badge tone={day.events.length > 0 ? "primary" : "neutral"}>
                {t("championships.eventsCount", { count: day.events.length })}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {day.events.length === 0 ? (
                <EmptyState
                  icon={<CalendarDays />}
                  title={t("templates.noEventsOnDay")}
                  className="px-4 py-8"
                />
              ) : (
                <ul className="space-y-3">
                  {day.events.map((event, index) => {
                    const eventName = t(`events.${event.eventType}`);
                    return (
                      <li
                        key={event.key}
                        className="rounded-md border border-border bg-surface-sunken p-3"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="outline">{index + 1}</Badge>
                          <span className="min-w-0 flex-1 text-sm font-medium">{eventName}</span>
                          <Button
                            type="button"
                            size="iconSm"
                            variant="ghost"
                            onClick={() => moveEvent(day.dayNumber, index, -1)}
                            disabled={index === 0}
                            aria-label={`${t("templates.moveUp")}: ${eventName}`}
                          >
                            <ArrowUp aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            size="iconSm"
                            variant="ghost"
                            onClick={() => moveEvent(day.dayNumber, index, 1)}
                            disabled={index === day.events.length - 1}
                            aria-label={`${t("templates.moveDown")}: ${eventName}`}
                          >
                            <ArrowDown aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            size="iconSm"
                            variant="ghost"
                            onClick={() => removeEvent(day.dayNumber, event.key)}
                            aria-label={`${t("templates.removeEvent")}: ${eventName}`}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </div>

                        <div className="mt-3 space-y-2">
                          {event.runs.map((entry, runIndex) => {
                            const runLabel = t("templates.runNumber", { number: runIndex + 1 });
                            return (
                              <div
                                key={entry.key}
                                className="grid gap-2 sm:grid-cols-[5rem_1fr_1fr_auto] sm:items-end"
                              >
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted sm:pb-2.5">
                                  {runLabel}
                                </p>
                                <Field
                                  label={`${t("templates.pegSize")} (${t("common.centimetres")})`}
                                  htmlFor={`peg-${entry.key}`}
                                >
                                  <Input
                                    id={`peg-${entry.key}`}
                                    type="number"
                                    inputMode="decimal"
                                    step={0.5}
                                    min={0.1}
                                    max={999}
                                    required
                                    value={entry.pegSizeCm}
                                    onChange={(changed) =>
                                      updateRun(day.dayNumber, event.key, entry.key, {
                                        pegSizeCm: changed.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      normalizeRun(day.dayNumber, event.key, entry.key, runIndex)
                                    }
                                  />
                                </Field>
                                <Field
                                  label={`${t("templates.timeLimit")} (${t("common.seconds")})`}
                                  htmlFor={`time-${entry.key}`}
                                >
                                  <Input
                                    id={`time-${entry.key}`}
                                    type="number"
                                    inputMode="decimal"
                                    step={0.01}
                                    min={0.01}
                                    max={9999}
                                    required
                                    value={entry.timeLimitSeconds}
                                    onChange={(changed) =>
                                      updateRun(day.dayNumber, event.key, entry.key, {
                                        timeLimitSeconds: changed.target.value,
                                      })
                                    }
                                    onBlur={() =>
                                      normalizeRun(day.dayNumber, event.key, entry.key, runIndex)
                                    }
                                  />
                                </Field>
                                <Button
                                  type="button"
                                  size="iconSm"
                                  variant="ghost"
                                  onClick={() => removeRun(day.dayNumber, event.key, entry.key)}
                                  disabled={event.runs.length <= 1}
                                  aria-label={`${t("templates.removeRun")}: ${eventName}, ${runLabel}`}
                                  className="sm:mb-0.5"
                                >
                                  <Trash2 aria-hidden />
                                </Button>
                              </div>
                            );
                          })}
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => addRun(day.dayNumber, event.key)}
                          >
                            <Plus aria-hidden />
                            {t("templates.addRun")}
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  <Select
                    aria-label={`${t("templates.addEvent")}, ${dayHeading}`}
                    value={chosen ?? ""}
                    disabled={available.length === 0}
                    onChange={(changed) =>
                      setSelection((previous) => ({
                        ...previous,
                        [day.dayNumber]: changed.target.value,
                      }))
                    }
                  >
                    <option value="">{t("templates.eventType")}</option>
                    {available.map((key) => (
                      <option key={key} value={key}>
                        {t(`events.${key}`)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={chosen === undefined}
                  onClick={() => chosen && addEvent(day.dayNumber, chosen)}
                >
                  <Plus aria-hidden />
                  {t("templates.addEvent")}
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}

      {issues.length > 0 ? (
        <Callout tone="danger">
          <ul className="list-inside list-disc space-y-0.5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="secondary" asChild>
          <Link href="/templates">{t("common.cancel")}</Link>
        </Button>
        <Button type="submit" loading={pending} disabled={!canSubmit}>
          <Save aria-hidden />
          {props.mode === "create" ? t("common.create") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
