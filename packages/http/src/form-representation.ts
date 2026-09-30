import { BadRequestException } from './exceptions.js';
import type { HttpErrorRepresentationContext } from './types.js';

/** Exact negotiated media type for progressive HTTP form outcomes. */
export const HTTP_FORM_MEDIA_TYPE = 'application/vnd.fluo.form+json;v=1';
/** HTTP-local classification of a rejection from the DTO validation phase. */
export const HTTP_FORM_VALIDATION = Symbol.for('fluo.http.form-validation.v1');
const rejectionKey = Symbol.for('fluo.http.form-rejection.v1');

/** Application-authored safe messages; never copies submitted values or exception bodies. */
export type HttpFormErrors = {
  readonly fieldErrors: Readonly<Record<string, readonly string[]>>;
  readonly formErrors: readonly string[];
};

/** Explicit opt-in safe DTO-error projection inside the active HTTP request scope. */
export type HttpFormRepresentationProvider = {
  /** Project only allowlisted nonsecret errors; undefined retains canonical JSON. */
  readonly project: (context: HttpErrorRepresentationContext) =>
    HttpFormErrors | undefined | Promise<HttpFormErrors | undefined>;
};

/** A deliberate domain validation rejection, distinct from an arbitrary 400 or 422. */
export class HttpFormRejection {
  /**
   * Create an HTTP validation exception with an explicit safe form projection.
   *
   * @param errors Application-authored bounded field and form messages.
   * @returns A status-400 exception for the existing HTTP error pipeline.
   */
  static create(errors: HttpFormErrors): BadRequestException {
    const safe = parseHttpFormErrors(errors);
    if (safe === undefined) throw new TypeError('Invalid or oversized form errors.');
    const error = new BadRequestException('Form input was rejected.');
    Object.defineProperty(error, rejectionKey, { value: safe });
    return error;
  }
}

/**
 * Read a compatible-copy explicit form rejection without interpreting generic error details.
 *
 * @param error HTTP-classified exception.
 * @returns Its safe form messages when explicitly marked.
 */
export function readHttpFormRejection(error: object): HttpFormErrors | undefined {
  return parseHttpFormErrors(Reflect.get(error, rejectionKey));
}

/**
 * Bound an untrusted form projection before HTTP emits it.
 *
 * @param value Application projection at the representation boundary.
 * @returns Valid safe message data, or undefined for malformed or oversized data.
 */
export function parseHttpFormErrors(value: unknown): HttpFormErrors | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const fields: unknown = Reflect.get(value, 'fieldErrors');
  const form: unknown = Reflect.get(value, 'formErrors');
  const messages = (candidate: unknown): candidate is readonly string[] =>
    Array.isArray(candidate) && candidate.length <= 8
    && candidate.every((item: unknown) => typeof item === 'string' && item.length > 0 && item.length <= 256);
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields) || !messages(form)) return undefined;
  const entries = Object.entries(fields);
  if (entries.length > 32) return undefined;
  const fieldErrors: Record<string, readonly string[]> = Object.create(null);
  for (const [name, errors] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/u.test(name) || !messages(errors)) return undefined;
    fieldErrors[name] = [...errors];
  }
  return { fieldErrors, formErrors: [...form] };
}
