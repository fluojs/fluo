import type { FrameworkRequest } from '../types.js';
import { getCompatibleHttpSharedState } from '../shared-state.js';

const ABSENT_REQUEST_IDS = Symbol.for('fluo.http.absent-request-ids');
const absentRequestIds = getCompatibleHttpSharedState(
  ABSENT_REQUEST_IDS,
  () => new WeakSet<FrameworkRequest>(),
);

/**
 * Records that the adapter snapshot contains neither supported inbound ID header.
 *
 * @param request Adapter request whose effective header snapshot has no inbound ID.
 */
export function markAbsentRequestId(request: FrameworkRequest): void {
  absentRequestIds.add(request);
}

/**
 * Checks an adapter's known-absent ID without materializing its headers.
 *
 * @param request Adapter request being used for initial context creation.
 * @returns Whether the adapter has established that no inbound ID is present.
 */
export function hasAbsentRequestId(request: FrameworkRequest): boolean {
  return absentRequestIds.has(request);
}
