import { createServer, request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Inject } from '@fluojs/core';
import {
  type CallHandler,
  Controller,
  type Dispatcher,
  type FrameworkRequest,
  type FrameworkResponse,
  FromBody,
  type HttpApplicationAdapter,
  HttpCode,
  type Interceptor,
  type InterceptorContext,
  Post,
  RequestDto,
  UseInterceptors,
} from '@fluojs/http';
import { defineModule, FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import {
  PrismaModule,
  PrismaService,
  type PrismaServiceFacade,
  Transaction,
} from './index.js';

function createResponse(events?: string[]): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
      events?.push('response:send');
      this.body = body;
      this.committed = true;
    },
    setHeader(name: string, value: string | string[]) {
      const headers = this.headers as Record<string, string | string[]>;
      headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
      this.statusSet = true;
    },
    statusCode: undefined,
    statusSet: false,
  };
}

function createRequest(
  path: string,
  method: FrameworkRequest['method'],
  body?: unknown,
  headers: FrameworkRequest['headers'] = {},
  signal?: AbortSignal,
): FrameworkRequest {
  return {
    body,
    cookies: {},
    headers,
    method,
    params: {},
    path,
    query: {},
    raw: {},
    signal,
    url: path,
  };
}

function getBoundPort(server: unknown): number {
  if (!server || typeof (server as { address?: unknown }).address !== 'function') {
    throw new Error('Failed to resolve the Node HTTP test server.');
  }

  const address = (server as { address(): AddressInfo | string | null }).address();

  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve the Node HTTP test port.');
  }

  return address.port;
}

function createNodeHttpTestAdapter(
  onFrameworkRequest?: (frameworkRequest: FrameworkRequest) => void,
): HttpApplicationAdapter & { getServer(): unknown } {
  let server: ReturnType<typeof createServer> | undefined;

  return {
    async close() {
      if (!server) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server?.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    getServer() {
      return server;
    },
    async listen(dispatcher: Dispatcher) {
      server = createServer((request, response) => {
        const controller = new AbortController();
        const abort = () => {
          if (!controller.signal.aborted) {
            controller.abort();
          }
        };
        request.once('aborted', abort);
        response.once('close', () => {
          if (!response.writableEnded) {
            abort();
          }
        });

        const frameworkRequest = createRequest(
          request.url ?? '/',
          request.method ?? 'GET',
          undefined,
          request.headers,
          controller.signal,
        );
        onFrameworkRequest?.(frameworkRequest);
        const frameworkResponse = createResponse();
        void dispatcher.dispatch(
          frameworkRequest,
          frameworkResponse,
        ).then(() => {
          if (response.destroyed) {
            return;
          }

          response.statusCode = frameworkResponse.statusCode ?? 200;
          response.end();
        });
      });

      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(0, '127.0.0.1', resolve);
      });
    },
  };
}

