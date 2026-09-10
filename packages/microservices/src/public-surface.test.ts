import { existsSync, readFileSync } from 'node:fs';
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

  it('keeps broker dependencies on the published manifest contract', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      peerDependencies?: Record<string, string>;
    };

    expect(packageJson.peerDependencies).toMatchObject({
      '@grpc/grpc-js': '^1.14.4',
      '@grpc/proto-loader': '^0.8.0',
      ioredis: '^5.0.0',
      mqtt: '^5.0.0',
    });
    expect(packageJson.peerDependencies).not.toHaveProperty('nats');
    expect(packageJson.peerDependencies).not.toHaveProperty('kafkajs');
    expect(packageJson.peerDependencies).not.toHaveProperty('amqplib');
  });

  it('keeps package README example references limited to existing sources and generated starters', () => {
    const packageRoot = resolve(import.meta.dirname, '..');
    const repoRoot = resolve(packageRoot, '../..');
    const readme = readFileSync(resolve(packageRoot, 'README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(packageRoot, 'README.ko.md'), 'utf8');

    expect(existsSync(resolve(repoRoot, 'examples/microservices-tcp'))).toBe(false);
    expect(existsSync(resolve(repoRoot, 'examples/microservices-kafka'))).toBe(false);
    expect(readme).not.toContain('examples/microservices-tcp');
    expect(readme).not.toContain('examples/microservices-kafka');
    expect(koreanReadme).not.toContain('examples/microservices-tcp');
    expect(koreanReadme).not.toContain('examples/microservices-kafka');
    expect(readme).toContain('Runnable starter examples are generated with `fluo new --shape microservice --transport <transport> --runtime node --platform none`');
    expect(koreanReadme).toContain('실행 가능한 스타터 예제는 지원되는 TCP, Redis Streams, NATS, Kafka, RabbitMQ, MQTT, gRPC 트랜스포트 변형에 대해 `fluo new --shape microservice --transport <transport> --runtime node --platform none`로 생성합니다.');
  });
});
