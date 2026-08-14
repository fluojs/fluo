import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforcePassportJsBridgeNestjsMigration } from './passport-js-bridge-nestjs-migration.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('Passport.js bridge source governance', () => {
  it.each([
    ['provide: optionsToken,', "provide: Symbol.for('decoy.options'),", 'optionsToken'],
    ['provide: adapterToken,', "provide: Symbol.for('decoy.adapter'),", 'adapterToken'],
    ['useValue: { ...options },', 'useValue: undefined,', 'optionsToken'],
    ['inject: [strategyToken, optionsToken],', 'inject: [strategyToken],', 'optionsToken'],
  ] as const)(
    'requires the source bridge provider for %s',
    (implementedProvider, regressedProvider, expectedToken) => {
      // Given
      const targetPath = 'packages/passport/src/adapters/passport-js.ts';
      const readWithoutRequiredProvider = (relativePath: string): string => {
        const content = read(relativePath);
        return relativePath === targetPath
          ? `${content.replace(implementedProvider, regressedProvider)}\nconst decoy = "${implementedProvider}";\n`
          : content;
      };

      // When
      const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithoutRequiredProvider);

      // Then
      expect(runGovernanceGuard).toThrowError(new RegExp(expectedToken, 'u'));
    },
  );

  it('rejects a registry assignment implemented only inside an uncalled decoy', () => {
    // Given
    const targetPath = 'packages/passport/src/module.ts';
    const readWithExecutableDecoy = (relativePath: string): string => {
      const content = read(relativePath);
      if (relativePath !== targetPath) {
        return content;
      }

      return `${content.replace(
        'registry[strategy.name] = strategy.token;',
        'registry[strategy.name] = strategies[0]?.token;',
      )}\nfunction decoy() {\n  const registry = Object.create(null);\n  const strategy = { name: 'decoy', token: Symbol('decoy') };\n  registry[strategy.name] = strategy.token;\n}\n`;
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithExecutableDecoy);

    // Then
    expect(runGovernanceGuard).toThrowError(targetPath);
  });
});
