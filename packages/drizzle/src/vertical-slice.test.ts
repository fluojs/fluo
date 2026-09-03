import { Inject } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  FromBody,
  HttpCode,
  Post,
  RequestDto,
  assertRequestContext,
  UseInterceptors,
} from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import {
  DrizzleDatabase,
  type DrizzleDatabaseFacade,
  DrizzleModule,
  DrizzleTransactionInterceptor,
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
    try {
      const response = createResponse(events);

      await app.dispatch(
        createRequest('/service-boundary/users', 'POST', { email: 'ada@example.com', name: 'Ada' }),
        response,
      );

      expect(response.statusCode).toBe(201);
      expect(response.body).toEqual({ email: 'ada@example.com', id: 'user-1', name: 'Ada' });
      expect(events).toEqual(['transaction:start', 'tx:insert:ada@example.com', 'transaction:commit', 'response:send']);
    } finally {
      await app.close();
    }
  });

  it('rolls back a staged service write when the service throws after it', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };
    type TransactionDatabase = {
      insert(_table: 'users'): {
        values(value: { email: string; name: string }): Promise<UserRecord>;
      };
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    let sequence = 0;
    const database = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`root:insert:${value.email}`);
            const record = { ...value, id: `root-user-${++sequence}` };
            users.set(record.id, record);
            return record;
          },
        };
      },
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        const stagedUsers = new Map<string, UserRecord>();
        const transactionDatabase: TransactionDatabase = {
          insert(_table: 'users') {
            return {
              async values(value: { email: string; name: string }) {
                events.push(`tx:stage:${value.email}`);
                const record = { ...value, id: `user-${++sequence}` };
                stagedUsers.set(record.id, record);
                return record;
              },
            };
          },
        };

        events.push('transaction:start');
        try {
          const result = await callback(transactionDatabase);

          for (const record of stagedUsers.values()) {
            users.set(record.id, record);
          }
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabaseFacade<typeof database, TransactionDatabase>) {}

      async create(input: { email: string; name: string }) {
        return this.db.insert('users').values(input);
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      @Transaction()
      async createThenFail(input: { email: string; name: string }, failure: Error): Promise<never> {
        await this.repo.create(input);
        throw failure;
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      imports: [DrizzleModule.forRoot<typeof database, TransactionDatabase>({ database })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      const service = await app.container.resolve(UserService);
      const failure = new Error('write failed after staging');

      await expect(
        service.createThenFail({ email: 'ada@example.com', name: 'Ada' }, failure),
      ).rejects.toBe(failure);

      expect(users).toEqual(new Map<string, UserRecord>());
      expect(events).toEqual([
        'transaction:start',
        'tx:stage:ada@example.com',
        'transaction:rollback',
      ]);
    } finally {
      await app.close();
    }
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
    try {
      const response = createResponse(events);

      await app.dispatch(
        createRequest('/controller-compat/users', 'POST', { email: 'grace@example.com', name: 'Grace' }),
        response,
      );

      expect(response.body).toEqual({ email: 'grace@example.com', id: 'controller-tx-user', name: 'Grace' });
      expect(events).toEqual(['transaction:start', 'tx:insert:grace@example.com', 'transaction:commit', 'response:send']);
    } finally {
      await app.close();
    }
  });

  it('keeps the deprecated request interceptor compatibility boundary transactional', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const events: string[] = [];
    const transactionDatabase = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`tx:insert:${value.email}`);
            return { ...value, id: 'interceptor-tx-user' };
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

      async create(input: CreateUserRequest): Promise<UserRecord> {
        return this.db.insert('users').values(input);
      }
    }

    @Inject(UserRepository)
    class UserService {
      constructor(private readonly repo: UserRepository) {}

      async create(input: CreateUserRequest): Promise<UserRecord> {
        return this.repo.create(input);
      }
    }

    @Controller('/interceptor-compat/users')
    @Inject(UserService)
    class UsersController {
      constructor(private readonly users: UserService) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      @UseInterceptors(DrizzleTransactionInterceptor)
      async create(input: CreateUserRequest): Promise<UserRecord> {
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
    try {
      const response = createResponse(events);

      await app.dispatch(
        createRequest('/interceptor-compat/users', 'POST', { email: 'lin@example.com', name: 'Lin' }),
        response,
      );

      expect(response.statusCode).toBe(201);
      expect(response.body).toEqual({ email: 'lin@example.com', id: 'interceptor-tx-user', name: 'Lin' });
      expect(events).toEqual(['transaction:start', 'tx:insert:lin@example.com', 'transaction:commit', 'response:send']);
    } finally {
      await app.close();
    }
  });

  it('rolls back a staged write when an intercepted app.dispatch handler throws', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };
    type TransactionDatabase = {
      insert(_table: 'users'): {
        values(value: { email: string; name: string }): Promise<UserRecord>;
      };
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    const failure = new Error('request handler failed after staging');
    let sequence = 0;
    const database = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`root:insert:${value.email}`);
            return { ...value, id: `root-user-${++sequence}` };
          },
        };
      },
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        const stagedUsers = new Map<string, UserRecord>();
        const transactionDatabase: TransactionDatabase = {
          insert(_table: 'users') {
            return {
              async values(value: { email: string; name: string }) {
                events.push(`tx:stage:${value.email}`);
                const record = { ...value, id: `user-${++sequence}` };
                stagedUsers.set(record.id, record);
                return record;
              },
            };
          },
        };

        events.push('transaction:start');
        try {
          const result = await callback(transactionDatabase);

          for (const record of stagedUsers.values()) {
            users.set(record.id, record);
          }
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabaseFacade<typeof database, TransactionDatabase>) {}

      async create(): Promise<UserRecord> {
        return this.db.insert('users').values({ email: 'ada@example.com', name: 'Ada' });
      }
    }

    @Controller('/interceptor-error/users')
    @Inject(UserRepository)
    class UsersController {
      constructor(private readonly users: UserRepository) {}

      @Post('/')
      @UseInterceptors(DrizzleTransactionInterceptor)
      async create(): Promise<never> {
        await this.users.create();
        events.push('handler:throw');
        throw failure;
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [DrizzleModule.forRoot<typeof database, TransactionDatabase>({ database })],
      providers: [UserRepository],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      // Given: a real dispatched route wrapped by the deprecated compatibility interceptor.
      const response = createResponse(events);

      // When: the route stages a write and then throws.
      await app.dispatch(createRequest('/interceptor-error/users', 'POST'), response);

      // Then: the database rolls back before the dispatcher writes its error response.
      expect(response.statusCode).toBe(500);
      expect(users).toEqual(new Map<string, UserRecord>());
      expect(events).toEqual([
        'transaction:start',
        'tx:stage:ada@example.com',
        'handler:throw',
        'transaction:rollback',
        'response:send',
      ]);
    } finally {
      await app.close();
    }
  });

  it('forwards the dispatched request AbortSignal and rolls back instead of committing', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };
    type TransactionDatabase = {
      insert(_table: 'users'): {
        values(value: { email: string; name: string }): Promise<UserRecord>;
      };
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    let notifyHandlerReady!: () => void;
    const handlerReady = new Promise<void>((resolve) => {
      notifyHandlerReady = resolve;
    });
    const database = {
      insert(_table: 'users') {
        return {
          async values(value: { email: string; name: string }) {
            events.push(`root:insert:${value.email}`);
            return { ...value, id: 'root-user' };
          },
        };
      },
      async transaction<T>(callback: (value: TransactionDatabase) => Promise<T>): Promise<T> {
        const stagedUsers = new Map<string, UserRecord>();
        const transactionDatabase: TransactionDatabase = {
          insert(_table: 'users') {
            return {
              async values(value: { email: string; name: string }) {
                events.push(`tx:stage:${value.email}`);
                const record = { ...value, id: 'user-1' };
                stagedUsers.set(record.id, record);
                return record;
              },
            };
          },
        };

        events.push('transaction:start');
        try {
          const result = await callback(transactionDatabase);

          for (const record of stagedUsers.values()) {
            users.set(record.id, record);
          }
          events.push('transaction:commit');
          return result;
        } catch (error) {
          events.push('transaction:rollback');
          throw error;
        }
      },
    };

    @Inject(DrizzleDatabase)
    class UserRepository {
      constructor(private readonly db: DrizzleDatabaseFacade<typeof database, TransactionDatabase>) {}

      async create(): Promise<UserRecord> {
        return this.db.insert('users').values({ email: 'lin@example.com', name: 'Lin' });
      }
    }

    @Controller('/interceptor-abort/users')
    @Inject(UserRepository)
    class UsersController {
      constructor(private readonly users: UserRepository) {}

      @Post('/')
      @UseInterceptors(DrizzleTransactionInterceptor)
      async create(): Promise<UserRecord> {
        const user = await this.users.create();
        const signal = assertRequestContext().request.signal;

        if (!signal) {
          throw new Error('Expected dispatched request signal.');
        }

        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => {
            events.push('handler:observed-abort');
            resolve();
          }, { once: true });
          notifyHandlerReady();
        });

        return user;
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [DrizzleModule.forRoot<typeof database, TransactionDatabase>({ database })],
      providers: [UserRepository],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    try {
      // Given: a dispatched request whose route has subscribed to its exact abort event.
      const controller = new AbortController();
      const response = createResponse(events);
      const request = createRequest('/interceptor-abort/users', 'POST', undefined, controller.signal);
      const dispatch = app.dispatch(request, response);

      // When: the handler has staged the write and subscribed, then the request aborts.
      await handlerReady;
      events.push('request:abort');
      controller.abort(new Error('client disconnected'));
      await dispatch;

      // Then: interceptor forwarding races the request transaction and rolls back the staged write.
      expect(response.committed).toBe(false);
      expect(users).toEqual(new Map<string, UserRecord>());
      expect(events).toEqual([
        'transaction:start',
        'tx:stage:lin@example.com',
        'request:abort',
        'handler:observed-abort',
        'transaction:rollback',
      ]);
    } finally {
      await app.close();
    }
  });
});
