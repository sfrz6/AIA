"use client";

import * as React from "react";
import { DEFAULT_LOCALE, directionOf, intlTagOf, type Locale } from "./config";
import { createTranslator, getDictionary, type Translator } from "./index";

interface I18nValue {
  readonly locale: Locale;
  readonly dir: "ltr" | "rtl";
  readonly intlTag: string;
  readonly t: Translator;
}

const I18nContext = React.createContext<I18nValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = React.useMemo<I18nValue>(
    () => ({
      locale,
      dir: directionOf(locale),
      intlTag: intlTagOf(locale),
      t: createTranslator(getDictionary(locale)),
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = React.useContext(I18nContext);
  if (value) return value;
  // Falls back to the default locale so a component can be rendered in
  // isolation, for example inside a test, without a provider.
  return {
    locale: DEFAULT_LOCALE,
    dir: directionOf(DEFAULT_LOCALE),
    intlTag: intlTagOf(DEFAULT_LOCALE),
    t: createTranslator(getDictionary(DEFAULT_LOCALE)),
  };
}

export function useTranslator(): Translator {
  return useI18n().t;
}
