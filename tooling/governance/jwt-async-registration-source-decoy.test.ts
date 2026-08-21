import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceJwtAsyncRegistrationSourceContract } from './jwt-async-registration-source-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configModulePath = 'packages/config/src/module.ts';
const jwtModulePath = 'packages/jwt/src/module.ts';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function withSource(relativePath: string, transform: (source: string) => string): (path: string) => string {
  return (path) => path === relativePath ? transform(read(path)) : read(path);
}

describe('JWT async registration source guard decoys', () => {
  it('accepts the current JwtRuntimeModule global shorthand metadata', () => {
    // Given
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(read);

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects ConfigModule metadata drift hidden behind a decoy metadata call', () => {
    // Given
    const readWithMetadataDecoy = withSource(configModulePath, (source) => source
      .replace('global: loadOptions.global ?? true,', 'global: false,')
      .replace(
        'defineModuleMetadata(ConfigModuleImpl, {',
        [
          'defineModuleMetadata(ConfigModule, {',
          '      exports: [ConfigService],',
          '      global: loadOptions.global ?? true,',
          '      providers,',
          '    });',
          '',
          '    defineModuleMetadata(ConfigModuleImpl, {',
        ].join('\n'),
      ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithMetadataDecoy);

    // Then
    expect(runGovernanceGuard).toThrow(/must export ConfigService globally by default/);
  });

  it('rejects FakeConfigService as a substring decoy in ConfigModule exports', () => {
    // Given
    const readWithFakeConfigService = withSource(configModulePath, (source) => source
      .replace('export class ConfigModule {', 'class FakeConfigService {}\n\nexport class ConfigModule {')
      .replace('exports: [ConfigService],', 'exports: [FakeConfigService],'));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithFakeConfigService);

    // Then
    expect(runGovernanceGuard).toThrow(/must export ConfigService globally by default/);
  });

  it.each([
    ['drops final metadata global', ''],
    ['hardcodes final metadata global', 'global: false,'],
  ] as const)('%s instead of propagating the createModule parameter', (_name, replacement) => {
    // Given
    const readWithBrokenFinalMetadata = withSource(jwtModulePath, (source) => source.replace(
      '      global,\n',
      replacement === '' ? '' : `      ${replacement}\n`,
    ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithBrokenFinalMetadata);

    // Then
    expect(runGovernanceGuard).toThrow(/must propagate the createModule global parameter to JwtRuntimeModule metadata/);
  });
});
