"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { CountryFlag } from "@/components/common/country-flag";
import { Badge, EmptyState } from "@/components/ui/surfaces";
import { Table, TBody, Td, TdNum, THead, Th, ThNum, TableWrapper, Tr } from "@/components/ui/table";
import { useI18n } from "@/lib/i18n/client";
import type { DayNumber, StandingsScope, StandingsSubject } from "@/domain/results";
import type { StandingRow } from "./standings-data";

/**
 * The standings table shared by the internal results tab and the public
 * results page, so an official and a spectator read exactly the same numbers.
 *
 * Rank, name and total stay pinned while any remaining columns scroll, which
 * keeps the table readable on a narrow phone without hiding any value.
 */

const STICKY_START = "sticky start-0 z-20";
const STICKY_NAME = "standings-sticky-name sticky start-14 z-20";
const STICKY_END = "standings-sticky-end sticky end-0 z-20";

/**
 * Tracks whether a horizontally scrolling element has more content hidden
 * before or after the current scroll position, so a caller can shadow its own
 * sticky edge columns.
 *
 * `TableWrapper`'s own `scroll-shadow-x` background works for a plain table,
 * but here the sticky Rank, name and total cells sit on top of that
 * background and would hide it completely, so the shadow has to be painted on
 * the sticky cells themselves instead, driven by this hook.
 *
 * Reads `scrollLeft` against the standardised RTL convention (0 at the start,
 * negative towards the end) that current Chrome, Safari and Firefox all share,
 * which this project targets through evergreen iOS and Android browsers.
 */
function useHorizontalScrollEdges<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>;
  canScrollStart: boolean;
  canScrollEnd: boolean;
} {
  const ref = React.useRef<T | null>(null);
  // Direction cannot change without a full remount (switching locale reloads
  // the page), so it is read once rather than on every scroll tick, which
  // would otherwise force a style recalculation on a hot path.
  const isRtlRef = React.useRef(false);
  const [canScrollStart, setCanScrollStart] = React.useState(false);
  const [canScrollEnd, setCanScrollEnd] = React.useState(false);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    if (maxScroll <= 1) {
      setCanScrollStart(false);
      setCanScrollEnd(false);
      return;
    }
    if (isRtlRef.current) {
      setCanScrollStart(el.scrollLeft < -1);
      setCanScrollEnd(el.scrollLeft > -(maxScroll - 1));
    } else {
      setCanScrollStart(el.scrollLeft > 1);
      setCanScrollEnd(el.scrollLeft < maxScroll - 1);
    }
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    isRtlRef.current = getComputedStyle(el).direction === "rtl";
    update();

    const resizeObserver = new ResizeObserver(() => {
      isRtlRef.current = getComputedStyle(el).direction === "rtl";
      update();
    });
    resizeObserver.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      resizeObserver.disconnect();
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  return { ref, canScrollStart, canScrollEnd };
}

/**
 * The name column only has room for a line or two before it starts crowding
 * the sticky rank/total columns, so long names (a long transliterated rider
 * name, or a long country name on a narrow screen) still get cut off with an
 * ellipsis. Clicking the text reveals the full name in a small floating
 * popup instead of silently hiding part of it with no way to read the rest.
 */
