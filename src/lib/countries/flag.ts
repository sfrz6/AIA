/**
 * Flags are derived from the ISO 3166-1 alpha-2 code.
 *
 * The SVG files live under `public/flags` and were taken from the `flag-icons`
 * project at setup time, so nothing is fetched from an external host at runtime
 * and no image URL is stored against a country row. A country added later only
 * needs its SVG dropped into the same folder under its lowercase alpha-2 code.
 */
export function flagSrc(iso2: string): string | null {
  const code = iso2.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(code)) return null;
  return `/flags/${code}.svg`;
}
