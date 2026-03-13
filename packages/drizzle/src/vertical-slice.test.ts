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
  SuccessStatus,
  UseInterceptor,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@konekti/http';

import { createDrizzleModule, DrizzleDatabase, DrizzleTransactionInterceptor } from './index';

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
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    setStatus(code: number) {
      this.statusCode = code;
    },
    statusCode: 200,
  };
}

function createRequest(
  path: string,
  method: FrameworkRequest['method'],
  body?: unknown,
): FrameworkRequest {
  return {
    body,
    cookies: {},
    headers: {},
    method,
    params: {},
    path,
    query: {},
    raw: {},
    url: path,
  };
}

describe('@konekti/drizzle vertical slice', () => {
  it('propagates transaction handles through the request interceptor path', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    let sequence = 0;

    const transactionDatabase = {
      users: {
        async findById(id: string) {
          events.push(`tx:find:${id}`);
          return users.get(id) ?? null;
        },
        async insert(value: { email: string; name: string }) {
          events.push(`tx:insert:${value.email}`);
          const record = {
            ...value,
            id: `user-${++sequence}`,
          };
          users.set(record.id, record);
          return record;
        },
      },
    };
    const database = {
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        try {
          return await callback(transactionDatabase);
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        } finally {
          events.push('transaction:end');
        }
      },
      users: {
        async findById(id: string) {
          events.push(`root:find:${id}`);
          return users.get(id) ?? null;
        },
        async insert(value: { email: string; name: string }) {
          events.push(`root:insert:${value.email}`);
          const record = {
            ...value,
            id: `user-${++sequence}`,
          };
          users.set(record.id, record);
          return record;
        },
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    class GetUserRequest {
      @FromPath('id')
      id = '';
    }

    @Inject([DrizzleDatabase])
    class UserRepository {
      constructor(private readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase>) {}

      async create(input: CreateUserRequest) {
        const current = this.db.current();

        return current.users.insert({
          email: input.email,
          name: input.name,
        });
      }

      async findById(id: string) {
        const current = this.db.current();

        return current.users.findById(id);
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
      @SuccessStatus(201)
      @Post('/')
      @UseInterceptor(DrizzleTransactionInterceptor)
      async create(input: CreateUserRequest) {
        return this.users.create(input);
      }

      @RequestDto(GetUserRequest)
      @Get('/:id')
      @UseInterceptor(DrizzleTransactionInterceptor)
      async getOne(input: GetUserRequest) {
        return this.users.get(input.id);
      }
    }

    const DrizzleModule = createDrizzleModule<typeof database, typeof transactionDatabase>({
      database,
      dispose() {
        events.push('dispose');
      },
    });

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [DrizzleModule],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({
      mode: 'test',
      rootModule: AppModule,
    });

    const createResponseOk = createResponse(events);
    await app.dispatch(createRequest('/users', 'POST', { email: 'ada@example.com', name: 'Ada' }), createResponseOk);

    expect(createResponseOk.body).toEqual({ email: 'ada@example.com', id: 'user-1', name: 'Ada' });
    expect(events).toEqual(['transaction:start', 'tx:insert:ada@example.com', 'response:send', 'transaction:end']);

    const getResponseOk = createResponse(events);
    await app.dispatch(createRequest('/users/user-1', 'GET'), getResponseOk);

    expect(getResponseOk.body).toEqual({ email: 'ada@example.com', id: 'user-1', name: 'Ada' });
    expect(events).toEqual([
      'transaction:start',
      'tx:insert:ada@example.com',
      'response:send',
      'transaction:end',
      'transaction:start',
      'tx:find:user-1',
      'response:send',
      'transaction:end',
    ]);

    const getResponseMissing = createResponse(events);
    await app.dispatch(createRequest('/users/missing', 'GET'), getResponseMissing);

    expect(getResponseMissing.statusCode).toBe(404);
    expect(events).toEqual([
      'transaction:start',
      'tx:insert:ada@example.com',
      'response:send',
      'transaction:end',
      'transaction:start',
      'tx:find:user-1',
      'response:send',
      'transaction:end',
      'transaction:start',
      'tx:find:missing',
      'transaction:rollback',
      'transaction:end',
      'response:send',
    ]);

    await app.close();

    expect(events).toContain('dispose');
  });
});
