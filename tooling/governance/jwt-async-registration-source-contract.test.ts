import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceJwtAsyncRegistrationSourceContract } from './jwt-async-registration-source-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const jwtModulePath = 'packages/jwt/src/module.ts';

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function withJwtModule(transform: (source: string) => string): (relativePath: string) => string {
  return (relativePath) => relativePath === jwtModulePath ? transform(read(relativePath)) : read(relativePath);
}

describe('JWT async registration source contract', () => {
  it('rejects an unread field accepted through the top-level intersection', () => {
    // Given
    const readWithImports = withJwtModule((source) => source.replace(
      '{ global?: boolean }',
      '{ global?: boolean; imports?: Constructor[] }',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithImports);

    // Then
    expect(runGovernanceGuard).toThrow(/exactly global, inject, and useFactory/);
  });

  it('rejects an unread field inherited by the accepted options type', () => {
    // Given
    const readWithUseExisting = withJwtModule((source) => source
      .replace(
        'export class JwtModule {',
        [
          'type JwtAsyncOptionsBase = AsyncModuleOptions<JwtVerifierOptions> & { global?: boolean };',
          'interface JwtAsyncOptions extends JwtAsyncOptionsBase { useExisting?: Token; }',
          '',
          'export class JwtModule {',
        ].join('\n'),
      )
      .replace(
        'options: AsyncModuleOptions<JwtVerifierOptions> & { global?: boolean }',
        'options: JwtAsyncOptions & AsyncModuleOptions<JwtVerifierOptions>',
      ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithUseExisting);

    // Then
    expect(runGovernanceGuard).toThrow(/exactly global, inject, and useFactory/);
  });

  it('requires global to remain an optional top-level boolean', () => {
    // Given
    const readWithRequiredGlobal = withJwtModule((source) => source.replace(
      '{ global?: boolean }',
      '{ global: boolean }',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithRequiredGlobal);

    // Then
    expect(runGovernanceGuard).toThrow(/global must remain an optional top-level boolean/);
  });

  it('rejects an extra provider field even when the module never reads a new option', () => {
    // Given
    const readWithProviderImports = withJwtModule((source) => source.replace(
      'inject: options.inject,',
      'imports: options.inject,\n      inject: options.inject,',
    ));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithProviderImports);

    // Then
    expect(runGovernanceGuard).toThrow(/options provider must contain exactly inject, provide, scope, and useFactory/);
  });

  it('requires global visibility to flow through the createModule global argument', () => {
    // Given
    const readWithGlobalDecoy = withJwtModule((source) => source
      .replace('return this.createModule({', 'void options.global;\n    return this.createModule({')
      .replace("}, true, true, 'transient', true, options.global ?? false);", "}, true, true, 'transient', true, false);"));

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationSourceContract(readWithGlobalDecoy);

    // Then
    expect(runGovernanceGuard).toThrow(/must forward top-level global to module visibility/);
  });
});
