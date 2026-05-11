import { FormatError, IntlMessageFormat } from 'intl-messageformat';
import type { Formats } from 'intl-messageformat';

import { I18nError } from './errors.js';
import { I18nService, createI18n } from './service.js';
import type { I18nInterpolationValues, I18nModuleOptions, I18nTranslateOptions } from './types.js';

/**
 * Primitive values accepted by the ICU MessageFormat subpath.
 */
export type I18nIcuValue = string | number | bigint | boolean | null | undefined | Date;

/**
 * Named values available to ICU MessageFormat placeholders.
 */
export type I18nIcuValues = Readonly<Record<string, I18nIcuValue>>;

/**
 * Per-call options for ICU MessageFormat translation.
 */
export interface I18nIcuTranslateOptions extends Omit<I18nTranslateOptions, 'values'> {
  /** Values passed to ICU MessageFormat placeholders after core catalog and fallback resolution. */
  readonly values?: I18nIcuValues;
  /** Optional per-call Intl MessageFormat named format overrides. */
  readonly formats?: Partial<Formats>;
}

function isCoreInterpolationValue(value: I18nIcuValue): value is I18nInterpolationValues[string] {
  return value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value);
}

function toCoreInterpolationValues(values: I18nIcuValues | undefined): I18nInterpolationValues | undefined {
  if (values === undefined) {
    return undefined;
  }

  const interpolationValues: Record<string, I18nInterpolationValues[string]> = {};
  let hasInterpolationValue = false;

  for (const [key, value] of Object.entries(values)) {
    if (isCoreInterpolationValue(value)) {
      interpolationValues[key] = value;
      hasInterpolationValue = true;
    }
  }

  return hasInterpolationValue ? interpolationValues : undefined;
}

function toMessageFormatValues(values: I18nIcuValues | undefined): Record<string, I18nIcuValue> | undefined {
  if (values === undefined) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(values));
}

function normalizeMessageFormatError(error: unknown, key: string): I18nError {
  if (error instanceof FormatError || error instanceof SyntaxError || error instanceof Error) {
    return new I18nError(`Invalid ICU MessageFormat for i18n key: ${key}`, 'I18N_INVALID_MESSAGE_FORMAT');
  }

  return new I18nError(`Invalid ICU MessageFormat for i18n key: ${key}`, 'I18N_INVALID_MESSAGE_FORMAT');
}

/**
 * ICU MessageFormat translation service layered on top of the framework-agnostic core `I18nService`.
 *
 * @remarks
 * The root service keeps its simple `{{ name }}` interpolation and fallback behavior. This subpath resolves the
 * message through that service first, then formats the resolved message with ICU MessageFormat plural/select rules.
 */
export class IcuI18nService {
  private readonly service: I18nService;

  /**
   * Creates an ICU MessageFormat service from root options or an existing core service.
   *
   * @param options Root i18n options or an existing `I18nService` instance.
   */
  constructor(options: I18nModuleOptions | I18nService = {}) {
    this.service = options instanceof I18nService ? options : createI18n(options);
  }

  /**
   * Returns the underlying core i18n service used for catalog lookup and fallback resolution.
   *
   * @returns The core `I18nService` instance backing this ICU formatter.
   */
  getCoreService(): I18nService {
    return this.service;
  }

  /**
   * Resolves a message with the core service and formats it with ICU MessageFormat.
   *
   * @param key Dot-path catalog key, optionally prefixed by `options.namespace`.
   * @param options Per-call locale, ICU values, default value, and optional named format overrides.
   * @returns The resolved and ICU-formatted message.
   * @throws {I18nError} When the core lookup fails or the ICU pattern/values are invalid.
   */
  translate(key: string, options: I18nIcuTranslateOptions): string {
    const message = this.service.translate(key, {
      defaultValue: options.defaultValue,
      locale: options.locale,
      namespace: options.namespace,
      values: toCoreInterpolationValues(options.values),
    });

    try {
      const formatter = new IntlMessageFormat(message, options.locale, options.formats);
      const formatted = formatter.format(toMessageFormatValues(options.values));

      if (typeof formatted === 'string') {
        return formatted;
      }
    } catch (error) {
      throw normalizeMessageFormatError(error, key);
    }

    throw new I18nError(`Invalid ICU MessageFormat result for i18n key: ${key}`, 'I18N_INVALID_MESSAGE_FORMAT');
  }
}

/**
 * Creates a standalone ICU MessageFormat i18n service.
 *
 * @param options Root i18n options or an existing `I18nService` instance.
 * @returns An `IcuI18nService` that preserves core lookup semantics before ICU formatting.
 */
export function createIcuI18n(options: I18nModuleOptions | I18nService = {}): IcuI18nService {
  return new IcuI18nService(options);
}
