import { createHmac, createSign } from 'node:crypto';

import { Inject } from '@konekti/core';

import { JwtConfigurationError } from './errors.js';
import type { JwtAlgorithm, JwtClaims, JwtVerifierOptions } from './types.js';
import { ASYMMETRIC_HASH, HMAC_HASH, JWT_OPTIONS } from './verifier.js';

function encodeBase64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

@Inject([JWT_OPTIONS])
export class DefaultJwtSigner {
  constructor(private readonly options: JwtVerifierOptions) {}

  async signAccessToken(claims: JwtClaims): Promise<string> {
    return this.signToken(claims, this.options, false);
  }

  async signRefreshToken(claims: JwtClaims): Promise<string> {
    const refreshOptions = this.resolveRefreshSigningOptions();
    return this.signToken(claims, refreshOptions, true);
  }

  private resolveRefreshSigningOptions(): JwtVerifierOptions {
    const refreshToken = this.options.refreshToken;

    if (!refreshToken) {
      throw new JwtConfigurationError('JWT refresh token options are not configured.');
    }

    return {
      ...this.options,
      accessTokenTtlSeconds: refreshToken.expiresInSeconds,
      algorithms: this.options.algorithms.filter((algorithm) => algorithm in HMAC_HASH),
      keys: undefined,
      privateKey: undefined,
      secret: refreshToken.secret,
    };
  }

  private async signToken(claims: JwtClaims, options: JwtVerifierOptions, hmacOnly: boolean): Promise<string> {
    const algorithm: JwtAlgorithm | undefined = options.algorithms.find((alg) => {
      if (hmacOnly) {
        return alg in HMAC_HASH;
      }

      return alg in HMAC_HASH || alg in ASYMMETRIC_HASH;
    });

    if (!algorithm) {
      if (hmacOnly) {
        throw new JwtConfigurationError(
          'JWT refresh token signer requires at least one HMAC algorithm (HS256/HS384/HS512) in the allowed algorithms list.',
        );
      }

      throw new JwtConfigurationError(
        'JWT signer requires at least one supported algorithm (HS256/HS384/HS512/RS256/RS384/RS512/ES256/ES384/ES512) in the allowed algorithms list.',
      );
    }

    const isAsymmetric = algorithm in ASYMMETRIC_HASH;

    const now = Math.floor(Date.now() / 1000);
    const ttl = options.accessTokenTtlSeconds ?? 3600;
    const payload: JwtClaims = {
      ...claims,
      aud: claims.aud ?? options.audience,
      exp: claims.exp ?? now + ttl,
      iat: claims.iat ?? now,
      iss: claims.iss ?? options.issuer,
    };

    const activeKey = options.keys?.[0];
    const header: Record<string, string> = {
      alg: algorithm,
      typ: 'JWT',
      ...(activeKey ? { kid: activeKey.kid } : {}),
    };
    const headerSegment = encodeBase64Url(JSON.stringify(header));
    const payloadSegment = encodeBase64Url(JSON.stringify(payload));
    const signingInput = `${headerSegment}.${payloadSegment}`;

    let signatureSegment: string;

    if (isAsymmetric) {
      const privateKey = activeKey?.privateKey ?? options.privateKey;

      if (!privateKey) {
        throw new JwtConfigurationError('JWT private key is not configured.');
      }

      const hash = ASYMMETRIC_HASH[algorithm];

      if (!hash) {
        throw new JwtConfigurationError(`No hash mapping for asymmetric algorithm "${algorithm}".`);
      }

      const signer = createSign(hash);
      signer.update(signingInput);
      const isEc = algorithm.startsWith('ES');
      signatureSegment = isEc
        ? signer.sign({ dsaEncoding: 'ieee-p1363', key: privateKey } as Parameters<typeof signer.sign>[0], 'base64url')
        : signer.sign(privateKey, 'base64url');
    } else {
      const secret = activeKey?.secret ?? options.secret;

      if (!secret) {
        throw new JwtConfigurationError('JWT secret is not configured.');
      }

      const hash = HMAC_HASH[algorithm];

      if (!hash) {
        throw new JwtConfigurationError(`No hash mapping for HMAC algorithm "${algorithm}".`);
      }

      signatureSegment = encodeBase64Url(createHmac(hash, secret).update(signingInput).digest());
    }

    return `${headerSegment}.${payloadSegment}.${signatureSegment}`;
  }
}
