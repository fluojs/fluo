/**
 * Guide-backed composition evidence for `@fluojs/microservices`
 * (`apps/docs/content/docs/packages/microservices.mdx`).
 *
 * All transport traffic here is native: the TCP transport serves real
 * newline-delimited JSON frames over real `node:net` sockets, and the mixed
 * app composes the microservice runtime with the real Node HTTP adapter.
 * No sleeps: handler completion is observed through deferred barriers and
 * awaited RPC responses, and every app is closed in `finally`.
 */
import type { AddressInfo } from 'node:net';

import { Inject, InvariantError, Module, Scope } from '@fluojs/core';
import { Controller, FromBody, Post, RequestDto } from '@fluojs/http';
import { EventPattern, type Microservice, MICROSERVICE, MessagePattern, MicroserviceLifecycleService, MicroservicesModule } from '@fluojs/microservices';
import { TcpMicroserviceTransport } from '@fluojs/microservices/tcp';
import { NodeHttpApplicationAdapter, createConsoleApplicationLogger } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { AppModule, AuditLog, MathHandlers } from './microservices-guide-app';

function getBoundPort(adapter: NodeHttpApplicationAdapter): number {
  const server = adapter.getServer();

  if (!server) {
    throw new Error('Expected the Node HTTP adapter to expose its server after listen().');
  }

  const address = server.address() as AddressInfo;

  return address.port;
}

describe('microservices guide fixtures', () => {
  it('serves request-response and events through the guide TCP app and reports status', async () => {
    const microservice = await FluoFactory.createMicroservice(AppModule);
    const audit = await microservice.get(AuditLog);
    const facade = await microservice.get<Microservice>(MICROSERVICE);

    try {
      await microservice.listen();

      // Request-response through the real TCP loopback.
      await expect(microservice.send('math.sum', { a: 3, b: 4 })).resolves.toBe(7);

      const lifecycle = await microservice.get(MicroserviceLifecycleService);
      const snapshot = lifecycle.createPlatformStatusSnapshot();
      const details = snapshot.details as {
        handlerCounts: Record<'event' | 'message', number>;
        lifecycleState: string;
        transportOwnsResources: boolean;
      };
      expect(snapshot.readiness.status).toBe('ready');
      expect(details.handlerCounts.message).toBe(1);
      expect(details.handlerCounts.event).toBe(1);
      expect(details.transportOwnsResources).toBe(true);

      // Unmatched patterns reject deterministically.
      await expect(microservice.send('math.missing', {})).rejects.toThrow(
        'No message handler registered for pattern "math.missing".',
      );

      await microservice.close();

      // Shutdown is terminal for facade calls.
      await expect(facade.send('math.sum', { a: 1, b: 2 })).rejects.toThrow(InvariantError);
    } finally {
      await microservice.close();
      void audit;
    }
  });

  it('dispatches events to a barrier-gated handler', async () => {
    const handled = { notify: (): void => {} };
    const barrier = new Promise<void>((resolve) => {
      handled.notify = resolve;
    });

    class EventStore {
      readonly messages: string[] = [];
    }

    @Inject(EventStore)
    class BarrierHandlers {
      constructor(private readonly store: EventStore) {}

      @MessagePattern('barrier.ping')
      ping(): boolean {
        return true;
      }

      @EventPattern('audit.fixtures')
      onAudit(input: { message: string }): void {
        this.store.messages.push(input.message);
        handled.notify();
      }
    }

    @Module({
      imports: [MicroservicesModule.forRoot({ transport: TcpMicroserviceTransport.create({ port: 0 }) })],
      providers: [EventStore, BarrierHandlers],
    })
    class BarrierAppModule {}

    const microservice = await FluoFactory.createMicroservice(BarrierAppModule);

    try {
      await microservice.listen();
      await microservice.emit('audit.fixtures', { message: 'hello event' });
      await barrier;

      const store = await microservice.get(EventStore);
      expect(store.messages).toEqual(['hello event']);
    } finally {
      await microservice.close();
    }
  });

  it('gives request-scoped handlers a fresh scope per message', async () => {
    @Scope('request')
    class CounterHandler {
      count = 0;

      @MessagePattern('counter.bump')
      bump(): number {
        return (this.count += 1);
      }
    }

    @Module({
      imports: [MicroservicesModule.forRoot({ transport: TcpMicroserviceTransport.create({ port: 0 }) })],
      providers: [CounterHandler],
    })
    class ScopedAppModule {}

    const microservice = await FluoFactory.createMicroservice(ScopedAppModule);

    try {
      await microservice.listen();

      await expect(microservice.send('counter.bump', {})).resolves.toBe(1);
      await expect(microservice.send('counter.bump', {})).resolves.toBe(1);
    } finally {
      await microservice.close();
    }
  });

  it('composes the microservice runtime with the Node HTTP adapter and DI', async () => {
    class SumDto {
      @FromBody()
      a = 0;

      @FromBody()
      b = 0;
    }

    @Inject(MICROSERVICE)
    @Controller('/math')
    class MathController {
      constructor(private readonly microservice: Microservice) {}

      @Post('/sum')
      @RequestDto(SumDto)
      async sum(input: SumDto): Promise<{ sum: unknown }> {
        return { sum: await this.microservice.send('math.sum', { a: input.a, b: input.b }) };
      }
    }

    @Module({
      imports: [MicroservicesModule.forRoot({ transport: TcpMicroserviceTransport.create({ port: 0 }) })],
      controllers: [MathController],
      // The TCP transport routes outbound facade calls back to its own
      // listener, so the pattern handlers live in the same module graph (this
      // mirrors the `fluo new --shape mixed` starter).
      providers: [AuditLog, MathHandlers],
    })
    class MixedAppModule {}

    const adapter = NodeHttpApplicationAdapter.create({ port: 0 });
    const app = await FluoFactory.create(MixedAppModule, {
      adapter,
      cors: false,
      logger: createConsoleApplicationLogger(),
    });

    try {
      // Connect the microservice runtime to the HTTP application shell, start
      // its listener, then serve HTTP that calls back into MICROSERVICE.
      await app.connectMicroservice();
      await app.startAllMicroservices();
      await app.listen();

      const response = await fetch(`http://127.0.0.1:${String(getBoundPort(adapter))}/math/sum`, {
        body: JSON.stringify({ a: 6, b: 8 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ sum: 14 });
    } finally {
      await app.close();
    }
  });
});
