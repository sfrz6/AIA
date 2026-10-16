import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The Assayel International Academy mark: a single transparent gold logo that
 * reads cleanly on both light and dark surfaces, so unlike the previous
 * two-asset federation logo it needs no light/dark swap.
 */
export function AiaLogo({
  className,
  width = 136,
  priority = false,
}: {
  className?: string;
  width?: number;
  priority?: boolean;
}) {
  const height = Math.round((width * 1242) / 1270);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
      style={{ width, height }}
    >
      <Image
        src="/brand/aia-logo.png"
        alt=""
        width={1270}
        height={1242}
        priority={priority}
        className="h-auto w-full"
      />
    </span>
  );
}

/**
 * Logo for printed documents and other always-white surfaces, sized by
 * height so it lines up evenly next to `OmanFederationLogoPrint`, whose
 * source image has a different aspect ratio.
 */
export function AiaLogoPrint({ height = 75 }: { height?: number }) {
  const width = Math.round((height * 1270) / 1242);
  return (
    <Image
      src="/brand/aia-logo.png"
      alt="Assayel International Academy"
      width={1270}
      height={1242}
      className="w-auto"
      style={{ width, height }}
      unoptimized
    />
  );
}

/**
 * Oman Equestrian and Racing Federation mark, shown alongside the academy
 * logo on official printed documents (round sheets and standings). Sized by
 * height, same as `AiaLogoPrint`, so the two logos match in height rather
 * than width despite their different aspect ratios.
 */
export function OmanFederationLogoPrint({ height = 75 }: { height?: number }) {
  const width = Math.round((height * 1144) / 860);
  return (
    <Image
      src="/brand/oman-federation-logo.png"
      alt="Oman Equestrian and Racing Federation"
      width={1144}
      height={860}
      className="w-auto"
      style={{ width, height }}
      unoptimized
    />
  );
}
