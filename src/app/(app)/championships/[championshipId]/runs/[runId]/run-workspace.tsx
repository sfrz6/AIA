"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  History,
  Pencil,
  Play,
  Printer,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form-controls";
import {
  Badge,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/surfaces";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/client";
import { formatDateTime, formatPegSize, formatTime } from "@/components/common/formatting";
import { runStatusLabel, runStatusTone } from "@/components/common/labels";
import type { EventTypeKey } from "@/domain/scoring/event-types";
import type { RunStatus } from "@/server/services/runs";
import {
  confirmRunAction,
  correctRunAction,
  saveRunScoresAction,
  startRunAction,
} from "@/server/actions/runs";
import {
  EntryOrderPanel,
  type EntryOrderCountry,
} from "./entry-order-panel";
import {
  ScoringGrid,
  buildDraft,
  draftToPayload,
  isDraftComplete,
  type ScoringCountry,
  type ScoringDraft,
} from "./scoring-grid";

export interface RunSummary {
  readonly runId: string;
  readonly eventId: string;
  readonly runNumber: number;
  readonly eventType: EventTypeKey;
  readonly pegSizeCm: string;
  readonly timeLimitSeconds: string;
  readonly status: RunStatus;
  readonly version: number;
  readonly dayNumber: number;
  /** True once any time or target has actually been saved for this run. */
  readonly scoresSaved: boolean;
}

export interface RunRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly reason: string;
  readonly changedByName: string;
  readonly createdAt: string;
}

export interface RunPermissions {
  readonly manageEntryOrders: boolean;
  readonly enterScores: boolean;
  readonly confirmRuns: boolean;
  readonly editConfirmed: boolean;
  readonly print: boolean;
}

