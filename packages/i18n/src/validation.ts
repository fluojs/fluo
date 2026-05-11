import { DtoValidationError, type ValidationIssue } from '@fluojs/validation';

import { I18nError } from './errors.js';
import type { I18nInterpolationValues, I18nLocale, I18nTranslationKey } from './types.js';
import type { I18nService } from './service.js';

/**
 * Context used to derive translation keys for one validation issue.
 */
export interface ValidationIssueTranslationKeyContext {
  /** Validation issue being localized. */
  readonly issue: ValidationIssue;
  /** Zero-based index of the issue in the caller-provided issue list. */
  readonly index: number;
}

/**
 * Builds candidate i18n translation keys for one validation issue.
 */
export type ValidationIssueTranslationKeyBuilder = (
  context: ValidationIssueTranslationKeyContext,
) => readonly I18nTranslationKey[];

/**
 * Options for opt-in validation issue localization.
 */
export interface LocalizeValidationIssuesOptions {
  /** Locale used for validation issue message lookup. */
  readonly locale: I18nLocale;
  /** Optional namespace passed to `I18nService.translate(...)`. Defaults to `validation`. */
  readonly namespace?: I18nTranslationKey;
  /** Optional prefix prepended to generated candidate keys. */
  readonly keyPrefix?: I18nTranslationKey;
  /** Custom key builder for applications that own a different catalog shape. */
  readonly keyBuilder?: ValidationIssueTranslationKeyBuilder;
  /** Whether missing translations should preserve the original issue message. Defaults to `true`. */
  readonly fallbackToIssueMessage?: boolean;
}

const DEFAULT_VALIDATION_NAMESPACE = 'validation';

function isMissingMessageError(error: unknown): boolean {
  return error instanceof I18nError && error.code === 'I18N_MISSING_MESSAGE';
}

function appendWithPrefix(keys: string[], keyPrefix: string | undefined, key: string): void {
  keys.push(keyPrefix === undefined ? key : `${keyPrefix}.${key}`);
}

function createValidationInterpolationValues(issue: ValidationIssue): I18nInterpolationValues {
  return {
    code: issue.code,
    field: issue.field,
    message: issue.message,
    source: issue.source,
  };
}

/**
 * Creates default translation key candidates for a validation issue.
 *
 * @remarks
 * Candidate order is most-specific to least-specific: `source.field.code`, `field.code`, `source.code`, then `code`.
 * The optional `keyPrefix` is prepended to each candidate. Field paths are preserved as authored by
 * `@fluojs/validation`, allowing catalogs to mirror dot/bracket validation paths explicitly.
 *
 * @param issue Validation issue to map into translation keys.
 * @param keyPrefix Optional catalog prefix prepended before generated keys.
 * @returns Ordered translation key candidates.
 */
export function createValidationIssueTranslationKeys(
  issue: ValidationIssue,
  keyPrefix?: I18nTranslationKey,
): readonly I18nTranslationKey[] {
  const keys: string[] = [];

  if (issue.source !== undefined && issue.field !== undefined) {
    appendWithPrefix(keys, keyPrefix, `${issue.source}.${issue.field}.${issue.code}`);
  }

  if (issue.field !== undefined) {
    appendWithPrefix(keys, keyPrefix, `${issue.field}.${issue.code}`);
  }

  if (issue.source !== undefined) {
    appendWithPrefix(keys, keyPrefix, `${issue.source}.${issue.code}`);
  }

  appendWithPrefix(keys, keyPrefix, issue.code);

  return Object.freeze(keys);
}

/**
 * Localizes one validation issue by resolving explicit translation key candidates.
 *
 * @param i18n I18n service used for catalog lookup.
 * @param issue Validation issue whose message should be localized.
 * @param options Explicit locale and optional key mapping controls.
 * @param index Zero-based index used only by custom key builders.
 * @returns A new validation issue with a localized message when a candidate resolves.
 * @throws {I18nError} When no translation resolves and `fallbackToIssueMessage` is `false`.
 */
export function localizeValidationIssue(
  i18n: I18nService,
  issue: ValidationIssue,
  options: LocalizeValidationIssuesOptions,
  index = 0,
): ValidationIssue {
  const namespace = options.namespace ?? DEFAULT_VALIDATION_NAMESPACE;
  const keys = options.keyBuilder?.({ index, issue }) ?? createValidationIssueTranslationKeys(issue, options.keyPrefix);
  const values = createValidationInterpolationValues(issue);

  for (const key of keys) {
    try {
      return {
        ...issue,
        message: i18n.translate(key, {
          locale: options.locale,
          namespace,
          values,
        }),
      };
    } catch (error) {
      if (isMissingMessageError(error)) {
        continue;
      }

      throw error;
    }
  }

  if (options.fallbackToIssueMessage === false) {
    throw new I18nError(`Missing validation i18n message for issue code: ${issue.code}`, 'I18N_MISSING_MESSAGE');
  }

  return { ...issue };
}

/**
 * Localizes validation issues without mutating the original issue objects.
 *
 * @param i18n I18n service used for catalog lookup.
 * @param issues Validation issues from `@fluojs/validation`.
 * @param options Explicit locale and optional key mapping controls.
 * @returns Localized validation issue snapshots.
 */
export function localizeValidationIssues(
  i18n: I18nService,
  issues: readonly ValidationIssue[],
  options: LocalizeValidationIssuesOptions,
): readonly ValidationIssue[] {
  return Object.freeze(issues.map((issue, index) => localizeValidationIssue(i18n, issue, options, index)));
}

/**
 * Creates a new `DtoValidationError` with localized issue messages.
 *
 * @param i18n I18n service used for catalog lookup.
 * @param error Validation error from `@fluojs/validation`.
 * @param options Explicit locale and optional key mapping controls.
 * @returns A new validation error that preserves the original top-level error message and localized issue snapshots.
 */
export function localizeDtoValidationError(
  i18n: I18nService,
  error: DtoValidationError,
  options: LocalizeValidationIssuesOptions,
): DtoValidationError {
  return new DtoValidationError(error.message, localizeValidationIssues(i18n, error.issues, options));
}
