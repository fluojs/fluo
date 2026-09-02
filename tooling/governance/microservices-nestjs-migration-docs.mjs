import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Source-of-truth markers for the @fluojs/microservices NestJS migration semantics.
// Each documentation marker below is an identifier, subpath, or literal that a
// migrated application actually types, and every one of them is backed by the
// package source markers in the same list.
const requirements = [
  ['packages/microservices/src/index.ts', [
    'BidiStreamPattern,',
    'ClientStreamPattern,',
    'ServerStreamPattern,',
    'RedisPubSubMicroserviceTransport,',
    'RedisStreamsMicroserviceTransport,',
  ]],
  ['packages/microservices/src/transports/redis-transport.ts', [
    "throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use emit() or a transport with durable request/reply semantics.');",
  ]],
  ['packages/microservices/src/service.ts', [
    'throw new InvariantError(`Microservice cannot ${operation} after shutdown has started.`);',
    "operation: 'bidiStream' | 'clientStream' | 'emit' | 'listen' | 'send' | 'serverStream',",
    "throw new Error('The configured transport does not support server streaming. Use a transport that implements serverStream().');",
    'Duplicate microservice handler registration for ${dedupeKey}',
    'Multiple message handlers matched pattern',
    'reader: AsyncIterable<unknown>,',
    'writer: ServerStreamWriter,',
  ]],
  ['packages/microservices/src/transports/grpc-transport.ts', [
    'protoPath: string;',
    'packageName: string;',
    'url: string;',
    'and all streaming microservice patterns.',
  ]],
  ['packages/microservices/src/decorators.ts', [
    'cannot be used on private methods.',
    'cannot be used on static methods.',
  ]],
  ['packages/microservices/package.json', [
    '"./tcp"',
    '"./redis"',
    '"./nats"',
    '"./kafka"',
    '"./rabbitmq"',
    '"./grpc"',
    '"./mqtt"',
  ]],
  ['docs/getting-started/migrate-from-nestjs.md', [
    '### Microservices Handler and Transport Migration',
    '`@fluojs/microservices/tcp`',
    '`@fluojs/microservices/redis`',
    '`@fluojs/microservices/nats`',
    '`@fluojs/microservices/kafka`',
    '`@fluojs/microservices/rabbitmq`',
    '`@fluojs/microservices/grpc`',
    '`@fluojs/microservices/mqtt`',
    '`RedisPubSubMicroserviceTransport`',
    '`RedisStreamsMicroserviceTransport`',
    '`@ServerStreamPattern`',
    '`@ClientStreamPattern`',
    '`@BidiStreamPattern`',
    '`ServerStreamWriter`',
    '`Transport.REDIS`',
    '`GrpcMicroserviceTransport`',
    '`protoPath`',
    '`packageName`',
    '`url`',
    '`@grpc/grpc-js@^1.14.4`',
    '`@grpc/proto-loader@^0.8.0`',
    'writer.end()',
  ]],
  ['docs/getting-started/migrate-from-nestjs.ko.md', [
    '### Microservices Handler and Transport Migration',
    '`@fluojs/microservices/tcp`',
    '`@fluojs/microservices/redis`',
    '`@fluojs/microservices/nats`',
    '`@fluojs/microservices/kafka`',
    '`@fluojs/microservices/rabbitmq`',
    '`@fluojs/microservices/grpc`',
    '`@fluojs/microservices/mqtt`',
    '`RedisPubSubMicroserviceTransport`',
    '`RedisStreamsMicroserviceTransport`',
    '`@ServerStreamPattern`',
    '`@ClientStreamPattern`',
    '`@BidiStreamPattern`',
    '`ServerStreamWriter`',
    '`Transport.REDIS`',
    '`GrpcMicroserviceTransport`',
    '`protoPath`',
    '`packageName`',
    '`url`',
    '`@grpc/grpc-js@^1.14.4`',
    '`@grpc/proto-loader@^0.8.0`',
    'writer.end()',
  ]],
];

export function enforceMicroservicesNestjsMigrationDocs(
  readText = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8'),
) {
  for (const [relativePath, requiredMarkers] of requirements) {
    const content = readText(relativePath);
    const missingMarkers = requiredMarkers.filter((marker) => !content.includes(marker));

    if (missingMarkers.length > 0) {
      throw new Error(
        `Platform consistency governance check failed: ${relativePath} must keep the @fluojs/microservices NestJS migration boundary synchronized; missing: ${missingMarkers.join(', ')}.`,
      );
    }
  }
}
