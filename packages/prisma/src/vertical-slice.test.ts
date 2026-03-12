import { describe, expect, it } from 'vitest';

import { Inject } from '@konekti/core';
import { bootstrapApplication, defineModule } from '@konekti-internal/module';
import {
  Controller,
  FromBody,
  FromPath,
  Get,
  NotFoundException,
  Post,
  RequestDto,
  SuccessStatus,
  type FrameworkRequest,
  type FrameworkResponse,
} from '@konekti/http';

import { createPrismaModule, PrismaService } from './index';

function createResponse(): FrameworkResponse & { body?: unknown } {
  return {
    committed: false,
    headers: {},
    redirect(status: number, location: string) {
      this.setStatus(status);
      this.setHeader('Location', location);
      this.committed = true;
    },
    send(body: unknown) {
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

function createRequest(path: string, method: FrameworkRequest['method'], body?: unknown): FrameworkRequest {
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

describe('@konekti/prisma vertical slice', () => {
  it('handles request DTO binding, validation, persistence, and canonical responses end-to-end', async () => {
    type UserRecord = {
      email: string;
      id: string;
      name: string;
    };

    const users = new Map<string, UserRecord>();
    let sequence = 0;

    const transactionClient = {
      user: {
        async create(input: { data: { email: string; name: string } }) {
          const record = {
            email: input.data.email,
            id: `user-${++sequence}`,
            name: input.data.name,
          };

          users.set(record.id, record);
          return record;
        },
        async findUnique(input: { where: { id: string } }) {
          return users.get(input.where.id) ?? null;
        },
      },
    };
    const client = {
      async $connect() {},
      async $disconnect() {},
      async $transaction<T>(callback: (value: typeof transactionClient) => Promise<T>) {
        return callback(transactionClient);
      },
      user: {
        async create(input: { data: { email: string; name: string } }) {
          const record = {
            email: input.data.email,
            id: `user-${++sequence}`,
            name: input.data.name,
          };

          users.set(record.id, record);
          return record;
        },
        async findUnique(input: { where: { id: string } }) {
          return users.get(input.where.id) ?? null;
        },
      },
    };

    class CreateUserRequest {
      static validate(value: CreateUserRequest) {
        const details = [];

        if (value.email.length === 0) {
          details.push({
            code: 'REQUIRED',
            field: 'email',
            message: 'email is required',
            source: 'body' as const,
          });
        }

        if (value.name.length === 0) {
          details.push({
            code: 'REQUIRED',
            field: 'name',
            message: 'name is required',
            source: 'body' as const,
          });
        }

        return details;
      }

      @FromBody('email')
      email = '';

      @FromBody('name')
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
      @SuccessStatus(201)
      @Post('/')
      async create(input: CreateUserRequest) {
        return this.users.create(input);
      }

      @RequestDto(GetUserRequest)
      @Get('/:id')
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
      mode: 'test',
      rootModule: AppModule,
    });

    const createResponseOk = createResponse();
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

    const createResponseError = createResponse();
    await app.dispatch(
      createRequest('/users', 'POST', {
        email: 'ada@example.com',
        name: '',
      }),
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
        requestId: undefined,
        status: 400,
      },
    });

    const getResponseOk = createResponse();
    await app.dispatch(createRequest('/users/user-1', 'GET'), getResponseOk);

    expect(getResponseOk.statusCode).toBe(200);
    expect(getResponseOk.body).toEqual({
      email: 'ada@example.com',
      id: 'user-1',
      name: 'Ada',
    });

    const getResponseMissing = createResponse();
    await app.dispatch(createRequest('/users/missing', 'GET'), getResponseMissing);

    expect(getResponseMissing.statusCode).toBe(404);
    expect(getResponseMissing.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        details: undefined,
        message: 'User missing was not found.',
        meta: undefined,
        requestId: undefined,
        status: 404,
      },
    });

    expect(users.get('user-1')).toEqual({
      email: 'ada@example.com',
      id: 'user-1',
      name: 'Ada',
    });

    await app.close();
  });
});
