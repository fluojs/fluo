import { createPublicKey, type KeyObject } from 'node:crypto';

import { JwtConfigurationError, JwtInvalidTokenError } from '../errors.js';

interface Jwk {
  kid?: string;
  [key: string]: unknown;
}

interface JwksResponse {
  keys?: Jwk[];
}

const DEFAULT_JWKS_CACHE_MAX_ENTRIES = 100;

function assertNonNegativeFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new JwtConfigurationError(`${label} must be a non-negative finite number.`);
  }
}

function assertPositiveFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new JwtConfigurationError(`${label} must be a positive finite number.`);
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new JwtConfigurationError(`${label} must be a positive integer.`);
  }
}

/**
 * Represents the jwks client.
 */
export class JwksClient {
  private readonly cache = new Map<string, { expiresAt: number; key: KeyObject }>();

  constructor(
    private readonly uri: string,
    private readonly cacheTtl: number = 600_000,
    private readonly requestTimeoutMs: number = 5_000,
    private readonly cacheMaxEntries: number = DEFAULT_JWKS_CACHE_MAX_ENTRIES,
  ) {
    assertNonNegativeFiniteNumber(cacheTtl, 'JWKS cache ttl');
    assertPositiveFiniteNumber(requestTimeoutMs, 'JWKS request timeout');
    assertPositiveInteger(cacheMaxEntries, 'JWKS cache max entries');
  }

  /**
   * Clears all cached JWKS key material held by this client.
   *
   * Call this during application shutdown when the verifier/client lifecycle is
   * owned manually, or when rotating identity-provider configuration.
   */
  dispose(): void {
    this.cache.clear();
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError';
  }

  async getSigningKey(kid: string): Promise<KeyObject> {
    const now = Date.now();
    this.pruneExpiredCacheEntries(now);

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

    if (this.cacheTtl > 0) {
      this.cache.set(kid, {
        expiresAt: now + this.cacheTtl,
        key,
      });
      this.evictOldestCacheEntries();
    }

    return key;
  }

  private pruneExpiredCacheEntries(now: number): void {
    for (const [kid, cached] of this.cache) {
      if (cached.expiresAt <= now) {
        this.cache.delete(kid);
      }
    }
  }

  private evictOldestCacheEntries(): void {
    while (this.cache.size > this.cacheMaxEntries) {
      const oldestKid = this.cache.keys().next().value as string | undefined;

      if (oldestKid === undefined) {
        return;
      }

      this.cache.delete(oldestKid);
    }
  }

  private async fetchKeys(): Promise<Jwk[]> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);
    timeout.unref?.();

    try {
      response = await fetch(this.uri, { signal: controller.signal });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new JwtConfigurationError(`JWKS fetch timed out after ${String(this.requestTimeoutMs)}ms.`);
      }

      throw new JwtConfigurationError(`Failed to fetch JWKS from "${this.uri}".`);
    } finally {
      clearTimeout(timeout);
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
