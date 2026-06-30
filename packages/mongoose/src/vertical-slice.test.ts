import { Inject } from '@fluojs/core';
import {
  Controller,
  type FrameworkRequest,
  type FrameworkResponse,
  FromBody,
  HttpCode,
  Post,
  RequestDto,
} from '@fluojs/http';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { MongooseConnection, MongooseModule, Transaction } from './index.js';
import type { MongooseSessionLike } from './types.js';

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

describe('@fluojs/mongoose service boundary primary flow', () => {
  it('commits a service-layer transaction while the controller only delegates', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    const events: string[] = [];
    const createSessions: Array<MongooseSessionLike | undefined> = [];
    const startedSessions: MongooseSessionLike[] = [];
    let sequence = 0;

    function createSession(): MongooseSessionLike {
      return {
        startTransaction() {
          events.push('session:tx:start');
        },
        commitTransaction() {
          events.push('session:tx:commit');
        },
        abortTransaction() {
          events.push('session:tx:abort');
        },
        endSession() {
          events.push('session:end');
        },
      };
    }

    const UserModel = {
      async create(input: { email: string; name: string }, options?: { session?: MongooseSessionLike }) {
        events.push(`model:create:${input.email}`);
        createSessions.push(options?.session);
        const record = { ...input, id: `user-${++sequence}` };
        users.set(record.id, record);
        return record;
      },
    };

    const connection = {
      model(name: string) {
        expect(name).toBe('User');
        return UserModel;
      },
      async startSession() {
        events.push('connection:startSession');
        const session = createSession();
        startedSessions.push(session);
        return session;
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(MongooseConnection)
    class UserRepository {
      constructor(private readonly conn: MongooseConnection<typeof connection>) {}

      async create(input: CreateUserRequest) {
        return (this.conn.model('User') as typeof UserModel).create({
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
      imports: [MongooseModule.forRoot({ connection })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const response = createResponse(events);

    try {
      await app.dispatch(
        createRequest('/service-boundary/users', 'POST', { email: 'ada@example.com', name: 'Ada' }),
        response,
      );

      expect(response.statusCode).toBe(201);
      expect(response.body).toEqual({ email: 'ada@example.com', id: 'user-1', name: 'Ada' });
      expect(createSessions[0]).toBe(startedSessions[0]);
      expect(events).toEqual([
        'connection:startSession',
        'session:tx:start',
        'model:create:ada@example.com',
        'session:tx:commit',
        'session:end',
        'response:send',
      ]);
    } finally {
      await app.close();
    }
  });

  it('keeps controller-level method decoration as a compatibility path only', async () => {
    const events: string[] = [];
    const createSessions: Array<MongooseSessionLike | undefined> = [];
    const startedSessions: MongooseSessionLike[] = [];

    function createSession(): MongooseSessionLike {
      return {
        startTransaction() {
          events.push('session:tx:start');
        },
        commitTransaction() {
          events.push('session:tx:commit');
        },
        abortTransaction() {
          events.push('session:tx:abort');
        },
        endSession() {
          events.push('session:end');
        },
      };
    }

    const UserModel = {
      async create(input: { email: string; name: string }, options?: { session?: MongooseSessionLike }) {
        events.push(`model:create:${input.email}`);
        createSessions.push(options?.session);
        return { ...input, id: 'controller-tx-user' };
      },
    };

    const connection = {
      model(name: string) {
        expect(name).toBe('User');
        return UserModel;
      },
      async startSession() {
        events.push('connection:startSession');
        const session = createSession();
        startedSessions.push(session);
        return session;
      },
    };

    class CreateUserRequest {
      @FromBody('email')
      email = '';

      @FromBody('name')
      name = '';
    }

    @Inject(MongooseConnection)
    class UserRepository {
      constructor(private readonly conn: MongooseConnection<typeof connection>) {}

      async create(input: CreateUserRequest) {
        return (this.conn.model('User') as typeof UserModel).create(input);
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
    @Inject(UserService, MongooseConnection)
    class UsersController {
      constructor(
        private readonly users: UserService,
        readonly conn: MongooseConnection<typeof connection>,
      ) {}

      @RequestDto(CreateUserRequest)
      @HttpCode(201)
      @Post('/')
      @Transaction()
      async create(input: CreateUserRequest) {
        void this.conn;

        return this.users.create(input);
      }
    }

    class AppModule {}

    defineModule(AppModule, {
      controllers: [UsersController],
      imports: [MongooseModule.forRoot({ connection })],
      providers: [UserRepository, UserService],
    });

    const app = await bootstrapApplication({ rootModule: AppModule });
    const response = createResponse(events);

    try {
      await app.dispatch(
        createRequest('/controller-compat/users', 'POST', { email: 'grace@example.com', name: 'Grace' }),
        response,
      );

      expect(response.body).toEqual({ email: 'grace@example.com', id: 'controller-tx-user', name: 'Grace' });
      expect(createSessions[0]).toBe(startedSessions[0]);
      expect(events).toEqual([
        'connection:startSession',
        'session:tx:start',
        'model:create:grace@example.com',
        'session:tx:commit',
        'session:end',
        'response:send',
      ]);
    } finally {
      await app.close();
    }
  });
});
