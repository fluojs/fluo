import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

const frameworkServicePattern = /@FrameworkService\(\{\s*id:\s*(['"])([^'"]+)\1,\s*version:\s*(\d+),?\s*\}\)/gu;
const directIdentityPattern =
  /defineFrameworkServiceIdentity\(\s*[\w$]+,\s*\{\s*id:\s*(['"])([^'"]+)\1,\s*version:\s*(\d+),?\s*\}\s*\)/gu;

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
    .flatMap((sourceFile) => [
      ...Array.from(sourceFile.source.matchAll(frameworkServicePattern), (match) => ({
        path: sourceFile.path,
        id: match[2],
        version: Number(match[3]),
      })),
      ...Array.from(sourceFile.source.matchAll(directIdentityPattern), (match) => ({
        path: sourceFile.path,
        id: match[2],
        version: Number(match[3]),
      })),
    ])
    .sort(compareIdentities);
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
});
