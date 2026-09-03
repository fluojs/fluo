import { describe, expect, it, vi } from 'vitest';

import { KafkaMicroserviceTransport } from './kafka-transport.js';
import { RabbitMqMicroserviceTransport } from './rabbitmq-transport.js';

class InMemoryBroker {
  private readonly listeners = new Map<string, Set<(message: string) => Promise<void> | void>>();

  async publish(channel: string, message: string): Promise<void> {
    const handlers = this.listeners.get(channel);

    if (!handlers) {
      return;
    }

    for (const handler of [...handlers]) {
      await handler(message);
    }
  }

  async subscribe(channel: string, handler: (message: string) => Promise<void> | void): Promise<void> {
    const handlers = this.listeners.get(channel) ?? new Set<(message: string) => Promise<void> | void>();
    handlers.add(handler);
    this.listeners.set(channel, handlers);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.listeners.delete(channel);
  }
}

function createKafkaTransport(broker: InMemoryBroker): KafkaMicroserviceTransport {
  return new KafkaMicroserviceTransport({
    consumer: {
      subscribe: async (topic, handler) => {
        await broker.subscribe(topic, handler);
      },
      unsubscribe: async (topic) => {
        await broker.unsubscribe(topic);
      },
    },
    producer: {
      publish: async (topic, message) => {
        await broker.publish(topic, message);
      },
    },
  });
}

function createRabbitMqTransport(broker: InMemoryBroker): RabbitMqMicroserviceTransport {
  return new RabbitMqMicroserviceTransport({
    consumer: {
      cancel: async (queue) => {
        await broker.unsubscribe(queue);
      },
      consume: async (queue, handler) => {
        await broker.subscribe(queue, handler);
      },
    },
    publisher: {
      publish: async (queue, message) => {
        await broker.publish(queue, message);
      },
    },
  });
}

describe('Kafka and RabbitMQ event handler failure signals', () => {
  it('reports Kafka event handler failures to the configured logger while preserving broker rejection', async () => {
    const broker = new InMemoryBroker();
    const transport = createKafkaTransport(broker);
    const logger = { error: vi.fn() };

    transport.setLogger(logger);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('kafka event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('kafka event failed');

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'kafka event failed' }),
      'KafkaMicroserviceTransport',
    );

    await transport.close();
  });

  it('reports RabbitMQ event handler failures to the configured logger while preserving broker rejection', async () => {
    const broker = new InMemoryBroker();
    const transport = createRabbitMqTransport(broker);
    const logger = { error: vi.fn() };

    transport.setLogger(logger);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('rabbitmq event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('rabbitmq event failed');

    expect(logger.error).toHaveBeenCalledWith(
      'Event handler failed.',
      expect.objectContaining({ message: 'rabbitmq event failed' }),
      'RabbitMqMicroserviceTransport',
    );

    await transport.close();
  });

  it('does not fall back to console.error for Kafka event failures without a logger', async () => {
    const broker = new InMemoryBroker();
    const transport = createKafkaTransport(broker);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('kafka event failed without logger');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('kafka event failed without logger');

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await transport.close();
  });

  it('does not fall back to console.error for RabbitMQ event failures without a logger', async () => {
    const broker = new InMemoryBroker();
    const transport = createRabbitMqTransport(broker);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('rabbitmq event failed without logger');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('rabbitmq event failed without logger');

    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
    await transport.close();
  });

  it('keeps Kafka request-handler errors as error responses without logging them as event failures', async () => {
    const broker = new InMemoryBroker();
    const transport = createKafkaTransport(broker);
    const logger = { error: vi.fn() };

    transport.setLogger(logger);

    await transport.listen(async () => {
      throw new Error('kafka message failed');
    });

    await expect(transport.send('audit.value', { value: 1 })).rejects.toThrow('kafka message failed');

    expect(logger.error).not.toHaveBeenCalled();

    await transport.close();
  });

  it('keeps RabbitMQ request-handler errors as error responses without logging them as event failures', async () => {
    const broker = new InMemoryBroker();
    const transport = createRabbitMqTransport(broker);
    const logger = { error: vi.fn() };

    transport.setLogger(logger);

    await transport.listen(async () => {
      throw new Error('rabbitmq message failed');
    });

    await expect(transport.send('audit.value', { value: 1 })).rejects.toThrow('rabbitmq message failed');

    expect(logger.error).not.toHaveBeenCalled();

    await transport.close();
  });

  it('preserves the Kafka event failure when the configured logger itself throws', async () => {
    const broker = new InMemoryBroker();
    const transport = createKafkaTransport(broker);

    transport.setLogger({
      error: () => {
        throw new Error('logger exploded');
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('kafka event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('kafka event failed');

    await transport.close();
  });

  it('preserves the RabbitMQ event failure when the configured logger itself throws', async () => {
    const broker = new InMemoryBroker();
    const transport = createRabbitMqTransport(broker);

    transport.setLogger({
      error: () => {
        throw new Error('logger exploded');
      },
    });

    await transport.listen(async (packet) => {
      if (packet.kind === 'event') {
        throw new Error('rabbitmq event failed');
      }

      return undefined;
    });

    await expect(transport.emit('audit.value', { value: 9 })).rejects.toThrow('rabbitmq event failed');

    await transport.close();
  });
});
