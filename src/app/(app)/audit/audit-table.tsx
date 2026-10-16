"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/surfaces";
import { Table, TableWrapper, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/components/common/formatting";
import { useI18n } from "@/lib/i18n/client";
import { en, type MessageKey, type Translator } from "@/lib/i18n";

export interface AuditRow {
  readonly id: string;
  readonly actorName: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly reason: string | null;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly createdAt: Date;
}

const COLUMN_COUNT = 6;

/**
 * Translates a stored action or entity code.
 *
 * Codes such as `USER_CREATED` are stable identifiers written by the services,
 * never copy. They are looked up in the dictionary, and an unknown code falls
 * back to its own text so an audit row stays readable even if a new action is
 * recorded before its wording is added.
 */
function translateCode(
  section: "auditActions" | "auditEntities",
  code: string,
  t: Translator,
): string {
  const known = Object.prototype.hasOwnProperty.call(en[section], code);
  return known ? t(`${section}.${code}` as MessageKey) : code;
}

function Payload({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <pre className="overflow-x-auto rounded-md border border-border bg-surface-sunken p-2 font-mono text-[0.6875rem] leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditTable({ entries }: { entries: readonly AuditRow[] }) {
  const { t, locale } = useI18n();
  const [expanded, setExpanded] = React.useState<readonly string[]>([]);

  function toggle(id: string) {
    setExpanded((current) =>
      current.includes(id) ? current.filter((held) => held !== id) : [...current, id],
    );
  }

  return (
    <TableWrapper>
      <Table>
        <THead>
          <Tr>
            <Th className="w-8" />
            <Th>{t("audit.when")}</Th>
            <Th>{t("audit.actor")}</Th>
            <Th>{t("audit.action")}</Th>
            <Th>{t("audit.entity")}</Th>
            <Th>{t("common.reason")}</Th>
          </Tr>
        </THead>
        <TBody>
          {entries.map((entry) => {
            const isOpen = expanded.includes(entry.id);
            const hasPayload = entry.beforeData !== null || entry.afterData !== null;

            return (
              <React.Fragment key={entry.id}>
                <Tr>
                  <Td>
                    {hasPayload ? (
                      <Button
                        size="iconSm"
                        variant="ghost"
                        onClick={() => toggle(entry.id)}
                        aria-expanded={isOpen}
                        aria-label={t("audit.details")}
                      >
                        {isOpen ? (
                          <ChevronDown aria-hidden />
                        ) : (
                          <ChevronRight className="rtl:rotate-180" aria-hidden />
                        )}
                      </Button>
                    ) : null}
                  </Td>
                  <Td className="whitespace-nowrap text-muted">
                    {formatDateTime(entry.createdAt, locale)}
                  </Td>
                  <Td className="font-medium">{entry.actorName}</Td>
                  <Td>
                    <Badge tone="outline">{translateCode("auditActions", entry.action, t)}</Badge>
                  </Td>
                  <Td>
                    <span className="block text-sm">
                      {translateCode("auditEntities", entry.entityType, t)}
                    </span>
                    {entry.entityId ? (
                      <span className="block font-mono text-[0.6875rem] text-subtle">
                        {entry.entityId}
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-muted">{entry.reason ?? "-"}</Td>
                </Tr>
                {isOpen ? (
                  <Tr>
                    <Td colSpan={COLUMN_COUNT} className="bg-surface-sunken/40">
                      <div className="grid gap-3 md:grid-cols-2">
                        {entry.beforeData !== null ? (
                          <Payload label={t("audit.before")} value={entry.beforeData} />
                        ) : null}
                        {entry.afterData !== null ? (
                          <Payload label={t("audit.after")} value={entry.afterData} />
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </TBody>
      </Table>
    </TableWrapper>
  );
}
