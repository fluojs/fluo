import { describe, expect, it } from 'vitest';

import { Inject, defineControllerMetadata, defineModuleMetadata } from '@konekti/core';
import { bootstrapApplication, KonektiFactory } from '@konekti/runtime';

import { EventPattern, MessagePattern } from './decorators.js';
import { createMicroservicesModule } from './module.js';
import { MICROSERVICE } from './tokens.js';
import { RedisPubSubMicroserviceTransport } from './redis-transport.js';
import { TcpMicroserviceTransport } from './tcp-transport.js';
import type { MicroserviceTransport, TransportHandler } from './types.js';

class InMemoryPubSubRedisClient {
  private static subscriptions = new Map<string, Set<InMemoryPubSubRedisClient>>();

  private readonly listeners = new Set<(channel: string, message: string) => void>();
  private readonly subscribed = new Set<string>();

  on(event: 'message', listener: (channel: string, message: string) => void): void {
    if (event === 'message') {
      this.listeners.add(listener);
    }
  }

  async publish(channel: string, message: string): Promise<number> {
    const clients = InMemoryPubSubRedisClient.subscriptions.get(channel);

    if (!clients || clients.size === 0) {
      return 0;
    }

    for (const client of clients) {
      client.emitMessage(channel, message);
    }

    return clients.size;
  }

  async subscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.subscribed.add(channel);
      const bucket = InMemoryPubSubRedisClient.subscriptions.get(channel) ?? new Set<InMemoryPubSubRedisClient>();
      bucket.add(this);
      InMemoryPubSubRedisClient.subscriptions.set(channel, bucket);
    }
  }

  async unsubscribe(...channels: string[]): Promise<void> {
    for (const channel of channels) {
      this.subscribed.delete(channel);
      const bucket = InMemoryPubSubRedisClient.subscriptions.get(channel);

      if (!bucket) {
        continue;
      }

      bucket.delete(this);

      if (bucket.size === 0) {
        InMemoryPubSubRedisClient.subscriptions.delete(channel);
      }
    }
  }

  private emitMessage(channel: string, message: string): void {
    for (const listener of this.listeners) {
      listener(channel, message);
    }
  }
}

class InMemoryLoopbackTransport implements MicroserviceTransport {
  private handler: TransportHandler | undefined;

  async listen(handler: TransportHandler): Promise<void> {
    this.handler = handler;
  }

  async send(pattern: string, payload: unknown): Promise<unknown> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    return await this.handler({ kind: 'message', pattern, payload });
  }

  async emit(pattern: string, payload: unknown): Promise<void> {
    if (!this.handler) {
      throw new Error('Transport handler is not listening.');
    }

    await this.handler({ kind: 'event', pattern, payload });
  }

  async close(): Promise<void> {
    this.handler = undefined;
  }
}

