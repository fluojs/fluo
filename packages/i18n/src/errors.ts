import { FluoError } from '@fluojs/core';

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
  }
}