describe('@fluojs/prisma service boundary primary flow', () => {
  it('commits a service-layer transaction while the controller only delegates', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    let sequence = 0;

    const transactionClient = {
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`tx:create:${input.data.email}`);
          const record = {
            email: input.data.email,
            id: `user-${++sequence}`,
            name: input.data.name,
          };

          users.set(record.id, record);
          return record;
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:commit');
        return result;
      },
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user', name: input.data.name };
        },
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(input: CreateUserRequest) {
        return this.prisma.user.create({
          data: {
            email: input.email,
            name: input.name,
          },
        });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async create(input: CreateUserRequest) {
        return this.repo.create(input);
      }
    }

    @Controller('/service-boundary/users')
    @Inject(UserService)
    class UsersController {
      constructor(private readonly users: UserService) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      async create(input: CreateUserRequest) {
        return this.users.create(input);
      }
    }

    const prismaModule = PrismaModule.forRoot<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [prismaModule],
      providers: [UserRepository, UserService],
    });

    const app = await FluoFactory.create(AppModule);

    try {
      const response = createResponse(events);

      await app.dispatch(
        createRequest('/service-boundary/users', 'POST', { email: 'ada@example.com', name: 'Ada' }),
        response,
      );

      expect(response.statusCode).toBe(201);
      expect(response.body).toEqual({ email: 'ada@example.com', id: 'user-1', name: 'Ada' });
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'tx:create:ada@example.com',
        'transaction:commit',
        'response:send',
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps controller-level method decoration as a compatibility path only', async () => {
    const events: string[] = [];
    const transactionClient = {
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`tx:create:${input.data.email}`);
          return { email: input.data.email, id: 'controller-tx-user', name: input.data.name };
        },
      },
    };
    const client = {
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionClient);
        events.push('transaction:commit');
        return result;
      },
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`root:create:${input.data.email}`);
          return { email: input.data.email, id: 'root-user', name: input.data.name };
        },
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(PrismaService)
    class UserRepository {
      constructor(private readonly prisma: PrismaServiceFacade<typeof client, typeof transactionClient>) {}

      async create(input: CreateUserRequest) {
        return this.prisma.user.create({ data: input });
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      async create(input: CreateUserRequest) {
        return this.repo.create(input);
      }
    }

    @Controller('/controller-compat/users')
    @Inject(UserService, PrismaService)
    class UsersController {
      constructor(
        private readonly users: UserService,
        readonly prisma: PrismaService<typeof client, typeof transactionClient>,
      ) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      @Transaction()
      async create(input: CreateUserRequest) {
        return this.users.create(input);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [PrismaModule.forRoot({ client })],
      providers: [UserRepository, UserService],
    });

    const app = await FluoFactory.create(AppModule);

    try {
      const response = createResponse(events);

      await app.dispatch(
        createRequest('/controller-compat/users', 'POST', { email: 'grace@example.com', name: 'Grace' }),
        response,
      );

      expect(response.body).toEqual({ email: 'grace@example.com', id: 'controller-tx-user', name: 'Grace' });
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'tx:create:grace@example.com',
        'transaction:commit',
        'response:send',
      ]);
    } finally {
      await app.close();
    }
  });

  it('forwards a real HTTP request abort signal through an application-owned order boundary', async () => {
    // Given
    const events: string[] = [];
    let notifyOrderStarted: () => void = () => undefined;
    let releaseOrder: () => void = () => undefined;
    let notifyOrderFinished: () => void = () => undefined;
    let notifyTransactionAbort: () => void = () => undefined;
    let notifyTransactionEnd: () => void = () => undefined;
    const orderStarted = new Promise<void>((resolve) => {
      notifyOrderStarted = resolve;
    });
    const orderReleased = new Promise<void>((resolve) => {
      releaseOrder = resolve;
    });
    const orderFinished = new Promise<void>((resolve) => {
      notifyOrderFinished = resolve;
    });
    const transactionAbortObserved = new Promise<void>((resolve) => {
      notifyTransactionAbort = resolve;
    });
    const transactionEnded = new Promise<void>((resolve) => {
      notifyTransactionEnd = resolve;
    });
    const transactionClient = { source: 'transaction' } as const;
    const client = {
      source: 'root' as const,
      async $connect() {
        events.push('connect');
      },
      async $disconnect() {
        events.push('disconnect');
      },
      async $transaction<T>(
        callback: (value: typeof transactionClient) => Promise<T>,
        options?: { signal?: AbortSignal },
      ): Promise<T> {
        events.push('transaction:start');
        const signal = options?.signal;
        const onAbort = () => {
          events.push('transaction:abort');
          notifyTransactionAbort();
        };
        signal?.addEventListener('abort', onAbort, { once: true });

        try {
          return await callback(transactionClient);
        } finally {
          signal?.removeEventListener('abort', onAbort);
          events.push('transaction:end');
          notifyTransactionEnd();
        }
      },
    };

    @Inject(PrismaService)
    class OrdersService {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create() {
        events.push(`orders:start:${this.prisma.current().source}`);
        notifyOrderStarted();
        await orderReleased;
        events.push('orders:end');
        notifyOrderFinished();
        return { id: 'order-1' };
      }
    }

    @Inject(PrismaService)
    class OrderRequestTransactionBoundary implements Interceptor {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      intercept(context: InterceptorContext, next: CallHandler): Promise<unknown> {
        return this.prisma.requestTransaction(() => next.handle(), context.requestContext.request.signal);
      }
    }

    @Controller('/orders')
    @Inject(OrdersService)
    class OrdersController {
      constructor(private readonly orders: OrdersService) {}

      @Post('/')
      @UseInterceptors(OrderRequestTransactionBoundary)
      createOrder() {
        return this.orders.create();
      }
    }

    class AppModule {}
    defineModule(AppModule, {
      controllers: [OrdersController],
      imports: [PrismaModule.forRoot({ client })],
      providers: [OrderRequestTransactionBoundary, OrdersService],
    });
    let frameworkRequestSignal: AbortSignal | undefined;
    const adapter = createNodeHttpTestAdapter((frameworkRequest) => {
      frameworkRequestSignal = frameworkRequest.signal;
    });
    const app = await FluoFactory.create(AppModule, { adapter });
    const prisma = await app.container.resolve(PrismaService<typeof client, typeof transactionClient>);
    const requestTransaction = vi.spyOn(prisma, 'requestTransaction');
    await app.listen();
    const request = httpRequest({
      host: '127.0.0.1',
      method: 'POST',
      path: '/orders',
      port: getBoundPort(adapter.getServer()),
    });

    try {
      request.on('error', () => undefined);
      request.end();
      await orderStarted;

      // When
      request.destroy();
      await transactionAbortObserved;

      // Then
      expect(requestTransaction).toHaveBeenCalledTimes(1);
      expect(requestTransaction.mock.calls[0]?.[1]).toBe(frameworkRequestSignal);
      expect(requestTransaction.mock.calls[0]?.[1]?.aborted).toBe(true);
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'orders:start:transaction',
        'transaction:abort',
      ]);

      releaseOrder();
      await orderFinished;
      await transactionEnded;
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'orders:start:transaction',
        'transaction:abort',
        'orders:end',
        'transaction:end',
      ]);
    } finally {
      request.destroy();
      releaseOrder();
      await app.close();
    }
  });
});
