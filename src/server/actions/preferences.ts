"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { isProduction } from "@/lib/env";

/**
 * Stores the reader's language choice.
 *
 * This is a display preference only and carries no personal data, so it is a
 * long lived, non sensitive cookie that the public results pages can read too.
 */
export async function setLocaleAction(formData: FormData): Promise<void> {
  const value = formData.get("locale");
  if (typeof value !== "string" || !isLocale(value)) return;

  const store = await cookies();
  store.set(LOCALE_COOKIE, value, {
    httpOnly: false,
    sameSite: "lax",
    secure: isProduction(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/", "layout");
}
