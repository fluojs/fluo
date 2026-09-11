import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforcePassportCookiePresetContract } from './passport-cookie-preset-contract.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const cookieAuthModulePath = 'packages/passport/src/cookie/cookie-auth-module.ts';
const platformGovernancePath = 'tooling/governance/verify-platform-consistency-governance.mjs';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('Passport cookie preset contract', () => {
  it('accepts the executable single-registry recipe', () => {
    // Given
    const runGovernanceGuard = () => enforcePassportCookiePresetContract();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects source drift that removes composed additional strategies', () => {
    // Given
    const readWithMissingComposition = (relativePath: string): string =>
      relativePath === cookieAuthModulePath
        ? read(relativePath).replace('            ...additionalStrategies,\n', '')
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePassportCookiePresetContract(readWithMissingComposition);

    // Then
    expect(runGovernanceGuard).toThrowError(/additionalStrategies/u);
  });

  it('rejects source drift that removes passport option forwarding', () => {
    // Given
    const readWithMissingOptionForwarding = (relativePath: string): string =>
      relativePath === cookieAuthModulePath
        ? read(relativePath).replace('            ...passportOptions,\n', '')
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePassportCookiePresetContract(readWithMissingOptionForwarding);

    // Then
    expect(runGovernanceGuard).toThrowError(/passportOptions/u);
  });

  it.each([
    [
      'missing',
      (source: string): string =>
        source.replace('PassportModule.forRoot', 'RemovedPassportModule.forRoot'),
      /exactly one PassportModule\.forRoot.*found 0/u,
    ],
    [
      'detached',
      (source: string): string => {
        const registrationStart = source.indexOf('        PassportModule.forRoot(\n');
        const registrationEnd = source.indexOf('        ),\n      ],\n      providers:', registrationStart)
          + '        ),\n'.length;
        const registration = source.slice(registrationStart, registrationEnd).trim();
        const withoutRegistration = source.slice(0, registrationStart) + source.slice(registrationEnd);

        return withoutRegistration.replace(
          '    return defineModule(CookieAuthRuntimeModule, {',
          `    const detachedRegistration = ${registration};\n\n    return defineModule(CookieAuthRuntimeModule, {`,
        );
      },
      /exactly one PassportModule\.forRoot.*found 0/u,
    ],
    [
      'duplicate',
      (source: string): string => {
        const registrationStart = source.indexOf('        PassportModule.forRoot(\n');
        const registrationEnd = source.indexOf('        ),\n      ],\n      providers:', registrationStart)
          + '        ),\n'.length;
        const registration = source.slice(registrationStart, registrationEnd).trim();

        return source.slice(0, registrationEnd)
          + `        ${registration}\n`
          + source.slice(registrationEnd);
      },
      /exactly one PassportModule\.forRoot.*found 2/u,
    ],
  ])('rejects a %s Passport registry outside the returned module imports', (_name, mutate, error) => {
    // Given
    const readWithInvalidRegistry = (relativePath: string): string =>
      relativePath === cookieAuthModulePath
        ? mutate(read(relativePath))
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePassportCookiePresetContract(readWithInvalidRegistry);

    // Then
    expect(runGovernanceGuard).toThrowError(error);
  });

  it.each([
    ['deletion', ''],
    ['dead branch', 'if (false) { enforcePassportCookiePresetContract(); }'],
    ['duplicate', 'enforcePassportCookiePresetContract();\n  enforcePassportCookiePresetContract();'],
  ])('rejects %s of the direct central passport cookie preset guard invocation', (_name, replacement) => {
    // Given
    const readWithInactiveMainRegistration = (relativePath: string): string =>
      relativePath === platformGovernancePath
        ? read(relativePath).replace(
          '  enforcePassportCookiePresetContract();',
          replacement ? `  ${replacement}` : replacement,
        )
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePassportCookiePresetContract(readWithInactiveMainRegistration);

    // Then
    expect(runGovernanceGuard).toThrowError(/main must invoke enforcePassportCookiePresetContract exactly once/u);
  });

  it('proves the additional-strategy comparison is required', async () => {
    // Given
    const sourceUrl = new URL('./passport-cookie-preset-contract.mjs', import.meta.url);
    const source = readFileSync(sourceUrl, 'utf8');
    const target = '!hasCookieRegistration(strategies) || !hasAdditionalStrategiesSpread(strategies, additionalStrategiesParameter)';
    const mutated = source
      .replace(target, 'false')
      .replace("import ts from 'typescript';", `import ts from '${import.meta.resolve('typescript')}';`)
      .replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
    const readWithMissingComposition = (relativePath: string): string =>
      relativePath === cookieAuthModulePath
        ? read(relativePath).replace('            ...additionalStrategies,\n', '')
        : read(relativePath);

    expect(mutated).not.toBe(source);
    const governance: Pick<typeof import('./passport-cookie-preset-contract.mjs'), 'enforcePassportCookiePresetContract'> =
      await import(`data:text/javascript;base64,${Buffer.from(mutated).toString('base64')}`);
    const runMutatedGuard = () => governance.enforcePassportCookiePresetContract(readWithMissingComposition);

    // When / Then
    expect(runMutatedGuard).not.toThrow();
    expect(() => expect(runMutatedGuard).toThrow()).toThrowError(
      expect.objectContaining({ name: 'AssertionError' }),
    );
  });
});
