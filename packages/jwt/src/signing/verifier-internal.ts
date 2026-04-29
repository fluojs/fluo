import type { JwtPrincipal, JwtVerifierOptions } from '../types.js';

import { DefaultJwtVerifier } from './verifier.js';

type AccessTokenVerificationOverrides = Pick<
  JwtVerifierOptions,
  'algorithms' | 'audience' | 'clockSkewSeconds' | 'issuer' | 'maxAge' | 'requireExp'
>;

/**
 * Applies supported per-call access-token overrides through the verifier's public API.
 *
 * @param verifier Configured verifier whose shared key-resolution state should be reused.
 * @param token Compact JWT string to verify.
 * @param overrides Per-call algorithm and claim-policy overrides.
 * @returns The normalized principal for the verified access token.
 */
export function verifyAccessTokenWithOverrides(
  verifier: DefaultJwtVerifier,
  token: string,
  overrides: Partial<AccessTokenVerificationOverrides>,
): Promise<JwtPrincipal> {
  return verifier.verifyAccessTokenWithOverrides(token, overrides);
}
