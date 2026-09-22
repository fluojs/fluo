import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

type ServiceMarker = readonly [path: string, marker: string];

const frameworkServiceMarkers = [
  ['packages/cache-manager/src/interceptor.ts', "@FrameworkService({ id: '@fluojs/cache-manager/CacheInterceptor', version: 1 })"],
  ['packages/cache-manager/src/service.ts', "@FrameworkService({ id: '@fluojs/cache-manager/CacheService', version: 1 })"],
  ['packages/cqrs/src/buses/command-bus.ts', "@FrameworkService({ id: '@fluojs/cqrs/CommandBusLifecycleService', version: 1 })"],
  ['packages/cqrs/src/buses/event-bus.ts', "@FrameworkService({ id: '@fluojs/cqrs/CqrsEventBusService', version: 1 })"],
  ['packages/cqrs/src/buses/query-bus.ts', "@FrameworkService({ id: '@fluojs/cqrs/QueryBusLifecycleService', version: 1 })"],
  ['packages/cqrs/src/buses/saga-bus.ts', "@FrameworkService({ id: '@fluojs/cqrs/CqrsSagaLifecycleService', version: 1 })"],
  ['packages/cqrs/src/buses/shutdown-deadline.ts', "@FrameworkService({ id: '@fluojs/cqrs/CqrsShutdownDeadline', version: 1 })"],
  ['packages/discord/src/channel.ts', "@FrameworkService({ id: '@fluojs/discord/DiscordChannel', version: 1 })"],
  ['packages/discord/src/service.ts', "@FrameworkService({ id: '@fluojs/discord/DiscordService', version: 1 })"],
  ['packages/drizzle/src/database.ts', "@FrameworkService({ id: '@fluojs/drizzle/DrizzleDatabase', version: 1 })"],
  ['packages/email/src/channel.ts', "@FrameworkService({ id: '@fluojs/email/EmailChannel', version: 1 })"],
  ['packages/email/src/service.ts', "@FrameworkService({ id: '@fluojs/email/EmailService', version: 1 })"],
  ['packages/event-bus/src/service.ts', "@FrameworkService({ id: '@fluojs/event-bus/EventBusService', version: 1 })"],
  ['packages/i18n/src/service.ts', "@FrameworkService({ id: '@fluojs/i18n/I18nService', version: 1 })"],
  ['packages/jwt/src/refresh/refresh-token.ts', "@FrameworkService({ id: '@fluojs/jwt/RefreshTokenService', version: 1 })"],
  ['packages/jwt/src/service.ts', "@FrameworkService({ id: '@fluojs/jwt/JwtService', version: 1 })"],
  ['packages/jwt/src/signing/signer.ts', "@FrameworkService({ id: '@fluojs/jwt/DefaultJwtSigner', version: 1 })"],
  ['packages/jwt/src/signing/verifier.ts', "@FrameworkService({ id: '@fluojs/jwt/DefaultJwtVerifier', version: 1 })"],
  ['packages/microservices/src/service.ts', "@FrameworkService({ id: '@fluojs/microservices/MicroserviceLifecycleService', version: 1 })"],
  ['packages/mongoose/src/connection.ts', "@FrameworkService({ id: '@fluojs/mongoose/MongooseConnection', version: 1 })"],
  ['packages/notifications/src/service.ts', "@FrameworkService({ id: '@fluojs/notifications/NotificationsService', version: 1 })"],
  ['packages/passport/src/guard.ts', "@FrameworkService({ id: '@fluojs/passport/AuthGuard', version: 1 })"],
  ['packages/prisma/src/service.ts', "@FrameworkService({ id: '@fluojs/prisma/PrismaService', version: 1 })"],
  ['packages/redis/src/redis-service.ts', "@FrameworkService({ id: '@fluojs/redis/RedisService', version: 1 })"],
  ['packages/slack/src/channel.ts', "@FrameworkService({ id: '@fluojs/slack/SlackChannel', version: 1 })"],
  ['packages/slack/src/service.ts', "@FrameworkService({ id: '@fluojs/slack/SlackService', version: 1 })"],
  ['packages/terminus/src/health-check.ts', "@FrameworkService({ id: '@fluojs/terminus/TerminusHealthService', version: 1 })"],
  ['packages/throttler/src/guard.ts', "@FrameworkService({ id: '@fluojs/throttler/ThrottlerGuard', version: 1 })"],
] as const satisfies readonly ServiceMarker[];