export function RunWorkspace({
  championshipId,
  run,
  entryOrder,
  scoring,
  confirmedDayTotalByCountry,
  revisions,
  permissions,
  navigation,
}: {
  championshipId: string;
  run: RunSummary;
  entryOrder: {
    countries: readonly EntryOrderCountry[];
    confirmedCount: number;
    totalCount: number;
    allConfirmed: boolean;
  };
  scoring: readonly ScoringCountry[];
  /** Every other confirmed run's contribution today, per country, so the day total can be shown live. */
  confirmedDayTotalByCountry: Readonly<Record<string, string>>;
  revisions: readonly RunRevisionSummary[];
  permissions: RunPermissions;
  navigation: { previousRunId: string | null; nextRunId: string | null };
}) {
  const { locale, t } = useI18n();
  const router = useRouter();

  const [draft, setDraft] = React.useState<ScoringDraft>(() => buildDraft(scoring));
  const [correcting, setCorrecting] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [reasonError, setReasonError] = React.useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // The server is the source of truth: whenever the page reloads with fresh
  // values, the editor resets to them rather than keeping a stale draft.
  const scoringKey = React.useMemo(
    () => JSON.stringify(scoring.map((c) => c.units.map((u) => [u.runScoringUnitId, u.timeSeconds, u.riders.map((r) => r.targets)]))),
    [scoring],
  );
  const lastKey = React.useRef(scoringKey);
  React.useEffect(() => {
    if (lastKey.current !== scoringKey) {
      lastKey.current = scoringKey;
      setDraft(buildDraft(scoring));
    }
  }, [scoringKey, scoring]);

  const complete = isDraftComplete(scoring, draft);
  const isConfirmed = run.status === "CONFIRMED";
  const isScoring = run.status === "IN_PROGRESS" || run.status === "REVIEW";
  const isEntryOrderStage = run.status === "ENTRY_ORDER_PENDING" || run.status === "READY";
  // A country can be late submitting its final lineup, so the order stays
  // editable into scoring too, right up until the first score is saved.
  const entryOrderStillEditable =
    run.runNumber === 1 && run.status === "IN_PROGRESS" && !run.scoresSaved;
  const showEntryOrderPanel = isEntryOrderStage || entryOrderStillEditable;
  // Readiness is taken from the live count of confirmed countries rather than
  // from the stored status, which can lag when two countries are confirmed at
  // the same moment. The server applies the same rule.
  const readyToStart = isEntryOrderStage && entryOrder.allConfirmed;

  function handleResult(error: string, code?: string) {
    if (code === "CONCURRENCY") {
      setConflict(true);
      return;
    }
    toast.error(error);
  }

  function start() {
    startTransition(async () => {
      const result = await startRunAction({ runId: run.runId, expectedVersion: run.version });
      if (!result.ok) return handleResult(result.error, result.code);
      toast.success(t("runs.runStarted"));
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveRunScoresAction({
        runId: run.runId,
        expectedVersion: run.version,
        payload: draftToPayload(scoring, draft),
      });
      if (!result.ok) return handleResult(result.error, result.code);
      toast.success(t("runs.scoresSaved"));
      router.refresh();
    });
  }

  function confirm() {
    startTransition(async () => {
      const result = await confirmRunAction({
        runId: run.runId,
        expectedVersion: run.version,
      });
      if (!result.ok) {
        setConfirmOpen(false);
        return handleResult(result.error, result.code);
      }
      setConfirmOpen(false);
      toast.success(t("runs.confirmedSuccess"));
      router.refresh();
    });
  }

  function saveCorrection() {
    if (reason.trim().length < 5) {
      setReasonError(t("runs.reasonRequired"));
      return;
    }
    setReasonError(null);
    startTransition(async () => {
      const result = await correctRunAction({
        runId: run.runId,
        expectedVersion: run.version,
        payload: draftToPayload(scoring, draft),
        reason: reason.trim(),
      });
      if (!result.ok) {
        if (result.fieldErrors?.reason) setReasonError(result.fieldErrors.reason);
        return handleResult(result.error, result.code);
      }
      setCorrecting(false);
      setReason("");
      toast.success(t("runs.correctionSaved"));
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="py-3">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("common.status")}</dt>
              <dd>
                <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status, t)}</Badge>
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("runs.pegSize")}</dt>
              <dd className="numeric font-medium">
                {formatPegSize(run.pegSizeCm)} {t("common.centimetres")}
              </dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="text-muted">{t("runs.timeLimit")}</dt>
              <dd className="numeric font-medium">
                {formatTime(run.timeLimitSeconds)} {t("common.seconds")}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            {permissions.print && (readyToStart || !isEntryOrderStage) ? (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={`/print/events/${run.eventId}`}
                  target="_blank"
                >
                  <Printer aria-hidden />
                  {t("runs.printRoundSheet")}
                </Link>
              </Button>
            ) : null}

            {readyToStart && permissions.enterScores ? (
              <Button size="sm" loading={pending} onClick={start}>
                <Play aria-hidden />
                {t("runs.startRun")}
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {conflict ? (
        <Callout tone="danger" title={t("runs.conflictTitle")}>
          <p>{t("runs.conflictBody")}</p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => {
              setConflict(false);
              router.refresh();
            }}
          >
            {t("runs.reload")}
          </Button>
        </Callout>
      ) : null}

      {showEntryOrderPanel ? (
        <EntryOrderPanel
          championshipId={championshipId}
          runId={run.runId}
          countries={entryOrder.countries}
          confirmedCount={entryOrder.confirmedCount}
          totalCount={entryOrder.totalCount}
          canManage={permissions.manageEntryOrders && run.runNumber === 1}
          locked={run.runNumber > 1}
          editableWhileScoring={entryOrderStillEditable}
        />
      ) : null}

      {isEntryOrderStage && !readyToStart ? (
        <Callout tone="warning">{t("runs.entryOrdersIncomplete")}</Callout>
      ) : null}

      {isScoring || isConfirmed ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">
              {isConfirmed ? t("runs.reviewRun") : t("runs.scoring")}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              {isScoring && permissions.enterScores ? (
                <Button variant="secondary" size="sm" loading={pending} onClick={save}>
                  <Save aria-hidden />
                  {t("common.save")}
                </Button>
              ) : null}

              {isScoring && permissions.confirmRuns ? (
                <Button size="sm" disabled={!complete} onClick={() => setConfirmOpen(true)}>
                  <ShieldCheck aria-hidden />
                  {t("runs.confirmRun")}
                </Button>
              ) : null}

              {isConfirmed && permissions.editConfirmed && !correcting ? (
                <Button variant="secondary" size="sm" onClick={() => setCorrecting(true)}>
                  <Pencil aria-hidden />
                  {t("runs.editConfirmed")}
                </Button>
              ) : null}
            </div>
          </div>

          {isScoring && !complete ? (
            <Callout tone="warning">{t("runs.incompleteScores")}</Callout>
          ) : null}

          {correcting ? (
            <Card className="border-warning/50">
              <CardHeader className="py-3">
                <CardTitle>{t("runs.editConfirmedTitle")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Callout tone="warning">{t("runs.editConfirmedHint")}</Callout>
                <Field
                  label={t("runs.reasonLabel")}
                  htmlFor="correction-reason"
                  required
                  error={reasonError}
                >
                  <Textarea
                    id="correction-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder={t("runs.reasonPlaceholder")}
                    maxLength={1000}
                    aria-invalid={reasonError ? true : undefined}
                  />
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setCorrecting(false);
                      setReason("");
                      setReasonError(null);
                      setDraft(buildDraft(scoring));
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button loading={pending} disabled={!complete} onClick={saveCorrection}>
                    <Save aria-hidden />
                    {t("common.save")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <ScoringGrid
            eventType={run.eventType}
            timeLimitSeconds={run.timeLimitSeconds}
            countries={scoring}
            draft={draft}
            onChange={setDraft}
            readOnly={isConfirmed ? !correcting : !permissions.enterScores}
            confirmedDayTotalByCountry={confirmedDayTotalByCountry}
          />
        </section>
      ) : null}

      {revisions.length > 0 ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="flex items-center gap-2">
              <History className="size-4" aria-hidden />
              {t("runs.revisionHistory")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="divide-hairline overflow-hidden rounded-md border border-border">
              {revisions.map((revision) => (
                <li key={revision.id} className="space-y-1 bg-surface-raised px-3 py-2.5">
                  <p className="text-xs text-muted">
                    {t("runs.revisionNumber", { number: revision.revisionNumber })} ·{" "}
                    {t("runs.changedBy", { name: revision.changedByName })} ·{" "}
                    {formatDateTime(new Date(revision.createdAt), locale)}
                  </p>
                  <p className="text-sm">{revision.reason}</p>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      <nav
        data-app-nav
        aria-label={t("championships.schedule")}
        className="flex items-center justify-between gap-2 border-t border-border pt-4"
      >
        {navigation.previousRunId ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/championships/${championshipId}/runs/${navigation.previousRunId}`}>
              <ChevronLeft className="rtl:rotate-180" aria-hidden />
              {t("runs.previousRun")}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        {navigation.nextRunId ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/championships/${championshipId}/runs/${navigation.nextRunId}`}>
              {t("runs.nextRun")}
              <ChevronRight className="rtl:rotate-180" aria-hidden />
            </Link>
          </Button>
        ) : (
          <span />
        )}
      </nav>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("runs.confirmRunTitle")}
        description={t("runs.confirmRunBody")}
        confirmLabel={t("runs.confirmRun")}
        cancelLabel={t("common.cancel")}
        loading={pending}
        onConfirm={confirm}
      />
    </div>
  );
}
