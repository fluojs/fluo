import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type ServiceIdentity = Readonly<{
  path: string;
  id: string;
  version: number;
}>;

type SourceFile = Readonly<{
  path: string;
  source: string;
}>;

const expectedPublicServiceIdentities = [
  { path: 'packages/cache-manager/src/interceptor.ts', id: '@fluojs/cache-manager/CacheInterceptor', version: 1 },
  { path: 'packages/cache-manager/src/service.ts', id: '@fluojs/cache-manager/CacheService', version: 1 },
  { path: 'packages/config/src/module.ts', id: '@fluojs/config/ConfigReloadManager', version: 1 },
  { path: 'packages/config/src/service.ts', id: '@fluojs/config/ConfigService', version: 1 },
  { path: 'packages/cqrs/src/buses/command-bus.ts', id: '@fluojs/cqrs/CommandBusLifecycleService', version: 1 },
  { path: 'packages/cqrs/src/buses/event-bus.ts', id: '@fluojs/cqrs/CqrsEventBusService', version: 1 },
  { path: 'packages/cqrs/src/buses/query-bus.ts', id: '@fluojs/cqrs/QueryBusLifecycleService', version: 1 },
  { path: 'packages/discord/src/channel.ts', id: '@fluojs/discord/DiscordChannel', version: 1 },
  { path: 'packages/discord/src/service.ts', id: '@fluojs/discord/DiscordService', version: 1 },
  { path: 'packages/drizzle/src/database.ts', id: '@fluojs/drizzle/DrizzleDatabase', version: 1 },
  { path: 'packages/email/src/channel.ts', id: '@fluojs/email/EmailChannel', version: 1 },
  { path: 'packages/email/src/service.ts', id: '@fluojs/email/EmailService', version: 1 },
  { path: 'packages/event-bus/src/service.ts', id: '@fluojs/event-bus/EventBusService', version: 1 },
  { path: 'packages/i18n/src/service.ts', id: '@fluojs/i18n/I18nService', version: 1 },
  { path: 'packages/jwt/src/refresh/refresh-token.ts', id: '@fluojs/jwt/RefreshTokenService', version: 1 },
  { path: 'packages/jwt/src/service.ts', id: '@fluojs/jwt/JwtService', version: 1 },
  { path: 'packages/jwt/src/signing/signer.ts', id: '@fluojs/jwt/DefaultJwtSigner', version: 1 },
  { path: 'packages/jwt/src/signing/verifier.ts', id: '@fluojs/jwt/DefaultJwtVerifier', version: 1 },
  { path: 'packages/microservices/src/service.ts', id: '@fluojs/microservices/MicroserviceLifecycleService', version: 1 },
  { path: 'packages/mongoose/src/connection.ts', id: '@fluojs/mongoose/MongooseConnection', version: 1 },
  { path: 'packages/notifications/src/service.ts', id: '@fluojs/notifications/NotificationsService', version: 1 },
  { path: 'packages/passport/src/guard.ts', id: '@fluojs/passport/AuthGuard', version: 1 },
  { path: 'packages/prisma/src/service.ts', id: '@fluojs/prisma/PrismaService', version: 1 },
  { path: 'packages/redis/src/redis-service.ts', id: '@fluojs/redis/RedisService', version: 1 },
  { path: 'packages/slack/src/channel.ts', id: '@fluojs/slack/SlackChannel', version: 1 },
  { path: 'packages/slack/src/service.ts', id: '@fluojs/slack/SlackService', version: 1 },
  { path: 'packages/terminus/src/health-check.ts', id: '@fluojs/terminus/TerminusHealthService', version: 1 },
  { path: 'packages/throttler/src/guard.ts', id: '@fluojs/throttler/ThrottlerGuard', version: 1 },
] as const satisfies readonly ServiceIdentity[];

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function discoverTypeScriptSources(directory: string, relativeDirectory: string): readonly SourceFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly SourceFile[] => {
      const relativePath = `${relativeDirectory}/${entry.name}`;
      const absolutePath = resolve(directory, entry.name);

      if (entry.isDirectory()) {
        return discoverTypeScriptSources(absolutePath, relativePath);
      }

      if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
        return [];
      }

      return [{ path: relativePath, source: read(relativePath) }];
    });
}

function discoverGovernedSourceFiles(): readonly SourceFile[] {
  const packagesDirectory = resolve(repoRoot, 'packages');

  return readdirSync(packagesDirectory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry): readonly SourceFile[] => {
      const relativeDirectory = `packages/${entry.name}/src`;
      const sourceDirectory = resolve(repoRoot, relativeDirectory);

      if (!entry.isDirectory() || !existsSync(sourceDirectory)) {
        return [];
      }

      return discoverTypeScriptSources(sourceDirectory, relativeDirectory);
    });
}

