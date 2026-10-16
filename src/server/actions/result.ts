import { AuthorizationError } from "@/lib/auth/authorize";

/**
 * Uniform result shape returned by every server action.
 *
 * Actions never throw across the network boundary: they return a tagged result
 * so the client can show a precise message, and so an unexpected failure is
 * reported as a safe generic message rather than leaking internals.
 */
export type ActionResult<T = undefined> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code?: ActionErrorCode;
      /** Field level messages keyed by form field name. */
      readonly fieldErrors?: Readonly<Record<string, string>>;
    };

export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "CONFLICT"
  | "NOT_FOUND"
  | "CONCURRENCY"
  | "UNEXPECTED";

export function ok(): ActionResult<undefined>;
export function ok<T>(data: T): ActionResult<T>;
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function fail(
  error: string,
  code: ActionErrorCode = "VALIDATION",
  fieldErrors?: Record<string, string>,
): ActionResult<never> {
  return { ok: false, error, code, fieldErrors };
}

/** Raised by services for an expected, reportable condition. */
export class DomainError extends Error {
  readonly code: ActionErrorCode;
  readonly fieldErrors?: Record<string, string>;

  constructor(message: string, code: ActionErrorCode = "VALIDATION", fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** Raised when a record changed between loading a form and submitting it. */
export class ConcurrencyError extends DomainError {
  constructor(message = "This record was changed by someone else while you were working on it.") {
    super(message, "CONCURRENCY");
    this.name = "ConcurrencyError";
  }
}

/**
 * Wraps a server action body, converting known errors into results and hiding
 * the detail of anything unexpected.
 */
export async function run<T>(body: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await body();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { ok: false, error: error.message, code: error.code };
    }
    if (error instanceof DomainError) {
      return {
        ok: false,
        error: error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      };
    }
    console.error("Unhandled server action error:", error);
    return {
      ok: false,
      error: "Something went wrong. Please try again.",
      code: "UNEXPECTED",
    };
  }
}
