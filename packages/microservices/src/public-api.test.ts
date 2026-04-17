import { describe, expect, expectTypeOf, it } from 'vitest';

import * as microservicesPublicApi from './index.js';
import type {
  GrpcMicroserviceTransportOptions,
  KafkaMicroserviceTransportOptions,
  Microservice,
  MicroserviceModuleOptions,
  MicroserviceModuleRegistrationOptions,
  MicroserviceTransport,
  MqttMicroserviceTransportOptions,
  NatsMicroserviceTransportOptions,
  Pattern,
  RabbitMqMicroserviceTransportOptions,
  RedisPubSubMicroserviceTransportOptions,
  RedisStreamClientLike,
  RedisStreamsMicroserviceTransportOptions,
  ServerStreamWriter,
} from './index.js';

describe('@fluojs/microservices public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(microservicesPublicApi).toHaveProperty('MicroservicesModule');
    expect(microservicesPublicApi).toHaveProperty('createMicroservicesProviders');
    expect(microservicesPublicApi).toHaveProperty('MessagePattern');
    expect(microservicesPublicApi).toHaveProperty('EventPattern');
    expect(microservicesPublicApi).toHaveProperty('ServerStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('ClientStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('BidiStreamPattern');
    expect(microservicesPublicApi).toHaveProperty('TcpMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('RedisPubSubMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('NatsMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('KafkaMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('RabbitMqMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('RedisStreamsMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('GrpcMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('MqttMicroserviceTransport');
    expect(microservicesPublicApi).toHaveProperty('MicroserviceLifecycleService');
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
    expectTypeOf<Microservice>().toHaveProperty('listen');
    expectTypeOf<MicroserviceModuleOptions>().toMatchTypeOf<{ transport: MicroserviceTransport }>();
    expectTypeOf<MicroserviceModuleOptions>().toHaveProperty('module');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().toHaveProperty('additionalExports');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().toHaveProperty('global');
    expectTypeOf<MicroserviceModuleRegistrationOptions>().toHaveProperty('providers');
    expectTypeOf<GrpcMicroserviceTransportOptions>().toHaveProperty('protoPath');
    expectTypeOf<KafkaMicroserviceTransportOptions>().toHaveProperty('consumer');
    expectTypeOf<MqttMicroserviceTransportOptions>().toHaveProperty('requestTimeoutMs');
    expectTypeOf<NatsMicroserviceTransportOptions>().toHaveProperty('client');
    expectTypeOf<RabbitMqMicroserviceTransportOptions>().toHaveProperty('consumer');
    expectTypeOf<RedisPubSubMicroserviceTransportOptions>().toHaveProperty('subscribeClient');
    expectTypeOf<RedisStreamsMicroserviceTransportOptions>().toHaveProperty('readerClient');
    expectTypeOf<RedisStreamClientLike>().toHaveProperty('xreadgroup');
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
