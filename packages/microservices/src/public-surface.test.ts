import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as microservices from './index.js';

describe('@fluojs/microservices root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(microservices).toHaveProperty('MicroservicesModule');
    expect(microservices).not.toHaveProperty('createMicroservicesModule');
    expect(microservices).toHaveProperty('createMicroservicesProviders');
    expect(microservices).toHaveProperty('MessagePattern');
    expect(microservices).toHaveProperty('EventPattern');
    expect(microservices).toHaveProperty('ServerStreamPattern');
    expect(microservices).toHaveProperty('ClientStreamPattern');
    expect(microservices).toHaveProperty('BidiStreamPattern');
    expect(microservices).toHaveProperty('MicroserviceLifecycleService');
    expect(microservices).toHaveProperty('MICROSERVICE');
    expect(microservices).not.toHaveProperty('MICROSERVICE_OPTIONS');
    expect(microservices).toHaveProperty('createMicroservicePlatformStatusSnapshot');
    expect(microservices).not.toHaveProperty('defineHandlerMetadata');
    expect(microservices).not.toHaveProperty('getHandlerMetadataEntries');
    expect(microservices).not.toHaveProperty('microserviceMetadataSymbol');
    expect(Object.keys(microservices).sort()).toMatchSnapshot();
  });

  it('keeps broker dependency documentation aligned with the published manifest', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      peerDependencies?: Record<string, string>;
    };
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');

    expect(packageJson.peerDependencies).toMatchObject({
      '@grpc/grpc-js': '^1.0.0',
      '@grpc/proto-loader': '^0.8.0',
      ioredis: '^5.0.0',
      mqtt: '^5.0.0',
    });
    expect(packageJson.peerDependencies).not.toHaveProperty('nats');
    expect(packageJson.peerDependencies).not.toHaveProperty('kafkajs');
    expect(packageJson.peerDependencies).not.toHaveProperty('amqplib');
    expect(readme).toContain('Package-managed optional peers loaded by `@fluojs/microservices`: `@grpc/grpc-js`, `@grpc/proto-loader`, `ioredis`, `mqtt`');
    expect(readme).toContain('Caller-owned broker clients passed explicitly to transports: `nats`, `kafkajs`, `amqplib`');
  });
});
