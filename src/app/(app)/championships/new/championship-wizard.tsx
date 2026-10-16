"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Trophy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form-controls";
import {
  Badge,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/surfaces";
import { formatCompetitionDate, formatPegSize } from "@/components/common/formatting";
import { eventLabel } from "@/components/common/labels";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import { cn } from "@/lib/cn";
import type { MessageKey } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { createChampionshipAction } from "@/server/actions/championships";
import { listClubRidersAction } from "@/server/actions/registry-queries";
import {
  SquadPicker,
  activeInOrder,
  isSquadComplete,
  isSquadEmpty,
  isSquadSavable,
  reserveRiderId,
  squadRiders,
  type SquadRiderOption,
  type SquadSelection,
} from "../squad-picker";

export interface WizardTemplateRun {
  readonly runNumber: number;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
}

export interface WizardTemplateEvent {
  readonly eventType: EventTypeKey;
  readonly runs: readonly WizardTemplateRun[];
}

export interface WizardTemplateDay {
  readonly dayNumber: number;
  readonly events: readonly WizardTemplateEvent[];
}

export interface WizardTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly days: readonly WizardTemplateDay[];
}

export interface WizardClub {
  readonly id: string;
  readonly name: string;
  readonly riderCount: number;
}

const STEP_KEYS: readonly MessageKey[] = [
  "championships.stepTemplate",
  "championships.stepDetails",
  "championships.stepClubs",
  "championships.stepRiders",
  "championships.stepReview",
];

const MIN_NAME_LENGTH = 3;
const MAX_NAME_LENGTH = 160;
const MIN_LOCATION_LENGTH = 2;
const MAX_TEXT_LENGTH = 160;
const MIN_CLUBS = 2;

/**
 * The competition dates derived from the start date, one per day the chosen
 * template actually uses, or null while the start date is incomplete.
 *
 * `addDays` belongs to the championship service, whose module reaches the
 * database client and therefore cannot be pulled into a browser bundle. The
 * arithmetic here is the same one: whole days added in UTC, so a calendar
 * date never shifts across a time zone, and the preview always matches the
 * dates the service stores. The day count mirrors
 * `createChampionshipFromTemplate`, which creates one championship day per
 * template day that has at least one event, not a fixed number.
 */
function competitionDatesFrom(startDate: string, dayCount: number): readonly string[] | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const [year, month, day] = startDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Array.from({ length: dayCount }, (_, index) =>
    new Date(Date.UTC(year, month - 1, day + index)).toISOString().slice(0, 10),
  );
}

