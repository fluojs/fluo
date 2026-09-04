import type { JwtAlgorithm } from '../types.js';

export const SUPPORTED_HMAC_HASH: Readonly<Partial<Record<JwtAlgorithm, string>>> = Object.freeze({
  HS256: 'sha256',
  HS384: 'sha384',
  HS512: 'sha512',
});

export const SUPPORTED_ASYMMETRIC_HASH: Readonly<Partial<Record<JwtAlgorithm, string>>> = Object.freeze({
  RS256: 'sha256',
  RS384: 'sha384',
  RS512: 'sha512',
  ES256: 'sha256',
  ES384: 'sha384',
  ES512: 'sha512',
});
