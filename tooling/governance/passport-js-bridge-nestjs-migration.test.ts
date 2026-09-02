import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  collectUnsupportedPassportBridgeClaims,
  enforcePassportJsBridgeNestjsMigration,
} from './passport-js-bridge-nestjs-migration.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationDocuments = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function passportBridgeMigrationSection(content: string): string {
  const heading = '### Passport.js Bridge Migration';
  const start = content.indexOf(heading);
  const end = content.indexOf('\n### ', start + heading.length);

  if (start === -1 || end === -1) {
    throw new Error('Passport.js bridge migration section is missing or unterminated.');
  }

  return content.slice(start, end);
}

describe('Passport.js bridge NestJS migration contract', () => {
  it('enforces the current migration and book contract', () => {
    // Given
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'docs/getting-started/migrate-from-nestjs.md',
      'The bridge does not install Passport middleware by default, but can when enabled.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      'bridge는 기본적으로 Passport middleware를 설치하지 않지만 옵션을 켜면 설치할 수 있습니다.',
    ],
  ] as const)('rejects a compound contradiction added to %s', (targetPath, contradiction) => {
    // Given
    const readWithContradiction = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${contradiction}\n` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrowError(targetPath);
  });

  it.each(migrationDocuments)(
    'rejects invalid TypeScript in any fence from %s',
    (targetPath) => {
      // Given
      const readWithInvalidExample = (relativePath: string): string => {
        const content = read(relativePath);
        return relativePath === targetPath
          ? `${content}\n\`\`\`ts\nasync handle(event: UserCreatedEvent): Promise<void> {}\n\`\`\`\n`
          : content;
      };

      // When
      const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithInvalidExample);

      // Then
      expect(runGovernanceGuard).toThrowError(/valid TypeScript/u);
    },
  );

  it.each([
    'book/beginner/ch15-passport.md',
    'book/beginner/ch15-passport.ko.md',
  ] as const)('rejects an incomplete GoogleStrategy provider list in %s', (targetPath) => {
    // Given
    const readWithoutStrategyProvider = (relativePath: string): string => {
      const content = read(relativePath);
      return relativePath === targetPath
        ? content.replace('providers: [GoogleStrategy, ...googleBridge.providers]', 'providers: [...googleBridge.providers]')
        : content;
    };

    // When
    const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithoutStrategyProvider);

    // Then
    expect(runGovernanceGuard).toThrowError(/GoogleStrategy/u);
  });

  it.each([
    [
      'packages/passport/src/adapters/passport-js.ts',
      'token: adapterToken,',
      'token: optionsToken,',
      '// token: adapterToken\nconst decoy = "token: adapterToken";',
    ],
    [
      'packages/passport/src/module.ts',
      'registry[strategy.name] = strategy.token;',
      'registry[strategy.name] = strategies[0]?.token;',
      '// registry[strategy.name] = strategy.token;\nconst decoy = "registry[strategy.name] = strategy.token";',
    ],
  ] as const)(
    'rejects a structural source regression in %s despite comment and string decoys',
    (targetPath, implementedShape, regressedShape, decoys) => {
      // Given
      const readWithSourceRegression = (relativePath: string): string => {
        const content = read(relativePath);
        return relativePath === targetPath
          ? `${content.replace(implementedShape, regressedShape)}\n${decoys}\n`
          : content;
      };

      // When
      const runGovernanceGuard = () => enforcePassportJsBridgeNestjsMigration(readWithSourceRegression);

      // Then
      expect(runGovernanceGuard).toThrowError(targetPath);
    },
  );

  it('keeps the explicit migration boundary discoverable from both context hubs', () => {
    // Given
    const contextDocuments = [read('docs/CONTEXT.md'), read('docs/CONTEXT.ko.md')] as const;

    // When / Then
    for (const content of contextDocuments) {
      expect(content).toContain('createPassportJsStrategyBridge(...)');
      expect(content).toContain('PassportModule.forRoot(...)');
      expect(content).toContain('mapPrincipal(...)');
      expect(content).toContain('application-owned');
      expect(content).toContain('automatic strategy discovery');
      expect(content).toContain('docs/getting-started/migrate-from-nestjs');
      expect(content).toContain('book/beginner/ch15-passport');
    }
  });

  it('anchors the migration sequence to the implemented provider, registry, and principal seams', () => {
    // Given
    const migrationSections = migrationDocuments.map((relativePath) =>
      passportBridgeMigrationSection(read(relativePath)),
    );

    // When / Then
    for (const migrationSection of migrationSections) {
      expect(migrationSection).toContain('createPassportJsStrategyBridge(...)');
      expect(migrationSection).toContain('PassportModule.forRoot(...)');
      expect(migrationSection).toContain('bridge.providers');
      expect(migrationSection).toContain('bridge.strategy');
      expect(migrationSection).toContain('mapPrincipal(...)');
      expect(migrationSection).toContain('requestContext.principal');
      expect(migrationSection).toContain('middleware');
      expect(migrationSection).toContain('sessions');
      expect(migrationSection).toContain('serializers');
      expect(migrationSection).toContain('deserializers');
      expect(migrationSection).toContain('automatic strategy discovery');
      expect(migrationSection).toContain('implicit guards');
      expect(migrationSection).toContain('request augmentation');
      expect(migrationSection).toContain('host middleware');
      expect(migrationSection).toContain('application-owned');
      expect(migrationSection).toMatch(/full NestJS Passport compatibility/iu);
      expect(collectUnsupportedPassportBridgeClaims(migrationSection)).toEqual([]);
    }
  });

});
