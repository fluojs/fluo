import { describe, expect, expectTypeOf, it } from 'vitest';

import * as microservicesPublicApi from './index.js';
import type {
  Microservice,
  MicroserviceModuleOptions,
  MicroserviceModuleRegistrationOptions,
  MicroserviceTransport,
  Pattern,
  ServerStreamWriter,
} from './index.js';
import type { GrpcMicroserviceTransportOptions } from './transports/grpc-transport.js';
import type { KafkaMicroserviceTransportOptions } from './transports/kafka-transport.js';
import type { MqttMicroserviceTransportOptions } from './transports/mqtt-transport.js';
import type { NatsMicroserviceTransportOptions } from './transports/nats-transport.js';
import type { RabbitMqMicroserviceTransportOptions } from './transports/rabbitmq-transport.js';
import type { RedisPubSubMicroserviceTransportOptions } from './transports/redis-transport.js';
import type {
  RedisStreamClientLike,
  RedisStreamsMicroserviceTransportOptions,
} from './transports/redis-streams-transport.js';
import type { TcpMicroserviceTransportOptions } from './transports/tcp-transport.js';

describe('@fluojs/microservices public API surface', () => {
  it('keeps documented root registration and facade exports', () => {
    expect(microservicesPublicApi).toHaveProperty('MicroservicesModule');
    expect(microservicesPublicApi).toHaveProperty('MessagePattern');
    expect(microservicesPublicApi).toHaveProperty('EventPattern');
    expect(microservicesPublicApi).toHaveProperty('ServerStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('ClientStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('BidiStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('MICROSERVICE');
    expect(microservicesPublicApi).toHaveProperty('createMicroservicePlatformStatusSnapshot');
  });

  it('keeps documented TypeScript-only contracts', () => {
    expectTypeOf<Pattern>().toMatchTypeOf<string | RegExp>();
    expectTypeOf<ServerStreamWriter>().toHaveProperty('write');
    expectTypeOf<ServerStreamWriter>().toHaveProperty('end');
    expectTypeOf<ServerStreamWriter>().toHaveProperty('error');
    expectTypeOf<MicroserviceTransport>().toHaveProperty('listen');
    expectTypeOf<MicroserviceTransport>().toHaveProperty('send');
    expectTypeOf<MicroserviceTransport>().toHaveProperty('emit');
    expectTypeOf<MicroserviceTransport>().toHaveProperty('ownsResources');
    expectTypeOf<MicroserviceTransport>().toHaveProperty('resourceOwnership');
    expectTypeOf<Microservice>().toHaveProperty('listen');
    expectTypeOf<MicroserviceModuleOptions>().toMatchTypeOf<{ transport: MicroserviceTransport }>();
    expectTypeOf<MicroserviceModuleOptions>().toHaveProperty('module');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().toHaveProperty('additionalExports');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().not.toHaveProperty('global');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().toHaveProperty('providers');
    expectTypeOf<GrpcMicroserviceTransportOptions>().toHaveProperty('protoPath');
    expectTypeOf<GrpcMicroserviceTransportOptions>().toHaveProperty('serverCredentials');
    expectTypeOf<GrpcMicroserviceTransportOptions>().toHaveProperty('channelCredentials');
    expectTypeOf<KafkaMicroserviceTransportOptions>().toHaveProperty('consumer');
    expectTypeOf<MqttMicroserviceTransportOptions>().toHaveProperty('requestTimeoutMs');
    expectTypeOf<NatsMicroserviceTransportOptions>().toHaveProperty('client');
    expectTypeOf<RabbitMqMicroserviceTransportOptions>().toHaveProperty('consumer');
    expectTypeOf<RedisPubSubMicroserviceTransportOptions>().toHaveProperty('subscribeClient');
    expectTypeOf<RedisPubSubMicroserviceTransportOptions>().not.toHaveProperty('requestTimeoutMs');
    expectTypeOf<RedisStreamsMicroserviceTransportOptions>().toHaveProperty('readerClient');
    expectTypeOf<RedisStreamClientLike>().toHaveProperty('xreadgroup');
    expectTypeOf<TcpMicroserviceTransportOptions>().toHaveProperty('port');
  });

  it('hides internal lifecycle and transport wire types from the root barrel', () => {
    expect(microservicesPublicApi).not.toHaveProperty('defineHandlerMetadata');
    expect(microservicesPublicApi).not.toHaveProperty('getHandlerMetadataEntries');
    expect(microservicesPublicApi).not.toHaveProperty('microserviceMetadataSymbol');
    expect(microservicesPublicApi).not.toHaveProperty('MICROSERVICE_OPTIONS');
    expect(microservicesPublicApi).not.toHaveProperty('HandlerDescriptor');
    expect(microservicesPublicApi).not.toHaveProperty('HandlerMetadata');
    expect(microservicesPublicApi).not.toHaveProperty('TransportPacket');
    expect(microservicesPublicApi).not.toHaveProperty('TransportHandler');
    expect(microservicesPublicApi).not.toHaveProperty('TransportServerStreamHandler');
    expect(microservicesPublicApi).not.toHaveProperty('TransportClientStreamHandler');
    expect(microservicesPublicApi).not.toHaveProperty('TransportBidiStreamHandler');
    expect(microservicesPublicApi).not.toHaveProperty('KafkaTransportMessage');
    expect(microservicesPublicApi).not.toHaveProperty('NatsTransportMessage');
    expect(microservicesPublicApi).not.toHaveProperty('NatsTransportResponse');
    expect(microservicesPublicApi).not.toHaveProperty('RabbitMqTransportMessage');
    expect(microservicesPublicApi).not.toHaveProperty('RedisStreamTransportMessage');
  });
});
