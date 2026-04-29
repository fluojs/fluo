import type { MetadataSource } from '@fluojs/core';

import type { HttpExceptionDetail } from './exceptions.js';

/**
 * Describes the input error detail contract.
 */
export interface InputErrorDetail {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

/**
 * To input error detail.
 *
 * @param detail The detail.
 * @returns The to input error detail result.
 */
export function toInputErrorDetail(detail: InputErrorDetail): HttpExceptionDetail {
  return {
    code: detail.code,
    field: detail.field,
    message: detail.message,
    source: detail.source,
  };
}