describe('@konekti/microservices', () => {
  it('supports createMicroservice with message and event handlers', async () => {
    class Store {
      createdEvents: string[] = [];
    }

    @Inject([Store])
    class UserHandlers {
      constructor(private readonly store: Store) {}

      @MessagePattern('user.create')
      createUser(input: { name: string }) {
        return { id: `${input.name}-id` };
      }

      @EventPattern(/^user\./)
      onUserEvent(input: { name: string }) {
        this.store.createdEvents.push(input.name);
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      providers: [Store, UserHandlers],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
      mode: 'test',
    });

    await microservice.listen();
    const response = await microservice.send('user.create', { name: 'ayden' });
    await microservice.emit('user.created', { name: 'ayden' });

    const store = await microservice.get(Store);
    expect(response).toEqual({ id: 'ayden-id' });
    expect(store.createdEvents).toEqual(['ayden']);

    await microservice.close();
  });

  it('handles TCP transport send and receive', async () => {
    const port = 39001;
    const transport = new TcpMicroserviceTransport({ port });

    class Handler {
      @MessagePattern('math.sum')
      sum(input: { a: number; b: number }) {
        return input.a + input.b;
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      providers: [Handler],
    });

    const app = await bootstrapApplication({ mode: 'test', rootModule: AppModule });
    const microservice = await app.container.resolve<{ listen(): Promise<void>; send(pattern: string, payload: unknown): Promise<unknown>; close(): Promise<void> }>(MICROSERVICE);

    await microservice.listen();
    await expect(microservice.send('math.sum', { a: 3, b: 4 })).resolves.toBe(7);

    await app.close();
  });

  it('handles Redis pubsub transport publish/subscribe and regex pattern matching', async () => {
    const publishClient = new InMemoryPubSubRedisClient();
    const subscribeClient = new InMemoryPubSubRedisClient();
    const transport = new RedisPubSubMicroserviceTransport({
      publishClient,
      subscribeClient,
    });

    class Store {
      events: string[] = [];
    }

    @Inject([Store])
    class Handler {
      constructor(private readonly store: Store) {}

      @EventPattern(/^audit\./)
      onAudit(input: { message: string }) {
        this.store.events.push(input.message);
      }
    }

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      providers: [Store, Handler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, { mode: 'test' });

    await microservice.listen();

    await expect(microservice.send('calc.double', { value: 21 })).rejects.toThrow(
      'does not support request/reply send()',
    );
    await microservice.emit('audit.login', { message: 'ok' });

    const store = await microservice.get(Store);
    expect(store.events).toEqual(['ok']);

    await microservice.close();
  });

  it('discovers controller handlers and supports global regex patterns repeatedly', async () => {
    class Store {
      count = 0;
      message = '';
    }

    @Inject([Store])
    class ControllerLikeHandler {
      constructor(private readonly store: Store) {}

      @EventPattern(/^audit\./g)
      onAuditEvent(input: { message: string }) {
        this.store.count += 1;
        this.store.message = input.message;
      }
    }

    defineControllerMetadata(ControllerLikeHandler, { basePath: '/micro' });

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      controllers: [ControllerLikeHandler],
      providers: [Store],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
      mode: 'test',
    });

    await microservice.listen();
    await microservice.emit('audit.login', { message: 'one' });
    await microservice.emit('audit.logout', { message: 'two' });

    const store = await microservice.get(Store);
    expect(store.count).toBe(2);
    expect(store.message).toBe('two');

    await microservice.close();
  });

  it('isolates payload mutations across event handlers and caller payloads', async () => {
    class Store {
      firstSeen = '';
      secondSeen = '';
    }

    @Inject([Store])
    class FirstHandler {
      constructor(private readonly store: Store) {}

      @EventPattern('audit.mutation')
      onAudit(input: { meta: { role: string } }) {
        this.store.firstSeen = input.meta.role;
        input.meta.role = 'changed';
      }
    }

    @Inject([Store])
    class SecondHandler {
      constructor(private readonly store: Store) {}

      @EventPattern('audit.mutation')
      onAudit(input: { meta: { role: string } }) {
        this.store.secondSeen = input.meta.role;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      providers: [Store, FirstHandler, SecondHandler],
    });

    const microservice = await KonektiFactory.createMicroservice(AppModule, {
      mode: 'test',
    });
    const payload = { meta: { role: 'original' } };

    await microservice.listen();
    await microservice.emit('audit.mutation', payload);

    const store = await microservice.get(Store);
    expect(store.firstSeen).toBe('original');
    expect(store.secondSeen).toBe('original');
    expect(payload.meta.role).toBe('original');

    await microservice.close();
  });

  it('shares singleton provider state in hybrid app + microservice composition', async () => {
    class SharedState {
      count = 0;
    }

    @Inject([SharedState])
    class HybridHandlers {
      constructor(private readonly state: SharedState) {}

      @EventPattern('hybrid.event')
      onHybridEvent() {
        this.state.count += 1;
      }
    }

    const transport = new InMemoryLoopbackTransport();

    class AppModule {}
    defineModuleMetadata(AppModule, {
      imports: [createMicroservicesModule({ transport })],
      providers: [SharedState, HybridHandlers],
    });

    const app = await KonektiFactory.create(AppModule, {
      mode: 'test',
    });
    const microservice = await app.container.resolve<{
      emit(pattern: string, payload: unknown): Promise<void>;
      listen(): Promise<void>;
    }>(MICROSERVICE);

    await Promise.all([app.listen(), microservice.listen()]);
    await microservice.emit('hybrid.event', {});

    const state = await app.container.resolve(SharedState);
    expect(state.count).toBe(1);

    await app.close();
  });
});
