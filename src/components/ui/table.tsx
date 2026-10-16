import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Dense data table used for squads, scoring and standings.
 *
 * The wrapper scrolls horizontally on narrow screens rather than wrapping
 * cells, because a scoring row has to stay readable as a single line. A
 * touchscreen has no visible scrollbar track to hint that there is more to
 * see, so `scroll-shadow-x` paints a soft edge shadow that only shows on the
 * side that still has unscrolled content. The ref is forwarded so a table
 * with sticky columns (see `StandingsTable`) can track the scroll position
 * itself and shadow the sticky cells instead, which sit on top of this
 * wrapper's own background.
 */
export const TableWrapper = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  function TableWrapper({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn(
          "scroll-shadow-x w-full overflow-x-auto rounded-lg border border-border bg-surface-raised",
          className,
        )}
        {...props}
      />
    );
  },
);

export function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full caption-bottom text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-surface-sunken", className)} {...props} />;
}

export function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("", className)} {...props} />;
}

export function TFoot({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      className={cn("border-t-2 border-border-strong bg-surface-sunken font-semibold", className)}
      {...props}
    />
  );
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("border-t border-border first:border-t-0", className)} {...props} />;
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-start align-middle text-xs font-semibold uppercase tracking-wide text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-2 align-middle text-foreground", className)} {...props} />;
}

/** Right aligned numeric cell with tabular figures. */
export function TdNum({ className, ...props }: React.ComponentProps<"td">) {
  return <Td className={cn("numeric text-end tabular-nums", className)} {...props} />;
}

export function ThNum({ className, ...props }: React.ComponentProps<"th">) {
  return <Th className={cn("text-end", className)} {...props} />;
}