function TruncatedName({ text }: { text: string }) {
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const [popup, setPopup] = React.useState<{ top: number; left: number } | null>(null);

  React.useEffect(() => {
    if (!popup) return;
    const close = () => setPopup(null);
    const onPointerDown = (event: PointerEvent) => {
      if (buttonRef.current?.contains(event.target as Node)) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [popup]);

  const handleClick = () => {
    const el = buttonRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const box = el.getBoundingClientRect();
    const left = Math.min(Math.max(box.left, 8), window.innerWidth - 8 - 256);
    setPopup({ top: box.bottom + 4, left });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        className="block max-w-full truncate text-start"
      >
        {text}
      </button>
      {popup
        ? createPortal(
            <div
              role="tooltip"
              className="fixed z-50 max-w-64 rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-sm shadow-lg"
              style={{ top: popup.top, left: popup.left }}
            >
              {text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export function StandingsTable({
  subject,
  scope,
  days,
  rows,
}: {
  subject: StandingsSubject;
  /**
   * The day by day breakdown columns only add information in the overall
   * view: once a single day is selected, the Total column already is that
   * day's value, so repeating it as its own column plus showing every other
   * day would only widen the table on exactly the device where width matters
   * most, for no new information.
   */
  scope: StandingsScope;
  days: readonly DayNumber[];
  rows: readonly StandingRow[];
}) {
  const { t } = useI18n();
  const { ref: scrollRef, canScrollStart, canScrollEnd } = useHorizontalScrollEdges<HTMLDivElement>();

  if (rows.length === 0) {
    return <EmptyState title={t("results.noData")} />;
  }

  const isCountry = subject === "COUNTRY";
  const showDayBreakdown = scope === "OVERALL" && days.length > 1;

  return (
    <TableWrapper
      ref={scrollRef}
      data-can-scroll-start={canScrollStart || undefined}
      data-can-scroll-end={canScrollEnd || undefined}
    >
      <Table>
        <THead>
          <Tr>
            <ThNum className={cn(STICKY_START, "w-14 bg-surface-sunken text-center")}>
              {t("common.rank")}
            </ThNum>
            <Th className={cn(STICKY_NAME, "min-w-40 bg-surface-sunken border-e border-border")}>
              {isCountry ? t("common.country") : t("common.rider")}
            </Th>
            {isCountry ? (
              <>
                <ThNum className="whitespace-nowrap">{t("results.riderPoints")}</ThNum>
                <ThNum className="whitespace-nowrap">{t("results.countryFaults")}</ThNum>
              </>
            ) : null}
            {showDayBreakdown
              ? days.map((day) => (
                  <ThNum key={day} className="whitespace-nowrap">
                    {t("results.dayResults", { day })}
                  </ThNum>
                ))
              : null}
            <ThNum className={cn(STICKY_END, "bg-surface-sunken border-s border-border")}>
              {t("common.total")}
            </ThNum>
          </Tr>
        </THead>
        <TBody>
          {rows.map((row) => {
            // Rank 1, 2 and 3 are the podium: they read slightly stronger
            // (this is official software, so a placing carries no other
            // decoration), and it's the only part of the table where a tie
            // is worth flagging — further down, a tie carries no separate
            // consequence, so the badge would only be noise.
            const isPodium = row.rank <= 3;
            return (
              <Tr key={row.key} className={cn(isPodium && "font-medium")}>
                <TdNum
                  className={cn(STICKY_START, "w-14 bg-surface-raised text-center text-muted")}
                >
                  {row.rank}
                </TdNum>
                <Td className={cn(STICKY_NAME, "min-w-40 bg-surface-raised border-e border-border")}>
                  <span className="flex items-center gap-2">
                    <CountryFlag iso2={row.iso2} className="shrink-0" />
                    <span className="min-w-0 max-w-64 flex-1">
                      <TruncatedName text={row.name} />
                      {isCountry ? null : (
                        <span className="flex items-center gap-1">
                          <span className="min-w-0 truncate text-xs text-muted">
                            {row.countryName}
                          </span>
                          {row.isTiedAfterTieBreak && isPodium ? (
                            <Badge tone="warning" className="shrink-0 px-1 py-0 text-[0.625rem]">
                              {t("results.tied")}
                            </Badge>
                          ) : null}
                        </span>
                      )}
                    </span>
                    {isCountry && row.isTiedAfterTieBreak && isPodium ? (
                      <Badge tone="warning" className="shrink-0 px-1 py-0 text-[0.625rem]">
                        {t("results.tied")}
                      </Badge>
                    ) : null}
                  </span>
                </Td>
                {isCountry ? (
                  <>
                    <TdNum className="text-muted">{row.riderPoints}</TdNum>
                    <TdNum className="text-muted">{row.countryFaults}</TdNum>
                  </>
                ) : null}
                {showDayBreakdown
                  ? row.dayValues.map((value) => (
                      <TdNum key={value.day} className="text-muted">
                        {value.value}
                      </TdNum>
                    ))
                  : null}
                <TdNum
                  className={cn(
                    STICKY_END,
                    "bg-surface-raised border-s border-border font-semibold",
                  )}
                >
                  {row.total}
                </TdNum>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </TableWrapper>
  );
}

export interface ToggleOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

/**
 * Small segmented control used for the subject and scope choices. It is a
 * radio group rather than a tab library so the whole table stays in one
 * accessible document order.
 */
export function StandingsToggle<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly ToggleOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-border-strong"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            // Taller than usual below the sm breakpoint, where this is most
            // likely a visitor's phone and finger sized touch targets matter
            // more than the density an operator's tablet or laptop benefits
            // from.
            "h-10 whitespace-nowrap border-s border-border-strong px-3 text-xs transition-colors first:border-s-0 sm:h-8",
            option.value === value
              ? "bg-primary font-semibold text-primary-foreground"
              : "bg-surface-raised text-foreground hover:bg-surface-sunken",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

