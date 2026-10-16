import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";
import { createTranslator, getDictionary, type Translator } from "./index";

/**
 * Locale for the current request.
 *
 * The locale lives in a cookie rather than in the URL so that every route works
 * in both languages without duplicating the route tree, and so that a link
 * shared from a public results page keeps working whatever the reader's
 * language preference is.
 */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function getTranslator(): Promise<{ locale: Locale; t: Translator }> {
  const locale = await getLocale();
  return { locale, t: createTranslator(getDictionary(locale)) };
}
