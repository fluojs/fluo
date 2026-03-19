import { describe, expect, it, vi } from 'vitest';

import { Inject, Module } from '@konekti/core';
import { Controller, Get, Post, type RequestContext } from '@konekti/http';
import type { Dispatcher } from '@konekti/http';

import { asMock, createMock, createTestApp, createTestingModule, makeRequest } from './index.js';

@Controller('/users')
class UserController {
  @Post('/')
  async createUser(_: undefined, context: RequestContext) {
    return {
      body: context.request.body,
      headers: context.request.headers,
      query: context.request.query,
    };
  }

  @Get('/me')
  async getMe(_: undefined, context: RequestContext) {
    return context.principal;
  }
}

@Module({
  controllers: [UserController],
})
class AppModule {}

describe('@konekti/testing', () => {
  it('creates a testing module and resolves providers from the module graph', async () => {
    class Logger {
      readonly name = 'logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await createTestingModule({
      rootModule: ServiceModule,
    }).compile();

    const service = await testingModule.resolve(UserService);

    expect(testingModule.has(UserService)).toBe(true);
    expect(service.logger.name).toBe('logger');
  });

  it('overrides providers before resolution', async () => {
    class Logger {
      readonly name = 'logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await createTestingModule({
      rootModule: ServiceModule,
    })
      .overrideProvider(Logger, { name: 'fake-logger' })
      .compile();

    const service = await testingModule.resolve(UserService);

    expect(service.logger).toEqual({ name: 'fake-logger' });
  });
});

describe('createMock', () => {
  it('returns vi.fn() for any accessed method not in the partial', () => {
    interface MyService {
      doSomething(): string;
      doOther(): number;
    }

    const mock = createMock<MyService>();

    expect(typeof mock.doSomething).toBe('function');
    expect(typeof mock.doOther).toBe('function');
  });

  it('uses provided partial values over auto-generated mocks', () => {
    interface Counter {
      increment(): number;
      decrement(): number;
    }

    const increment = vi.fn().mockReturnValue(1);
    const mock = createMock<Counter>({ increment });

    expect(mock.increment()).toBe(1);
    expect(increment).toHaveBeenCalledOnce();
  });

  it('returns the same auto-generated mock fn across multiple accesses to the same property', () => {
    interface Greeter {
      greet(): string;
    }

    const mock = createMock<Greeter>();
    const first = mock.greet;
    const second = mock.greet;

    expect(first).toBe(second);
  });
});

describe('asMock', () => {
  it('casts a vi.fn() to a typed MockInstance without runtime errors', () => {
    const fn = vi.fn().mockReturnValue(42);
    const typed = asMock(fn as () => number);

    typed.mockReturnValue(99);

    expect(fn()).toBe(99);
  });
});

describe('makeRequest', () => {
  it('dispatches a normalized request and captures the response', async () => {
    const dispatcher: Dispatcher = {
      async dispatch(request, response) {
        expect(request.method).toBe('POST');
        expect(request.path).toBe('/users');
        expect(request.url).toBe('/users?page=1&tag=a&tag=b');
        expect(request.query).toEqual({ page: '1', tag: ['a', 'b'] });
        expect(request.headers).toEqual({ 'x-test': '1' });
        expect(request.body).toEqual({ name: 'Ada' });

        response.setStatus(201);
        response.setHeader('x-powered-by', 'konekti');
        await response.send({ ok: true });
      },
    };

    const result = await makeRequest(dispatcher, {
      method: 'post',
      path: '/users',
      query: { page: '1', tag: ['a', 'b'] },
      headers: { 'x-test': '1' },
      body: { name: 'Ada' },
    });

    expect(result).toEqual({
      status: 201,
      headers: { 'x-powered-by': 'konekti' },
      body: { ok: true },
    });
  });
});

describe('createTestApp', () => {
  it('provides request builder helpers and closes cleanly', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const response = await app
      .request('POST', '/users')
      .header('x-test-id', 'k1')
      .query('page', '1')
      .query('tag', ['a', 'b'])
      .body({ name: 'Alice' })
      .send();

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      body: { name: 'Alice' },
      headers: { 'x-test-id': 'k1' },
      query: { page: '1', tag: ['a', 'b'] },
    });

    await expect(app.close()).resolves.toBeUndefined();
  });

  it('injects principal into request context for e2e-style calls', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const response = await app
      .request('GET', '/users/me')
      .principal({
        id: 'user-1',
        roles: ['admin'],
      })
      .send();

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      subject: 'user-1',
      roles: ['admin'],
      claims: { id: 'user-1' },
    });

    await app.close();
  });

  it('dispatches a request directly through the app helper and injects subject-based principal', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const response = await app.dispatch({
      method: 'GET',
      path: '/users/me',
      principal: {
        subject: 'dispatch-subject',
        roles: ['ops'],
        claims: { tenant: 'edge' },
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      subject: 'dispatch-subject',
      roles: ['ops'],
      claims: { tenant: 'edge' },
    });

    await app.close();
  });

  it('prioritizes subject over id and falls back to default subject when missing', async () => {
    const app = await createTestApp({ rootModule: AppModule });

    const subjectResponse = await app
      .request('GET', '/users/me')
      .principal({
        subject: 'subject-win',
        id: 'ignored-id',
      })
      .send();

    expect(subjectResponse.body).toEqual({
      subject: 'subject-win',
      claims: { id: 'ignored-id' },
    });

    const idResponse = await app
      .request('GET', '/users/me')
      .principal({
        id: 'legacy-id',
        roles: ['support'],
      })
      .send();

    expect(idResponse.body).toEqual({
      subject: 'legacy-id',
      roles: ['support'],
      claims: { id: 'legacy-id' },
    });

    const fallbackResponse = await app
      .request('GET', '/users/me')
      .principal({
        roles: ['defaulted'],
      })
      .send();

    expect(fallbackResponse.status).toBe(200);
    expect(fallbackResponse.body).toEqual({
      subject: 'test',
      roles: ['defaulted'],
      claims: {},
    });

    await app.close();
  });
});

describe('TestingModuleRef.dispatch', () => {
  it('dispatches full HTTP request lifecycle from a compiled module ref', async () => {
    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    const response = await testingModule.dispatch({
      method: 'GET',
      path: '/users/me',
      principal: {
        id: 'dispatch-user',
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      subject: 'dispatch-user',
      claims: {
        id: 'dispatch-user',
      },
    });
  });

  it('supports POST body, headers, and query with module-level dispatch', async () => {
    const testingModule = await createTestingModule({ rootModule: AppModule }).compile();

    const response = await testingModule.dispatch({
      method: 'post',
      path: '/users',
      headers: { 'x-test-id': 'dispatch' },
      query: { scope: 'all' },
      body: { name: 'Bob' },
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      body: { name: 'Bob' },
      headers: { 'x-test-id': 'dispatch' },
      query: { scope: 'all' },
    });
  });
});
