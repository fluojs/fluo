export type JwtAlgorithm = 'HS256' | 'HS384' | 'HS512';

export interface JwtKeyEntry {
  kid: string;
  secret: string;
}

export interface JwtVerifierOptions {
  algorithms: JwtAlgorithm[];
  accessTokenTtlSeconds?: number;
  audience?: string | string[];
  clockSkewSeconds?: number;
  issuer?: string;
  keys?: JwtKeyEntry[];
  secret?: string;
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
