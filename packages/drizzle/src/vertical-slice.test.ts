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

import { DrizzleModule, DrizzleDatabase, Transaction, type DrizzleDatabaseFacade } from './index.js';

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
  signal?: AbortSignal,
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
    signal,
    url: path,
  };
}

describe('@fluojs/drizzle service boundary primary flow', () => {
  it('commits a service-layer transaction while the controller only delegates', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    let sequence = 0;

    const transactionDatabase = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`tx:insert:${value.email}`);
            const record = { ...value, id: `user-${++sequence}` };
            users.set(record.id, record);
            return record;
          },
        };
      },
    };
    const database = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`root:insert:${value.email}`);
            return { ...value, id: 'root-user' };
          },
        };
      },
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:commit');
        return result;
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabaseFacade<typeof database, typeof transactionDatabase>) {}

      async create(input: CreateUserRequest) {
        return this.db.insert('users').values({
          email: input.email,
          name: input.name,
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

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database })],
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
    expect(events).toEqual(['transaction:start', 'tx:insert:ada@example.com', 'transaction:commit', 'response:send']);

    await app.close();
  });

  it('keeps controller-level method decoration as a compatibility path only', async () => {
    const events: string[] = [];
    const transactionDatabase = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`tx:insert:${value.email}`);
            return { ...value, id: 'controller-tx-user' };
          },
        };
      },
    };
    const database = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`root:insert:${value.email}`);
            return { ...value, id: 'root-user' };
          },
        };
      },
      async transaction<T>(callback: (value: typeof transactionDatabase) => Promise<T>): Promise<T> {
        events.push('transaction:start');
        const result = await callback(transactionDatabase);
        events.push('transaction:commit');
        return result;
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabaseFacade<typeof database, typeof transactionDatabase>) {}

      async create(input: CreateUserRequest) {
        return this.db.insert('users').values(input);
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
    @Inject(UserService, DrizzleDatabase)
    class UsersController {
      constructor(
        private readonly users: UserService,
        readonly db: DrizzleDatabase<typeof database, typeof transactionDatabase>,
      ) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      @Transaction()
      async create(input: CreateUserRequest) {
        void this.db;

        return this.users.create(input);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [DrizzleModule.forRoot<typeof database, typeof transactionDatabase>({ database })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const response = createResponse(events);

    await app.dispatch(
      createRequest('/controller-compat/users', 'POST', { email: 'grace@example.com', name: 'Grace' }),
      response,
    );

    expect(response.body).toEqual({ email: 'grace@example.com', id: 'controller-tx-user', name: 'Grace' });
    expect(events).toEqual(['transaction:start', 'tx:insert:grace@example.com', 'transaction:commit', 'response:send']);

    await app.close();
  });
});