const directIdentityMarkers = [
  ['packages/config/src/service.ts', "defineFrameworkServiceIdentity(ConfigService, {\n  id: '@fluojs/config/ConfigService',\n  version: 1,\n});"],
] as const satisfies readonly ServiceMarker[];

const requiredContractCompanions = [
  'packages/cache-manager/README.md', 'packages/cache-manager/README.ko.md',
  'packages/config/README.md', 'packages/config/README.ko.md',
  'packages/cqrs/README.md', 'packages/cqrs/README.ko.md',
  'packages/discord/README.md', 'packages/discord/README.ko.md',
  'packages/drizzle/README.md', 'packages/drizzle/README.ko.md',
  'packages/email/README.md', 'packages/email/README.ko.md',
  'packages/event-bus/README.md', 'packages/event-bus/README.ko.md',
  'packages/i18n/README.md', 'packages/i18n/README.ko.md',
  'packages/jwt/README.md', 'packages/jwt/README.ko.md',
  'packages/microservices/README.md', 'packages/microservices/README.ko.md',
  'packages/mongoose/README.md', 'packages/mongoose/README.ko.md',
  'packages/notifications/README.md', 'packages/notifications/README.ko.md',
  'packages/passport/README.md', 'packages/passport/README.ko.md',
  'packages/prisma/README.md', 'packages/prisma/README.ko.md',
  'packages/redis/README.md', 'packages/redis/README.ko.md',
  'packages/slack/README.md', 'packages/slack/README.ko.md',
  'packages/terminus/README.md', 'packages/terminus/README.ko.md',
  'packages/throttler/README.md', 'packages/throttler/README.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function occurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

function assertExactMarker(source: string, marker: string): void {
  if (occurrences(source, marker) !== 1) {
    throw new Error(`Framework service marker inventory drifted: ${marker}`);
  }
}

function expectInventoryFailure(action: () => void): void {
  expect(action).toThrow('Framework service marker inventory drifted');
}

describe('duplicate-copy service token inventory', () => {
  it('pins every explicit public framework-service id and version exactly once', () => {
    for (const [path, marker] of [...frameworkServiceMarkers, ...directIdentityMarkers]) {
      assertExactMarker(read(path), marker);
    }
  });

  it('keeps required EN and KO package contract companions available', () => {
    for (const path of requiredContractCompanions) {
      expect(existsSync(resolve(repoRoot, path))).toBe(true);
    }
  });

  it('keeps private Redis and EventBus lifecycle services out of the public token inventory', () => {
    expect(read('packages/redis/src/service.ts')).not.toContain(
      "@FrameworkService({ id: '@fluojs/redis/RedisLifecycleService', version: 1 })",
    );
    expect(read('packages/event-bus/src/service.ts')).not.toContain(
      "@FrameworkService({ id: '@fluojs/event-bus/EventBusLifecycleService', version: 1 })",
    );
  });

  it('rejects dropped, forked, and version-drifted public service markers', () => {
    const marker = frameworkServiceMarkers[15][1];
    const source = read(frameworkServiceMarkers[15][0]);

    expectInventoryFailure(() => assertExactMarker(source.replace(marker, ''), marker));
    expectInventoryFailure(() => assertExactMarker(`${source}\n${marker}`, marker));
    expectInventoryFailure(() => assertExactMarker(
      source.replace(marker, marker.replace('version: 1', 'version: 2')),
      marker,
    ));
  });

  it('requires exact one-marker comparison rather than a weaker presence check', () => {
    const marker = frameworkServiceMarkers[21][1];
    const source = read(frameworkServiceMarkers[21][0]);

    expectInventoryFailure(() => assertExactMarker(`${source}\n${marker}`, marker));
  });
});
