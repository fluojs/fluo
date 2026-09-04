import { JwtInvalidTokenError } from '../errors.js';
import type { DefaultJwtVerifier } from '../signing/verifier.js';
import type { JwtClaims } from '../types.js';

/**
 * Describes the claims required for a verified refresh token.
 */
export interface RefreshTokenClaims extends JwtClaims {
  family: string;
  jti: string;
  type: 'refresh';
}

/**
 * Verifies a compact refresh token and returns its required claims.
 *
 * @param verifier Configured verifier for the refresh-token policy.
 * @param token Compact refresh token to verify.
 * @returns Verified refresh-token claims with non-empty required identifiers.
 * @throws {JwtInvalidTokenError} When the token is not a refresh token or lacks required claims.
 */
export async function verifyRefreshTokenClaims(
  verifier: DefaultJwtVerifier,
  token: string,
): Promise<RefreshTokenClaims & { sub: string }> {
  const principal = await verifier.verifyRefreshToken(token);
  const claims = principal.claims;

  if (claims.type !== 'refresh') {
    throw new JwtInvalidTokenError('JWT is not a refresh token.');
  }

  if (typeof claims.jti !== 'string' || claims.jti.length === 0) {
    throw new JwtInvalidTokenError('Refresh token is missing jti.');
  }

  if (typeof claims.family !== 'string' || claims.family.length === 0) {
    throw new JwtInvalidTokenError('Refresh token is missing family.');
  }

  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new JwtInvalidTokenError('Refresh token is missing sub.');
  }

  return {
    ...claims,
    family: claims.family,
    jti: claims.jti,
    sub: claims.sub,
    type: 'refresh',
  };
}