export function ChampionshipWizard({
  templates,
  clubs,
}: {
  templates: readonly WizardTemplate[];
  clubs: readonly WizardClub[];
}) {
  const { locale, t } = useI18n();
  const router = useRouter();

  const [step, setStep] = React.useState(0);
  const [templateId, setTemplateId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [nameAr, setNameAr] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [locationAr, setLocationAr] = React.useState("");
  const [organizer, setOrganizer] = React.useState("");
  const [organizerAr, setOrganizerAr] = React.useState("");
  const [selected, setSelected] = React.useState<readonly string[]>([]);
  const [search, setSearch] = React.useState("");
  const [selections, setSelections] = React.useState<Record<string, SquadSelection>>({});
  const [ridersByClub, setRidersByClub] = React.useState<
    Record<string, readonly SquadRiderOption[]>
  >({});
  const [loadingRiders, setLoadingRiders] = React.useState<Record<string, boolean>>({});
  const [openClub, setOpenClub] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  // A club's registry is fetched once per club and kept for the rest of
  // the wizard, so going back and forth between the steps costs nothing.
  const requested = React.useRef<Set<string>>(new Set());

  const loadRiders = React.useCallback((clubId: string) => {
    if (requested.current.has(clubId)) return;
    requested.current.add(clubId);
    setLoadingRiders((previous) => ({ ...previous, [clubId]: true }));
    void listClubRidersAction(clubId).then((result) => {
      setLoadingRiders((previous) => ({ ...previous, [clubId]: false }));
      if (!result.ok) {
        requested.current.delete(clubId);
        toast.error(result.error);
        return;
      }
      setRidersByClub((previous) => ({ ...previous, [clubId]: result.data }));
    });
  }, []);

  const clubById = React.useMemo(
    () => new Map(clubs.map((club) => [club.id, club])),
    [clubs],
  );

  const template = templates.find((entry) => entry.id === templateId) ?? null;
  const templateActiveDayCount = template
    ? Math.max(1, template.days.filter((day) => day.events.length > 0).length)
    : 1;

  const trimmedName = name.trim();
  const trimmedNameAr = nameAr.trim();
  const trimmedLocation = location.trim();
  const trimmedLocationAr = locationAr.trim();
  const trimmedOrganizer = organizer.trim();
  const trimmedOrganizerAr = organizerAr.trim();

  const competitionDates = competitionDatesFrom(startDate, templateActiveDayCount);

  const detailsValid =
    trimmedName.length >= MIN_NAME_LENGTH &&
    trimmedName.length <= MAX_NAME_LENGTH &&
    trimmedNameAr.length <= MAX_TEXT_LENGTH &&
    trimmedLocation.length >= MIN_LOCATION_LENGTH &&
    trimmedLocation.length <= MAX_TEXT_LENGTH &&
    trimmedLocationAr.length <= MAX_TEXT_LENGTH &&
    trimmedOrganizer.length <= MAX_TEXT_LENGTH &&
    trimmedOrganizerAr.length <= MAX_TEXT_LENGTH &&
    competitionDates !== null;

  // Riders are optional at this step: a club's squad is either the full
  // four active riders plus one reserve, or left empty to decide later from
  // the Participants page, any time before that club's first run.
  const squadsSavable = selected.every((clubId) =>
    isSquadSavable(selections[clubId] ?? {}),
  );

  const stepValid: readonly boolean[] = [
    template !== null,
    detailsValid,
    selected.length >= MIN_CLUBS,
    selected.length >= MIN_CLUBS && squadsSavable,
    true,
  ];

  function unlocked(index: number): boolean {
    return stepValid.slice(0, index).every(Boolean);
  }

  function goTo(index: number) {
    if (!unlocked(index)) return;
    setStep(index);
  }

  function toggleClub(clubId: string, checked: boolean) {
    setSelected((previous) =>
      checked
        ? previous.includes(clubId)
          ? previous
          : [...previous, clubId]
        : previous.filter((entry) => entry !== clubId),
    );
    if (checked) {
      loadRiders(clubId);
      return;
    }
    setSelections((previous) => {
      const next = { ...previous };
      delete next[clubId];
      return next;
    });
  }

  // Entering the riders step covers the clubs that were selected before a
  // fetch could be started, for example after going back and editing.
  React.useEffect(() => {
    if (step !== 3) return;
    for (const clubId of selected) loadRiders(clubId);
  }, [step, selected, loadRiders]);

  const filteredClubs = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return clubs;
    return clubs.filter((club) => club.name.toLowerCase().includes(term));
  }, [clubs, search]);

  function create() {
    if (!template || !stepValid.every(Boolean) || pending) return;
    startTransition(async () => {
      const result = await createChampionshipAction({
        templateId: template.id,
        name: trimmedName,
        nameAr: trimmedNameAr || null,
        startDate,
        location: trimmedLocation,
        locationAr: trimmedLocationAr || null,
        organizer: trimmedOrganizer || null,
        organizerAr: trimmedOrganizerAr || null,
        squads: selected.map((clubId) => ({
          clubId,
          riders: squadRiders(selections[clubId] ?? {}),
        })),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("championships.createdSuccess"));
      router.push(`/championships/${result.data.id}`);
    });
  }

  const blockingMessage =
    step === 2 && selected.length < MIN_CLUBS
      ? t("championships.needTwoClubs")
      : step === 3 && !squadsSavable
        ? t("championships.incompleteSquads")
        : null;

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-1.5" aria-label={t("championships.newChampionship")}>
        {STEP_KEYS.map((key, index) => {
          const isCurrent = index === step;
          const isComplete = !isCurrent && stepValid[index] === true && unlocked(index);
          const isUnlocked = unlocked(index);
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => goTo(index)}
                disabled={!isUnlocked}
                aria-current={isCurrent ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  isCurrent
                    ? "border-primary bg-primary-subtle text-foreground"
                    : isComplete
                      ? "border-border-strong bg-surface-raised text-foreground hover:bg-surface-sunken"
                      : "border-border bg-surface-raised text-muted",
                  !isUnlocked && "cursor-not-allowed opacity-60",
                )}
              >
                <span
                  className={cn(
                    "numeric inline-flex size-5 items-center justify-center rounded-full text-[0.6875rem]",
                    isCurrent || isComplete
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-sunken text-muted",
                  )}
                  aria-hidden
                >
                  {isComplete ? <Check className="size-3" /> : index + 1}
                </span>
                {t(key)}
              </button>
            </li>
          );
        })}
      </ol>

      {step === 0 ? (
        <div className="space-y-3">
          <Callout tone="info">{t("championships.selectTemplateHint")}</Callout>
          <div className="grid gap-3 lg:grid-cols-2">
            {templates.map((entry) => {
              const isChosen = entry.id === templateId;
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTemplateId(entry.id)}
                  aria-pressed={isChosen}
                  className={cn(
                    "rounded-lg border bg-surface-raised p-4 text-start transition-colors",
                    isChosen
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:bg-surface-sunken",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm font-semibold">{entry.name}</span>
                    {isChosen ? (
                      <Badge tone="primary">
                        <Check className="size-3" aria-hidden />
                      </Badge>
                    ) : null}
                  </span>
                  {entry.description ? (
                    <span className="mt-1 block text-sm text-muted">{entry.description}</span>
                  ) : null}
                  <span className="mt-3 block space-y-2">
                    {entry.days.map((day) => (
                      <span key={day.dayNumber} className="block">
                        <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                          {t("templates.dayHeading", { day: day.dayNumber })}
                        </span>
                        {day.events.length === 0 ? (
                          <span className="block text-xs text-subtle">
                            {t("templates.noEventsOnDay")}
                          </span>
                        ) : (
                          day.events.map((event) => (
                            <span key={event.eventType} className="block text-xs text-muted">
                              {eventLabel(event.eventType, t)} ·{" "}
                              {t("championships.runsCount", { count: event.runs.length })} ·{" "}
                              <span className="numeric">
                                {event.runs
                                  .map((item) => formatPegSize(item.pegSizeCm))
                                  .join(", ")}{" "}
                                {t("common.centimetres")}
                              </span>
                            </span>
                          ))
                        )}
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("championships.stepDetails")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Callout tone="info">{t("championships.detailsHint")}</Callout>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t("championships.championshipName")}
                htmlFor="wizard-name"
                required
              >
                <Input
                  id="wizard-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  minLength={MIN_NAME_LENGTH}
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t("championships.championshipNameAr")}
                htmlFor="wizard-name-ar"
                hint={t("common.optional")}
              >
                <Input
                  id="wizard-name-ar"
                  dir="rtl"
                  value={nameAr}
                  onChange={(event) => setNameAr(event.target.value)}
                  maxLength={MAX_TEXT_LENGTH}
                  autoComplete="off"
                />
              </Field>
              <Field label={t("championships.startDate")} htmlFor="wizard-start-date" required>
                <Input
                  id="wizard-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field label={t("championships.location")} htmlFor="wizard-location" required>
                <Input
                  id="wizard-location"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  minLength={MIN_LOCATION_LENGTH}
                  maxLength={MAX_TEXT_LENGTH}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t("championships.locationAr")}
                htmlFor="wizard-location-ar"
                hint={t("common.optional")}
              >
                <Input
                  id="wizard-location-ar"
                  dir="rtl"
                  value={locationAr}
                  onChange={(event) => setLocationAr(event.target.value)}
                  maxLength={MAX_TEXT_LENGTH}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t("championships.organizer")}
                htmlFor="wizard-organizer"
                hint={t("common.optional")}
              >
                <Input
                  id="wizard-organizer"
                  value={organizer}
                  onChange={(event) => setOrganizer(event.target.value)}
                  maxLength={MAX_TEXT_LENGTH}
                  autoComplete="off"
                />
              </Field>
              <Field
                label={t("championships.organizerAr")}
                htmlFor="wizard-organizer-ar"
                hint={t("common.optional")}
              >
                <Input
                  id="wizard-organizer-ar"
                  dir="rtl"
                  value={organizerAr}
                  onChange={(event) => setOrganizerAr(event.target.value)}
                  maxLength={MAX_TEXT_LENGTH}
                  autoComplete="off"
                />
              </Field>
            </div>
            {competitionDates ? (
              <ul className="grid gap-2 sm:grid-cols-3">
                {competitionDates.map((date, index) => (
                  <li
                    key={date}
                    className="rounded-md border border-border bg-surface-sunken px-3 py-2"
                  >
                    <span className="block text-xs font-semibold uppercase tracking-wide text-muted">
                      {t("templates.dayHeading", { day: index + 1 })}
                    </span>
                    <span className="block text-sm">{formatCompetitionDate(date, locale)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t("championships.selectClubs")}</CardTitle>
            <Badge tone={selected.length >= MIN_CLUBS ? "success" : "outline"}>
              {t("championships.selectedClubs", { count: selected.length })}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <Callout tone="info">{t("championships.selectClubsHint")}</Callout>
            <Field label={t("common.search")} htmlFor="wizard-club-search">
              <Input
                id="wizard-club-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("clubs.searchPlaceholder")}
                autoComplete="off"
              />
            </Field>
            {filteredClubs.length === 0 ? (
              <p className="text-sm text-muted">{t("common.noResults")}</p>
            ) : (
              <ul className="max-h-96 divide-hairline overflow-y-auto rounded-md border border-border">
                {filteredClubs.map((club) => {
                  const checked = selected.includes(club.id);
                  return (
                    <li key={club.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface-sunken">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(next) => toggleClub(club.id, next === true)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{club.name}</span>
                          <span className="block text-xs text-muted">
                            {t("clubs.ridersCount", { count: club.riderCount })}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {step === 3 ? (
        <div className="space-y-3">
          <Callout tone="info">{t("championships.ridersHint")}</Callout>
          <Callout tone="info">{t("championships.ridersOptionalHint")}</Callout>
          {selected.map((clubId) => {
            const club = clubById.get(clubId);
            if (!club) return null;
            const selection = selections[clubId] ?? {};
            const riders = ridersByClub[clubId] ?? [];
            const complete = isSquadComplete(selection);
            const empty = isSquadEmpty(selection);
            const isOpen = openClub === clubId;
            return (
              <Card key={clubId}>
                <button
                  type="button"
                  onClick={() => setOpenClub(isOpen ? null : clubId)}
                  aria-expanded={isOpen}
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-sunken"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{club.name}</span>
                  {loadingRiders[clubId] ? (
                    <Loader2 className="size-4 animate-spin text-muted" aria-hidden />
                  ) : null}
                  <Badge tone={complete ? "success" : empty ? "outline" : "warning"}>
                    {complete ? <Check className="size-3" aria-hidden /> : null}
                    {empty
                      ? t("championships.ridersNotSelectedYet")
                      : t("championships.selectedClubs", {
                          count: Object.keys(selection).length,
                        })}
                  </Badge>
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-subtle transition-transform", isOpen && "rotate-180")}
                    aria-hidden
                  />
                </button>
                {isOpen ? (
                  <CardContent className="border-t border-border pt-4">
                    <SquadPicker
                      clubId={club.id}
                      clubName={club.name}
                      riders={riders}
                      value={selection}
                      onChange={(next) =>
                        setSelections((previous) => ({ ...previous, [clubId]: next }))
                      }
                      onRiderAdded={(rider) =>
                        setRidersByClub((previous) => ({
                          ...previous,
                          [clubId]: [...(previous[clubId] ?? []), rider],
                        }))
                      }
                    />
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : null}

      {step === 4 && template ? (
        <div className="space-y-3">
          <Callout tone="info">{t("championships.reviewHint")}</Callout>
          <Card>
            <CardHeader>
              <CardTitle>{t("championships.reviewTitle")}</CardTitle>
              <Badge tone="primary">{template.name}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.championshipName")}
                  </dt>
                  <dd className="text-sm">{trimmedName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.championshipNameAr")}
                  </dt>
                  <dd className="text-sm" dir="rtl">
                    {trimmedNameAr || "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.location")}
                  </dt>
                  <dd className="text-sm">{trimmedLocation}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.locationAr")}
                  </dt>
                  <dd className="text-sm" dir="rtl">
                    {trimmedLocationAr || "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.organizer")}
                  </dt>
                  <dd className="text-sm">{trimmedOrganizer || "-"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.organizerAr")}
                  </dt>
                  <dd className="text-sm" dir="rtl">
                    {trimmedOrganizerAr || "-"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t("championships.startDate")}
                  </dt>
                  <dd className="text-sm">
                    {competitionDates
                      ? competitionDates
                          .map((date) => formatCompetitionDate(date, locale))
                          .join(" · ")
                      : "-"}
                  </dd>
                </div>
              </dl>

              <Callout tone="info">{t("championships.clubOrderHint")}</Callout>

              <ul className="space-y-3">
                {selected.map((clubId, index) => {
                  const club = clubById.get(clubId);
                  if (!club) return null;
                  const selection = selections[clubId] ?? {};
                  const riders = ridersByClub[clubId] ?? [];
                  const nameOf = (riderId: string) =>
                    riders.find((rider) => rider.id === riderId)?.fullName ?? "";
                  const reserve = reserveRiderId(selection);
                  return (
                    <li
                      key={clubId}
                      className="rounded-md border border-border bg-surface-sunken p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="numeric inline-flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface-raised text-xs font-semibold text-muted">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-medium">{club.name}</span>
                      </div>
                      {isSquadEmpty(selection) ? (
                        <p className="mt-2 text-sm text-muted">
                          {t("championships.ridersNotSelectedYet")}
                        </p>
                      ) : (
                        <>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            {t("championships.activeRiders")}
                          </p>
                          <ol className="mt-1 space-y-0.5">
                            {activeInOrder(selection).map((riderId, riderIndex) => (
                              <li key={riderId} className="text-sm">
                                <span className="numeric me-2 text-muted">{riderIndex + 1}</span>
                                {nameOf(riderId)}
                              </li>
                            ))}
                          </ol>
                          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
                            {t("championships.reserveRider")}
                          </p>
                          <p className="text-sm">{reserve ? nameOf(reserve) : "-"}</p>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {blockingMessage ? <Callout tone="warning">{blockingMessage}</Callout> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {step === 0 ? (
          <Button variant="secondary" asChild>
            <Link href="/championships">{t("common.cancel")}</Link>
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => setStep(step - 1)}>
            {t("common.previous")}
          </Button>
        )}
        {step < STEP_KEYS.length - 1 ? (
          <Button onClick={() => goTo(step + 1)} disabled={stepValid[step] !== true}>
            {t("common.next")}
          </Button>
        ) : (
          <Button onClick={create} loading={pending} disabled={!stepValid.every(Boolean)}>
            <Trophy aria-hidden />
            {t("common.create")}
          </Button>
        )}
      </div>
    </div>
  );
}
