import type { KeyObject } from 'node:crypto';

import type { RefreshTokenOptions } from './refresh-token.js';

export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512' | 'RS256' | 'RS384' | 'RS512' | 'ES256' | 'ES384' | 'ES512';

export interface JwtKeyEntry {
  kid: string;
  secret?: string;
  privateKey?: string | KeyObject;
  publicKey?: string | KeyObject;
}

export interface JwtVerifierOptions {
  algorithms: JwtAlgorithm[];
  accessTokenTtlSeconds?: number;
  audience?: string | string[];
  clockSkewSeconds?: number;
  issuer?: string;
  jwksCacheTtl?: number;
  jwksUri?: string;
  keys?: JwtKeyEntry[];
  maxAge?: number;
  requireExp?: boolean;
  secretOrKeyProvider?: (header: { alg: string; kid?: string; [key: string]: unknown }) => Promise<string | KeyObject>;
  secret?: string;
  privateKey?: string | KeyObject;
  publicKey?: string | KeyObject;
  refreshToken?: RefreshTokenOptions;
}

export interface JwtClaims extends Record<string, unknown> {
  aud?: string | string[];
  exp?: number;
  iat?: number;
  iss?: string;
  nbf?: number;
  scope?: string;
  scopes?: string[];
  sub?: string;
}

export interface JwtPrincipal {
  subject: string;
  issuer?: string;
  audience?: string | string[];
  roles?: string[];
  scopes?: string[];
  claims: Record<string, unknown>;
}

export interface JwtVerifier {
  verifyAccessToken(token: string): Promise<JwtPrincipal>;
}

export interface JwtSigner {
  signAccessToken(claims: JwtClaims): Promise<string>;
}
