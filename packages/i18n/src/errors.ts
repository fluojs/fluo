import { FluoError, isFluoError, setFluoErrorContract } from '@fluojs/core';

import type { I18nErrorCode } from './types.js';

/**
 * Base error type for caller-visible i18n package failures.
 */
export class I18nError extends FluoError {
  /** Stable i18n error code. */
  declare readonly code: I18nErrorCode;

  /**
   * Creates an i18n package error with a stable code.
   *
   * @param message Human-readable error message.
   * @param code Stable error code for programmatic handling.
   */
  constructor(message: string, code: I18nErrorCode = 'I18N_ERROR') {
    super(message, { code });
    setFluoErrorContract(this, '@fluojs/i18n');
  }
}

/**
 * Recognizes compatible i18n errors across duplicate package copies.
 * @param value Candidate thrown value.
 * @returns Whether the value satisfies the i18n error contract.
 */
export function isI18nError(value: unknown): value is I18nError {
  return isFluoError(value, '@fluojs/i18n') && value.code.startsWith('I18N_');
}
