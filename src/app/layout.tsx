import type { Metadata, Viewport } from "next";
import { Providers } from "@/components/layout/providers";
import { getLocale } from "@/lib/i18n/server";
import { directionOf } from "@/lib/i18n/config";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AIA Competition System",
    template: "%s | AIA Competition System",
  },
  description:
    "Official competition management and scoring for Assayel International Academy championships.",
  icons: {
    icon: "/brand/aia-logo.png",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    title: "AIA",
    statusBarStyle: "black-translucent",
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#060d12" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={directionOf(locale)} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
