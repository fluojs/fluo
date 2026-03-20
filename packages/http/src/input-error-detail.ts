import type { MetadataSource } from '@konekti/core';

import type { HttpExceptionDetail } from './exceptions.js';

export interface InputErrorDetail {
  code: string;
  field?: string;
  message: string;
  source?: MetadataSource;
}

export function toInputErrorDetail(detail: InputErrorDetail): HttpExceptionDetail {
  return {
    code: detail.code,
    field: detail.field,
    message: detail.message,
    source: detail.source,
  };
}
