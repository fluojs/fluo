import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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

const unsupportedMigrationClaims = [
  [
    'full-nestjs-compatibility',
    /\b(?:the )?bridge (?:provides?|offers?|supports?) full NestJS Passport compatibility\b/iu,
  ],
  ['middleware-installation', /\bbridge (?:installs|mounts|registers) Passport(?:\.js)? middleware\b/iu],
  ['session-ownership', /\bbridge (?:owns|manages|configures) (?:Passport(?:\.js)? )?sessions?\b/iu],
  [
    'serializer-ownership',
    /\bbridge (?:registers|manages|configures) (?:Passport(?:\.js)? )?(?:serializers?|deserializers?)\b/iu,
  ],
  [
    'automatic-discovery',
    /\bbridge (?:automatically|implicitly) discovers? (?:all )?Passport(?:\.js)? strategies\b/iu,
  ],
  ['implicit-guards', /\bbridge (?:adds|applies|installs|provides) implicit guards?\b/iu],
  ['request-augmentation', /\bbridge (?:augments|mutates) (?:the )?request\b/iu],
  ['host-middleware-ownership', /\bbridge owns (?:the )?host middleware\b/iu],
  ['full-nestjs-compatibility-ko', /bridge(?:가|는) full NestJS Passport compatibility(?:를|을) (?:제공|지원)한다/iu],
  ['middleware-installation-ko', /bridge(?:가|는) Passport(?:\.js)? middleware(?:를|을) 설치한다/iu],
  ['session-ownership-ko', /bridge(?:가|는) (?:Passport(?:\.js)? )?sessions?(?:를|을) 관리한다/iu],
  [
    'serializer-ownership-ko',
    /bridge(?:가|는) (?:Passport(?:\.js)? )?(?:serializers?|deserializers?)(?:를|을) 등록한다/iu,
  ],
  [
    'automatic-discovery-ko',
    /bridge(?:가|는) Passport(?:\.js)? strateg(?:y|ies)(?:를|을) 자동(?:으로)? discovery한다/iu,
  ],
  ['implicit-guards-ko', /bridge(?:가|는) implicit guards?(?:를|을) 제공한다/iu],
  ['request-augmentation-ko', /bridge(?:가|는) request augmentation(?:를|을) 소유한다/iu],
  ['host-middleware-ownership-ko', /bridge(?:가|는) host middleware(?:를|을) 소유한다/iu],
] as const;

function collectUnsupportedMigrationClaims(content: string): string[] {
  return unsupportedMigrationClaims
    .filter(([, pattern]) => pattern.test(content))
    .map(([claimName]) => claimName);
}

describe('Passport.js bridge NestJS migration contract', () => {
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
    const bridgeSource = read('packages/passport/src/adapters/passport-js.ts');
    const moduleSource = read('packages/passport/src/module.ts');
    const migrationSections = migrationDocuments.map((relativePath) =>
      passportBridgeMigrationSection(read(relativePath)),
    );

    // When
    const bridgeFactory = bridgeSource.slice(
      bridgeSource.indexOf('export function createPassportJsStrategyBridge'),
    );

    // Then
    expect(bridgeFactory).toContain('providers: [');
    expect(bridgeFactory).toContain('strategy: {');
    expect(bridgeFactory).toContain('name,');
    expect(bridgeFactory).toContain('token: adapterToken');
    expect(bridgeSource).toContain('state.resolve(state.mapPrincipal({ context: state.context, info, user }))');
    expect(moduleSource).toContain('createStrategyRegistry(strategies)');
    expect(moduleSource).toContain('registry[strategy.name] = strategy.token');

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
      expect(collectUnsupportedMigrationClaims(migrationSection)).toEqual([]);
    }
  });

  it.each([
    ['full-nestjs-compatibility', 'The bridge provides full NestJS Passport compatibility.'],
    ['middleware-installation', 'The bridge installs Passport middleware.'],
    ['session-ownership', 'The bridge manages Passport sessions.'],
    ['serializer-ownership', 'The bridge registers Passport serializers.'],
    ['automatic-discovery', 'The bridge automatically discovers all Passport.js strategies.'],
    ['implicit-guards', 'The bridge provides implicit guards.'],
    ['request-augmentation', 'The bridge augments the request.'],
    ['host-middleware-ownership', 'The bridge owns host middleware.'],
    ['full-nestjs-compatibility-ko', 'bridge는 full NestJS Passport compatibility를 제공한다.'],
    ['middleware-installation-ko', 'bridge는 Passport middleware를 설치한다.'],
    ['session-ownership-ko', 'bridge는 Passport sessions를 관리한다.'],
    ['serializer-ownership-ko', 'bridge는 Passport serializers를 등록한다.'],
    ['automatic-discovery-ko', 'bridge는 Passport.js strategy를 자동으로 discovery한다.'],
    ['implicit-guards-ko', 'bridge는 implicit guards를 제공한다.'],
    ['request-augmentation-ko', 'bridge는 request augmentation을 소유한다.'],
    ['host-middleware-ownership-ko', 'bridge는 host middleware를 소유한다.'],
  ] as const)('rejects the unsupported %s claim', (claimName, claim) => {
    // Given / When
    const detectedClaims = collectUnsupportedMigrationClaims(claim);

    // Then
    expect(detectedClaims).toContain(claimName);
  });
});
