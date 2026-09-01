import type { FrameworkResponse, HandlerDescriptor } from '../types.js';

/**
 * Applies route-declared headers without setting success response metadata.
 *
 * @param handler Matched route descriptor that declares response headers.
 * @param response Mutable adapter-normalized response.
 * @returns Nothing.
 */
export function applyRouteHeaders(handler: HandlerDescriptor, response: FrameworkResponse): void {
  for (const header of handler.route.headers ?? []) {
    response.setHeader(header.name, header.value);
  }
}
