import type { FrameworkRequest } from './types.js';
import { type TrustProxyPolicy, resolveHttpConnection } from './connection.js';

interface ClientIdentityResolutionOptions {
  trustProxy?: TrustProxyPolicy;
  trustProxyHeaders?: boolean;
}

/**
 * Resolve one stable client identity from the normalized request contract.
 *
 * By default, resolution uses only the raw socket's `remoteAddress`. When
 * `trustProxyHeaders` enables the broad legacy compatibility path: it accepts
 * the complete forwarding chain from `Forwarded`, `X-Forwarded-For`, or
 * `X-Real-IP` without a deployment-specific peer boundary. Prefer
 * `trustProxy` for new deployments. If no trusted identity is available,
 * callers must provide an explicit resolver because falling back to a shared
 * `unknown` bucket is not safe in proxied or serverless environments.
 *
 * @param request Adapter-normalized request whose headers/raw transport state should be inspected.
 * @param options Client-identity trust settings for proxy-header handling.
 * @returns A stable client identity string suitable for rate limiting.
 * @throws Error When the request exposes no trusted proxy header or socket identity.
 */
export function resolveClientIdentity(
  request: FrameworkRequest,
  options: ClientIdentityResolutionOptions = {},
): string {
  const clientIdentity = resolveHttpConnection(request, {
    allowForwardedWithoutPeer: options.trustProxyHeaders === true,
    trustProxy: options.trustProxy ?? (options.trustProxyHeaders ? Number.MAX_SAFE_INTEGER : false),
  }).clientAddress;

  if (clientIdentity) {
    return clientIdentity;
  }

  throw new Error(
    'Unable to resolve client identity from the trusted request transport. Configure resolveHttpConnection(...) with an explicit trust policy, or provide an explicit keyResolver/keyGenerator for this environment.',
  );
}
