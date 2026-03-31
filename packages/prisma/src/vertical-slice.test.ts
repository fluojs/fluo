import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti/runtime';
import {
  Controller,
  FromBody,
  FromPath,
  Get,
  NotFoundException,
  Post,
  RequestDto,
  HttpCode,
  UseInterceptors,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@konekti/http';
import { IsString, MinLength } from '@konekti/validation';

import { createPrismaModule, PrismaService, PrismaTransactionInterceptor } from './index.js';

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

describe('@konekti/prisma vertical slice', () => {
  it('handles request DTO binding, validation, persistence, and canonical responses end-to-end', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    let sequence = 0;
    const events: string[] = [];
    let resolveAbortCreate!: () => void;
    const abortCreateReached = new Promise<void>((resolve) => {
      resolveAbortCreate = resolve;
    });

    const transactionClient = {
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`tx:create:${input.data.email}`);

          if (input.data.email === 'abort@example.com') {
            resolveAbortCreate();
            return new Promise<never>(() => undefined);
          }

          const record = {
            email: input.data.email,
            id: `user-${++sequence}`,
            name: input.data.name,
          };

          users.set(record.id, record);
          return record;
        },
        async findUnique(input: { where: { id: string } }) {
          events.push(`tx:find:${input.where.id}`);
          return users.get(input.where.id) ?? null;
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
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>) {
        events.push('transaction:start');
        try {
          return await callback(transactionClient);
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
      user: {
        async create(input: { data: { email: string; name: string } }) {
          events.push(`root:create:${input.data.email}`);
          const record = {
            email: input.data.email,
            id: `user-${++sequence}`,
            name: input.data.name,
          };

          users.set(record.id, record);
          return record;
        },
        async findUnique(input: { where: { id: string } }) {
          events.push(`root:find:${input.where.id}`);
          return users.get(input.where.id) ?? null;
        },
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'email is required' })
      email = '';

      @FromBody('name')
      @IsString()
      @MinLength(1, { code: 'REQUIRED', message: 'name is required' })
      name = '';
    }

    class GetUserRequest {
      @FromPath('id')
      id = '';
    }

    @Inject([PrismaService])
    class UserRepository {
      constructor(private readonly prisma: PrismaService<typeof client, typeof transactionClient>) {}

      async create(input: CreateUserRequest) {
        return this.prisma.transaction(async () => {
          const current = this.prisma.current();

          return current.user.create({
            data: {
              email: input.email,
              name: input.name,
            },
          });
        });
      }

      async findById(id: string) {
        const current = this.prisma.current();

        return current.user.findUnique({ where: { id } });
      }
    }

    @Inject([UserRepository])
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      async create(input: CreateUserRequest) {
        return this.repo.create(input);
      }

      async get(id: string) {
        const user = await this.repo.findById(id);

        if (!user) {
          throw new NotFoundException(`User ${id} was not found.`);
        }

        return user;
      }
    }

    @Controller('/users')
    @Inject([UserService])
    class UsersController {
      constructor(private readonly users: UserService) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      @UseInterceptors(PrismaTransactionInterceptor)
      async create(input: CreateUserRequest) {
        return this.users.create(input);
      }

      @RequestDto(GetUserRequest)
      @Get('/:id')
      @UseInterceptors(PrismaTransactionInterceptor)
      async getOne(input: GetUserRequest) {
        return this.users.get(input.id);
      }
    }

    const PrismaModule = createPrismaModule<typeof client, typeof transactionClient>({ client });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [PrismaModule],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({
      rootModule: AppModule,
    });

    expect(events).toEqual(['connect']);

    const createResponseOk = createResponse(events);
    await app.dispatch(
      createRequest('/users', 'POST', {
        email: 'ada@example.com',
        name: 'Ada',
      }),
      createResponseOk,
    );

    expect(createResponseOk.statusCode).toBe(201);
    expect(createResponseOk.body).toEqual({
      email: 'ada@example.com',
      id: 'user-1',
      name: 'Ada',
    });
    expect(events).toEqual([
      'connect',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'response:send',
    ]);

    const createResponseError = createResponse(events);
    await app.dispatch(
      createRequest('/users', 'POST', {
        email: 'ada@example.com',
        name: '',
      }, { 'x-request-id': 'req-prisma-400' }),
      createResponseError,
    );

    expect(createResponseError.statusCode).toBe(400);
    expect(createResponseError.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        details: [
          {
            code: 'REQUIRED',
            field: 'name',
            message: 'name is required',
            source: 'body',
          },
        ],
        message: 'Validation failed.',
        meta: undefined,
        requestId: 'req-prisma-400',
        status: 400,
      },
    });
    expect(events).toEqual([
      'connect',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'response:send',
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'response:send',
    ]);

    const getResponseOk = createResponse(events);
    await app.dispatch(createRequest('/users/user-1', 'GET'), getResponseOk);

    expect(getResponseOk.statusCode).toBe(200);
    expect(getResponseOk.body).toEqual({
      email: 'ada@example.com',
      id: 'user-1',
      name: 'Ada',
    });
    expect(events).toEqual([
      'connect',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'response:send',
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:find:user-1',
      'transaction:end',
      'response:send',
    ]);

    const getResponseMissing = createResponse(events);
    await app.dispatch(createRequest('/users/missing', 'GET', undefined, { 'x-request-id': 'req-prisma-404' }), getResponseMissing);

    expect(getResponseMissing.statusCode).toBe(404);
    expect(getResponseMissing.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        details: undefined,
        message: 'User missing was not found.',
        meta: undefined,
        requestId: 'req-prisma-404',
        status: 404,
      },
    });

    expect(events).toEqual([
      'connect',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'response:send',
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:find:user-1',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:find:missing',
      'transaction:rollback',
      'transaction:end',
      'response:send',
    ]);

    const abortController = new AbortController();
    const abortResponse = createResponse(events);
    const abortDispatch = app.dispatch(
      createRequest(
        '/users',
        'POST',
        {
          email: 'abort@example.com',
          name: 'Ada',
        },
        {},
        abortController.signal,
      ),
      abortResponse,
    );
    await abortCreateReached;
    abortController.abort(new Error('client aborted request'));
    await abortDispatch;

    expect(abortResponse.committed).toBe(false);

    expect(users.get('user-1')).toEqual({
      email: 'ada@example.com',
      id: 'user-1',
      name: 'Ada',
    });

    await app.close();

    expect(events).toEqual([
      'connect',
      'transaction:start',
      'tx:create:ada@example.com',
      'transaction:end',
      'response:send',
      'transaction:start',
      'transaction:rollback',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:find:user-1',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:find:missing',
      'transaction:rollback',
      'transaction:end',
      'response:send',
      'transaction:start',
      'tx:create:abort@example.com',
      'transaction:rollback',
      'transaction:end',
      'disconnect',
    ]);
  });
});
