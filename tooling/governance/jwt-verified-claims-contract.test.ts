import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceJwtVerifiedClaimsContract } from './jwt-verified-claims-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const serviceSourcePath = 'packages/jwt/src/service.ts';
const verifierSourcePath = 'packages/jwt/src/signing/verifier.ts';
const signerSourcePath = 'packages/jwt/src/signing/signer.ts';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function withSource(relativePath: string, transform: (source: string) => string): (path: string) => string {
  return (path) => path === relativePath ? transform(read(path)) : read(path);
}

describe('JWT verified claims contract', () => {
  it('accepts the shipped sources that back the governed documentation claims', () => {
    // Given
    const readRepository = (relativePath: string) => read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readRepository);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects JwtService.verify resolving a normalized principal instead of the claim bag', () => {
    // Given
    const readWithPrincipalReturn = withSource(serviceSourcePath, (source) => source.replace(
      'return principal.claims as T;',
      'return principal as T;',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithPrincipalReturn);

    // Then
    expect(runGovernanceGuard).toThrow(/must resolve the verified claim bag/);
  });

  it('rejects JwtService.verify dropping the per-call verifier override path', () => {
    // Given
    const readWithoutOverrides = withSource(serviceSourcePath, (source) => source.replace(
      'await this.verifier.verifyAccessTokenWithOverrides(token, options)',
      'await this.verifier.verifyAccessToken(token)',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithoutOverrides);

    // Then
    expect(runGovernanceGuard).toThrow(/must route per-call options through verifyAccessTokenWithOverrides/);
  });

  it('rejects a verifier that discards a documented per-call override', () => {
    // Given
    const readWithoutAudienceOverride = withSource(verifierSourcePath, (source) => source.replace(
      'audience: overrides.audience ?? this.options.audience,',
      'audience: this.options.audience,',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithoutAudienceOverride);

    // Then
    expect(runGovernanceGuard).toThrow(/must preserve the per-call audience override/);
  });

  it('rejects a signer that fills iat from a module option instead of the signing timestamp', () => {
    // Given
    const readWithModuleIat = withSource(signerSourcePath, (source) => source.replace(
      'iat: claims.iat ?? now,',
      'iat: claims.iat ?? options.issuedAt,',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithModuleIat);

    // Then
    expect(runGovernanceGuard).toThrow(/must fill iat from the current signing timestamp/);
  });
});
