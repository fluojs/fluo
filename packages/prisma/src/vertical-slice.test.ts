import { describe, expect, it } from 'vitest';

import { Inject } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import {
  Controller,
  FromBody,
  Post,
  RequestDto,
  HttpCode,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@fluojs/http';

import { PrismaModule, PrismaService, Transaction } from './index.js';

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
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(input: CreateUserRequest) {
        return (this.prisma as unknown as typeof client).user.create({
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

      @((Transaction as any)())
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

    const app = await bootstrapApplication({ rootModule: AppModule });
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

    await app.close();
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
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(input: CreateUserRequest) {
        return (this.prisma as unknown as typeof client).user.create({ data: input });
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
      @((Transaction as any)())
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

    const app = await bootstrapApplication({ rootModule: AppModule });
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

    await app.close();
  });
});
