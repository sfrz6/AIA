import { redirect } from "next/navigation";
import { currentPrincipalOrNull } from "@/lib/auth/authorize";

/**
 * Chrome free shell for documents that are printed rather than operated.
 *
 * Still behind authentication: a round sheet lists the confirmed entry order
 * before the public results exist.
 */
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipalOrNull();
  if (!principal) redirect("/sign-in");
  return <div className="min-h-dvh bg-white text-black">{children}</div>;
}
