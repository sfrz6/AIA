import { en, type Dictionary } from "./dictionaries/en";
import { ar } from "./dictionaries/ar";
import { DEFAULT_LOCALE, type Locale } from "./config";

const DICTIONARIES: Record<Locale, Dictionary> = { en, ar };

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

/** Dot separated paths to every leaf string in the dictionary. */
type Leaves<T> = T extends string
  ? ""
  : {
      [K in keyof T & string]: Leaves<T[K]> extends infer R extends string
        ? R extends ""
          ? K
          : `${K}.${R}`
        : never;
    }[keyof T & string];

export type MessageKey = Leaves<Dictionary>;

export type MessageParams = Record<string, string | number>;

function resolve(dictionary: Dictionary, key: string): string | undefined {
  let current: unknown = dictionary;
  for (const segment of key.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : undefined;
}

export type Translator = (key: MessageKey, params?: MessageParams) => string;

/**
 * Builds a translator over a dictionary.
 *
 * A missing key returns the key itself rather than throwing, so a copy gap can
 * never take down a scoring screen in the middle of a competition. Missing keys
 * are impossible in practice because `ar` is typed against `en`.
 */
export function createTranslator(dictionary: Dictionary): Translator {
  return (key, params) => {
    const template = resolve(dictionary, key);
    if (template === undefined) return key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
  };
}

export { en, ar, type Dictionary };
export * from "./config";
