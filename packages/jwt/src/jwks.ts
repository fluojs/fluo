import { createPublicKey, type KeyObject } from 'node:crypto';

import { JwtConfigurationError, JwtInvalidTokenError } from './errors.js';

interface Jwk {
  kid?: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys?: Jwk[];
}

export class JwksClient {
  private readonly cache = new Map<string, { expiresAt: number; key: KeyObject }>();

  constructor(
    private readonly uri: string,
    private readonly cacheTtl: number = 600_000,
  ) {}

  async getSigningKey(kid: string): Promise<KeyObject> {
    const now = Date.now();
    const cached = this.cache.get(kid);

    if (cached && cached.expiresAt > now) {
      return cached.key;
    }

    const keys = await this.fetchKeys();
    const jwk = keys.find((entry) => entry.kid === kid);

    if (!jwk) {
      throw new JwtInvalidTokenError('JWT key id was not found in JWKS.');
    }

    let key: KeyObject;

    try {
      key = createPublicKey({ format: 'jwk', key: jwk });
    } catch {
      throw new JwtConfigurationError('Unable to parse JWKS key into a public key.');
    }

    this.cache.set(kid, {
      expiresAt: now + this.cacheTtl,
      key,
    });

    return key;
  }

  private async fetchKeys(): Promise<Jwk[]> {
    let response: Response;

    try {
      response = await fetch(this.uri);
    } catch {
      throw new JwtConfigurationError(`Failed to fetch JWKS from "${this.uri}".`);
    }

    if (!response.ok) {
      throw new JwtConfigurationError(`JWKS endpoint returned HTTP ${response.status}.`);
    }

    let body: JwksResponse;

    try {
      body = (await response.json()) as JwksResponse;
    } catch {
      throw new JwtConfigurationError('JWKS endpoint did not return valid JSON.');
    }

    if (!Array.isArray(body.keys)) {
      throw new JwtConfigurationError('JWKS endpoint did not return a keys array.');
    }

    return body.keys;
  }
}
