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

  it('rejects JwtService.verify returning claims instead of the normalized principal', () => {
    // Given
    const readWithClaimsReturn = withSource(serviceSourcePath, (source) => source.replace(
      'return this.verifier.verifyAccessToken(token, options);',
      'return principal.claims;',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithClaimsReturn);

    // Then
    expect(runGovernanceGuard).toThrow(/must return the normalized JwtPrincipal/);
  });

  it('rejects JwtService.verify dropping the optional policy path', () => {
    // Given
    const readWithoutOverrides = withSource(serviceSourcePath, (source) => source.replace(
      'return this.verifier.verifyAccessToken(token, options);',
      'return this.verifier.verifyAccessToken(token);',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithoutOverrides);

    // Then
    expect(runGovernanceGuard).toThrow(/must return the normalized JwtPrincipal/);
  });

  it.each([
    'algorithms',
    'audience',
    'clockSkewSeconds',
    'issuer',
    'maxAge',
    'requireExp',
  ])('rejects a verifier that discards the per-call %s policy', (option) => {
    // Given
    const readWithoutOverride = withSource(verifierSourcePath, (source) => {
      const policyAccess = `policy?.${option}`;
      expect(source).toContain(policyAccess);
      return source.replaceAll(policyAccess, 'undefined');
    });

    // When
    const runGovernanceGuard = () => enforceJwtVerifiedClaimsContract(readWithoutOverride);

    // Then
    expect(runGovernanceGuard).toThrow(`must preserve the per-call ${option} policy`);
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
