import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The supplied federation logos, used unmodified.
 *
 * Two files were provided, both transparent: one drawn for light backgrounds
 * (teal and gold) and one drawn for dark backgrounds (white and gold). Both are
 * rendered and swapped with CSS rather than JavaScript, so the correct one is
 * already on screen at first paint and the theme never flashes.
 */
export function ItpfLogo({
  className,
  width = 136,
  priority = false,
}: {
  className?: string;
  width?: number;
  priority?: boolean;
}) {
  const height = Math.round((width * 430) / 512);
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center", className)}
      style={{ width, height }}
    >
      <Image
        src="/brand/itpf-logo-light.webp"
        alt=""
        width={512}
        height={430}
        priority={priority}
        className="h-auto w-full dark:hidden"
      />
      <Image
        src="/brand/itpf-logo-dark-v2.png"
        alt=""
        width={511}
        height={430}
        priority={priority}
        className="hidden h-auto w-full dark:block"
      />
    </span>
  );
}

/** Light logo only, for printed documents and other always-white surfaces. */
export function ItpfLogoPrint({ width = 110 }: { width?: number }) {
  return (
    <Image
      src="/brand/itpf-logo-light.webp"
      alt="International Tent Pegging Federation"
      width={512}
      height={430}
      className="h-auto"
      style={{ width }}
      unoptimized
    />
  );
}
