import { Inject } from '@fluojs/core';
import {
  type CallHandler,
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  FromBody,
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

  it('forwards the dispatched request abort signal through an application-owned order boundary', async () => {
    // Given
    const events: string[] = [];
    let notifyOrderStarted: () => void = () => undefined;
    let releaseOrder: () => void = () => undefined;
    let notifyOrderFinished: () => void = () => undefined;
    let notifyTransactionAbort: () => void = () => undefined;
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
    const app = await FluoFactory.create(AppModule);
    const prisma = await app.container.resolve(PrismaService<typeof client, typeof transactionClient>);
    const requestTransaction = vi.spyOn(prisma, 'requestTransaction');
    const controller = new AbortController();
    const request = createRequest('/orders', 'POST', undefined, {}, controller.signal);

    try {
      const response = createResponse(events);
      const dispatch = app.dispatch(request, response);
      await orderStarted;

      // When
      controller.abort();
      await transactionAbortObserved;

      // Then
      await expect(dispatch).resolves.toBeUndefined();
      expect(requestTransaction).toHaveBeenCalledTimes(1);
      expect(requestTransaction.mock.calls[0]?.[1]).toBe(request.signal);
      expect(events).toEqual([
        'connect',
        'transaction:start',
        'orders:start:transaction',
        'transaction:abort',
        'transaction:end',
      ]);

      releaseOrder();
      await orderFinished;
      expect(events.at(-1)).toBe('orders:end');
    } finally {
      releaseOrder();
      await app.close();
    }
  });
});
