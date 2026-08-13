import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforcePassportJsBridgeNestjsMigration } from './passport-js-bridge-nestjs-migration.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const bookDocuments = [
  'book/beginner/ch15-passport.md',
  'book/beginner/ch15-passport.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function appendToPassportBridgeFence(content: string, source: string): string {
  const bridgeCall = content.indexOf('createPassportJsStrategyBridge');
  const fenceEnd = content.indexOf('```', bridgeCall);

  if (bridgeCall === -1 || fenceEnd === -1) {
    throw new Error('Passport.js bridge example fence is missing or unterminated.');
  }

  return `${content.slice(0, fenceEnd)}${source}\n${content.slice(fenceEnd)}`;
}

describe('Passport.js bridge example governance', () => {
  it.each(bookDocuments)('rejects an invalid Principal shape in %s', (targetPath) => {
    // Given
    const readWithInvalidPrincipal = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === targetPath
        ? content.replace(
          'return { claims: { ...user }, subject: user.id };',
          'return { claims: { ...user } };',
        )
        : content;
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithInvalidPrincipal);

    // Then
    expect(runGovernanceGuard).toThrowError(/Principal|subject|type-check/iu);
  });

  it.each(bookDocuments)('rejects semantically invalid PassportModule options in %s', (targetPath) => {
    // Given
    const readWithInvalidOptions = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === targetPath
        ? content.replace("{ defaultStrategy: 'google' }", '{ defaultStrategy: 42 }')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithInvalidOptions);

    // Then
    expect(runGovernanceGuard).toThrowError(/defaultStrategy|type-check|string/iu);
  });

  it.each([
    [
      'providers: [GoogleStrategy, ...googleBridge.providers]',
      'providers: [GoogleStrategy]',
      /googleBridge\.providers/u,
    ],
    [
      '[googleBridge.strategy]',
      '[]',
      /googleBridge\.strategy/u,
    ],
  ] as const)(
    'rejects incomplete AuthModule bridge wiring in %s',
    (implementedShape, incompleteShape, expectedContract) => {
      for (const targetPath of bookDocuments) {
        // Given
        const readWithIncompleteWiring = (relativePath: string): string => {
          const content = read(relativePath);
          return relativePath === targetPath
            ? content.replace(implementedShape, incompleteShape)
            : content;
        };

        // When
        const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithIncompleteWiring);

        // Then
        expect(runGovernanceGuard).toThrowError(expectedContract);
      }
    },
  );

  it.each([
    "const duplicateBridge = createPassportJsStrategyBridge('duplicate', GoogleStrategy);",
    'const bridgeFactoryDecoy = createPassportJsStrategyBridge;',
  ] as const)('rejects a duplicate or decoy Passport bridge fence containing %s', (decoy) => {
    for (const targetPath of bookDocuments) {
      // Given
      const readWithDuplicateFence = (relativePath: string): string => {
        const content = read(relativePath);
        return relativePath === targetPath
          ? `${content}\n\`\`\`typescript\n${decoy}\n\`\`\`\n`
          : content;
      };

      // When
      const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithDuplicateFence);

      // Then
      expect(runGovernanceGuard).toThrowError(/unique|multiple|duplicate/iu);
    }
  });

  it.each(bookDocuments)('rejects a trailing Module(...) decoy in %s', (targetPath) => {
    // Given
    const readWithTrailingModule = (relativePath: string): string => {
      const content = read(relativePath);
      if (relativePath !== targetPath) {
        return content;
      }

      return appendToPassportBridgeFence(
        content.replace('@Module({', '@UnrelatedModule({'),
        'Module({ providers: [GoogleStrategy, ...googleBridge.providers] });',
      );
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithTrailingModule);

    // Then
    expect(runGovernanceGuard).toThrowError(/@Module|AuthModule|coherent/iu);
  });

  it.each(bookDocuments)('rejects a trailing PassportModule.forRoot(...) decoy in %s', (targetPath) => {
    // Given
    const readWithTrailingForRoot = (relativePath: string): string => {
      const content = read(relativePath);
      if (relativePath !== targetPath) {
        return content;
      }

      return appendToPassportBridgeFence(
        content.replace('    PassportModule.forRoot(', '    UnrelatedPassportModule.forRoot('),
        "PassportModule.forRoot({ defaultStrategy: 'google' }, [googleBridge.strategy]);",
      );
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithTrailingForRoot);

    // Then
    expect(runGovernanceGuard).toThrowError(/PassportModule\.forRoot|imports|coherent/iu);
  });
});
