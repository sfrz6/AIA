/**
 * Chrome free shell for public standings PDFs, printed by a visitor rather
 * than operated.
 *
 * Deliberately not authenticated, unlike the officials' round sheet: once a
 * championship is published, its standings are already public knowledge, so
 * this is the same content as the results page, just paginated for paper.
 * Forces white on black regardless of the visitor's theme, so the printed
 * page always looks the same.
 */
export default function PublicPrintLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-white text-black">{children}</div>;
}
