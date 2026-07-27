import type { FrameworkRequest } from '../types.js';

export function isRequestAborted(request: FrameworkRequest): boolean {
  return request.isAborted?.() === true || request.signal?.aborted === true;
}