function discoverServiceIdentities(sourceFiles: readonly SourceFile[]): readonly ServiceIdentity[] {
  return sourceFiles
    .flatMap(discoverSourceServiceIdentities)
    .sort(compareIdentities);
}

function discoverSourceServiceIdentities(sourceFile: SourceFile): readonly ServiceIdentity[] {
  const parsedSource = ts.createSourceFile(sourceFile.path, sourceFile.source, ts.ScriptTarget.Latest, true);
  const identities: ServiceIdentity[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const marker = frameworkServiceMarker(node);

      if (marker && !isFrameworkServiceImplementationRelay(node)) {
        identities.push({
          path: sourceFile.path,
          ...resolveServiceIdentity(node, marker, sourceFile.path),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(parsedSource);
  return identities;
}

function frameworkServiceMarker(call: ts.CallExpression): 'FrameworkService' | 'defineFrameworkServiceIdentity' | undefined {
  if (!ts.isIdentifier(call.expression)) {
    return undefined;
  }

  const name = call.expression.text;

  return name === 'FrameworkService' || name === 'defineFrameworkServiceIdentity' ? name : undefined;
}

function isFrameworkServiceImplementationRelay(call: ts.CallExpression): boolean {
  for (let parent = call.parent; parent; parent = parent.parent) {
    if (
      ts.isFunctionDeclaration(parent)
      && parent.name
      && (parent.name.text === 'FrameworkService' || parent.name.text === 'defineFrameworkServiceIdentity')
    ) {
      return true;
    }
  }

  return false;
}

function resolveServiceIdentity(
  call: ts.CallExpression,
  marker: 'FrameworkService' | 'defineFrameworkServiceIdentity',
  path: string,
): Omit<ServiceIdentity, 'path'> {
  const argumentIndex = marker === 'FrameworkService' ? 0 : 1;
  const identityExpression = call.arguments[argumentIndex];

  if (!identityExpression) {
    throw new Error(`Framework service identity must provide a canonical object literal: ${path}`);
  }

  const identityObject = ts.isObjectLiteralExpression(identityExpression)
    ? identityExpression
    : ts.isIdentifier(identityExpression)
      ? resolveConstIdentityObject(identityExpression)
      : undefined;

  if (!identityObject) {
    throw new Error(`Framework service identity must use an inline or const object literal: ${path}`);
  }

  return readIdentityObject(identityObject, path);
}

function resolveConstIdentityObject(identifier: ts.Identifier): ts.ObjectLiteralExpression | undefined {
  for (let parent = identifier.parent; parent; parent = parent.parent) {
    if (!ts.isSourceFile(parent) && !ts.isBlock(parent)) {
      continue;
    }

    for (const statement of parent.statements) {
      if (!ts.isVariableStatement(statement) || statement.end > identifier.pos) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (
          (statement.declarationList.flags & ts.NodeFlags.Const) !== 0
          && ts.isIdentifier(declaration.name)
          && declaration.name.text === identifier.text
          && declaration.initializer
          && ts.isObjectLiteralExpression(declaration.initializer)
        ) {
          return declaration.initializer;
        }
      }
    }
  }

  return undefined;
}

function readIdentityObject(identityObject: ts.ObjectLiteralExpression, path: string): Omit<ServiceIdentity, 'path'> {
  let id: string | undefined;
  let version: number | undefined;

  for (const property of identityObject.properties) {
    if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property)) {
      throw new Error(`Framework service identity must use plain id and version properties: ${path}`);
    }

    if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) {
      throw new Error(`Framework service identity must use plain id and version properties: ${path}`);
    }

    const name = property.name.text;

    if (name === 'id' && ts.isStringLiteral(property.initializer)) {
      id = property.initializer.text;
      continue;
    }

    if (name === 'version' && ts.isNumericLiteral(property.initializer)) {
      version = Number(property.initializer.text);
      continue;
    }

    throw new Error(`Framework service identity must use literal id and version properties: ${path}`);
  }

  if (id === undefined || version === undefined) {
    throw new Error(`Framework service identity must define literal id and version properties: ${path}`);
  }

  return { id, version };
}

function compareIdentities(left: ServiceIdentity, right: ServiceIdentity): number {
  return entryKey(left).localeCompare(entryKey(right));
}

function entryKey(identity: ServiceIdentity): string {
  return `${identity.path}\u0000${identity.id}\u0000${String(identity.version)}`;
}

