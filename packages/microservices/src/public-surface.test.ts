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

  it('keeps the module-first replacement path documented while the helper remains public', () => {
    const readme = readFileSync(resolve(import.meta.dirname, '../README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(import.meta.dirname, '../README.ko.md'), 'utf8');

    expect(readme).toContain('Use `MicroservicesModule.forRoot({ transport, module: { ... } })` when you want custom providers, exports, or non-global registration without dropping back to raw provider arrays.');
    expect(readme).toContain('Use `createMicroservicesProviders(...)` only when you need the low-level provider array itself for custom module assembly.');
    expect(koreanReadme).toContain('custom provider/export/non-global 구성이 필요할 때도 raw provider array로 내려가지 말고 `MicroservicesModule.forRoot({ transport, module: { ... } })`를 우선 사용하세요.');
    expect(koreanReadme).toContain('`createMicroservicesProviders(...)`는 커스텀 모듈 조합에 low-level provider array 자체가 필요할 때만 사용하세요.');
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

  it('keeps the RabbitMQ book aligned with the documented response queue topology', () => {
    const repoRoot = resolve(import.meta.dirname, '../../..');
    const chapter = readFileSync(resolve(repoRoot, 'book/intermediate/ch04-rabbitmq.md'), 'utf8');
    const koreanChapter = readFileSync(resolve(repoRoot, 'book/intermediate/ch04-rabbitmq.ko.md'), 'utf8');

    expect(chapter).toContain('regular, instance-scoped response queue strategy rather than RabbitMQ\'s direct reply-to pseudo-queue');
    expect(chapter).not.toContain('Direct Reply-to');
    expect(koreanChapter).toContain('RabbitMQ의 direct reply-to pseudo-queue가 아니라 일반적인 인스턴스 범위 응답 큐 전략');
    expect(koreanChapter).not.toContain('Direct Reply-to');
  });
});
