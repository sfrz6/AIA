import { flagSrc } from "@/lib/countries/flag";
import { cn } from "@/lib/cn";

const SIZES = {
  xs: "h-3 w-4",
  sm: "h-3.5 w-5",
  md: "h-4 w-6",
  lg: "h-5 w-7",
} as const;

export function CountryFlag({
  iso2,
  name,
  size = "sm",
  className,
}: {
  iso2: string;
  name?: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const src = flagSrc(iso2);
  if (!src) return null;
  return (
    // The flag is decorative next to the country name, so it carries an empty
    // alt text unless it is used on its own.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name ?? ""}
      aria-hidden={name ? undefined : true}
      loading="lazy"
      decoding="async"
      className={cn(
        "inline-block shrink-0 rounded-[2px] border border-border object-cover",
        SIZES[size],
        className,
      )}
    />
  );
}

/** Flag followed by the country name, the standard way a country is shown. */
export function CountryLabel({
  iso2,
  name,
  size = "sm",
  className,
  code = false,
}: {
  iso2: string;
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
  code?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <CountryFlag iso2={iso2} size={size} />
      <span className="truncate">{name}</span>
      {code ? <span className="text-xs text-subtle">{iso2}</span> : null}
    </span>
  );
}