function ownershipKey(identity: ServiceIdentity): string {
  return `${identity.id}\u0000${String(identity.version)}`;
}

function assertUniqueOwnership(identities: readonly ServiceIdentity[]): void {
  const ownership = new Set<string>();

  for (const identity of identities) {
    const key = ownershipKey(identity);
    if (ownership.has(key)) {
      throw new Error(`Framework service identity has more than one owner: ${key}`);
    }

    ownership.add(key);
  }
}

function assertExactDiscoveredSet(
  expected: readonly ServiceIdentity[],
  discovered: readonly ServiceIdentity[],
): void {
  assertUniqueOwnership(expected);
  assertUniqueOwnership(discovered);

  const expectedEntries = new Set(expected.map(entryKey));
  const discoveredEntries = new Set(discovered.map(entryKey));
  const missingExpected = [...expectedEntries].filter((entry) => !discoveredEntries.has(entry));
  const unlistedDiscovered = [...discoveredEntries].filter((entry) => !expectedEntries.has(entry));

  if (missingExpected.length > 0 || unlistedDiscovered.length > 0) {
    throw new Error('Framework service identity inventory does not match the discovered source set.');
  }
}

function assertRequiredContractCompanions(identities: readonly ServiceIdentity[]): void {
  const packageDirectories = new Set(identities.map((identity) => identity.path.split('/').slice(0, 2).join('/')));

  for (const packageDirectory of packageDirectories) {
    for (const name of ['README.md', 'README.ko.md']) {
      if (!existsSync(resolve(repoRoot, packageDirectory, name))) {
        throw new Error(`Framework service package contract companion is missing: ${packageDirectory}/${name}`);
      }
    }
  }
}

function replaceSource(
  sourceFiles: readonly SourceFile[],
  path: string,
  replacement: string,
): readonly SourceFile[] {
  return sourceFiles.map((sourceFile) => (
    sourceFile.path === path ? { ...sourceFile, source: replacement } : sourceFile
  ));
}

describe('duplicate-copy service token inventory', () => {
  const governedSourceFiles = discoverGovernedSourceFiles();

  it('matches the complete discovered public framework-service identity set', () => {
    assertExactDiscoveredSet(expectedPublicServiceIdentities, discoverServiceIdentities(governedSourceFiles));
  });

  it('keeps required EN and KO package contract companions available', () => {
    assertRequiredContractCompanions(expectedPublicServiceIdentities);
  });

  it('rejects dropped expected, version-drifted, duplicate, and unlisted service markers', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const marker = "@FrameworkService({ id: '@fluojs/cache-manager/CacheInterceptor', version: 1 })";
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(expectedPublicServiceIdentities.slice(1), discoverServiceIdentities(governedSourceFiles));
    }).toThrow();
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          sourceFile.source.replace(marker, marker.replace('version: 1', 'version: 2')),
        )),
      );
    }).toThrow();
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}\n${marker}`,
        )),
      );
    }).toThrow();
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}\n@FrameworkService({ id: '@fluojs/cache-manager/UnlistedService', version: 1 })`,
        )),
      );
    }).toThrow();
  });

  it('rejects unlisted reversed decorator and indirect identity markers', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);
    const identitySourceFile = governedSourceFiles.find((file) => file.path === 'packages/config/src/service.ts');

    if (!sourceFile || !identitySourceFile) {
      throw new Error('Expected governed source file is missing.');
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
@FrameworkService({ version: 1, id: '@fluojs/cache-manager/ReversedService' })`,
        )),
      );
    }).toThrow();
    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          identitySourceFile.path,
          `${identitySourceFile.source}
const identityConstant = { version: 1, id: '@fluojs/cache-manager/IndirectService' };
defineFrameworkServiceIdentity(Service, identityConstant);`,
        )),
      );
    }).toThrow();
  });

  it('ignores FrameworkService marker text in comments and strings', () => {
    const expectedIdentity = expectedPublicServiceIdentities[0];
    const sourceFile = governedSourceFiles.find((file) => file.path === expectedIdentity.path);

    if (!sourceFile) {
      throw new Error(`Expected governed source file is missing: ${expectedIdentity.path}`);
    }

    expect(() => {
      assertExactDiscoveredSet(
        expectedPublicServiceIdentities,
        discoverServiceIdentities(replaceSource(
          governedSourceFiles,
          sourceFile.path,
          `${sourceFile.source}
// @FrameworkService({ version: 1, id: '@fluojs/cache-manager/CommentMention' })
const markerText = "@FrameworkService({ version: 1, id: '@fluojs/cache-manager/StringMention' })";`,
        )),
      );
    }).not.toThrow();
  });
});
