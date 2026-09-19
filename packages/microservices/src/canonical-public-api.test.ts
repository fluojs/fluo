import { describe, expect, it } from 'vitest';

import * as microservices from './index.js';
import { TcpMicroserviceTransport } from './transports/tcp-transport.js';

describe('@fluojs/microservices canonical public API', () => {
  it('keeps registration on MicroservicesModule and transports on dedicated subpaths', () => {
    expect(microservices).toHaveProperty('MicroservicesModule');
    expect(microservices).not.toHaveProperty('createMicroservicesProviders');
    expect(microservices).toHaveProperty('MicroserviceLifecycleService');
    expect(microservices).not.toHaveProperty('TcpMicroserviceTransport');
    expect(microservices).not.toHaveProperty('RedisPubSubMicroserviceTransport');
    expect(microservices).not.toHaveProperty('RedisStreamsMicroserviceTransport');
    expect(microservices).not.toHaveProperty('NatsMicroserviceTransport');
    expect(microservices).not.toHaveProperty('KafkaMicroserviceTransport');
    expect(microservices).not.toHaveProperty('RabbitMqMicroserviceTransport');
    expect(microservices).not.toHaveProperty('GrpcMicroserviceTransport');
    expect(microservices).not.toHaveProperty('MqttMicroserviceTransport');
  });

  it('creates transports through their dedicated class factory without changing identity', async () => {
    const transport = TcpMicroserviceTransport.create({ port: 0 });

    expect(transport).toBeInstanceOf(TcpMicroserviceTransport);

    await transport.close();
  });
});
