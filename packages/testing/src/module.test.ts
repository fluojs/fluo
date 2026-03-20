import { describe, expect, it, vi } from 'vitest';

import { Inject, Module } from '@konekti/core';
import { Controller, Get, Post, type RequestContext } from '@konekti/http';
import type { Dispatcher } from '@konekti/http';

import { asMock, createDeepMock, createMock, createTestApp, createTestingModule, makeRequest, mockToken } from './index.js';

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

  it('treats direct function mocks in overrideProvider as useValue', async () => {
    const FUNCTION_TOKEN = Symbol('function-token');
    const mockFn = vi.fn().mockReturnValue('ok');

    const testingModule = await createTestingModule({
      rootModule: AppModule,
    })
      .overrideProvider(FUNCTION_TOKEN, mockFn)
      .compile();

    const resolved = await testingModule.resolve<typeof mockFn>(FUNCTION_TOKEN);

    expect(resolved).toBe(mockFn);
    expect(resolved()).toBe('ok');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('supports class constructor overrides via overrideProvider', async () => {
    class Logger {
      readonly name: string = 'logger';
    }

    class FakeLogger {
      readonly name: string = 'fake-logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({
      providers: [Logger, UserService],
    })
    class ServiceModule {}

    const testingModule = await createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(Logger, FakeLogger)
      .compile();

    const service = await testingModule.resolve(UserService);

    expect(service.logger).toBeInstanceOf(FakeLogger);
    expect(service.logger.name).toBe('fake-logger');
  });

  it('throws when overrideProvider token and provider.provide do not match', () => {
    const EXPECTED = Symbol('expected-token');
    const OTHER = Symbol('other-token');

    expect(() =>
      createTestingModule({ rootModule: AppModule }).overrideProvider(EXPECTED, {
        provide: OTHER,
        useValue: 'value',
      }),
    ).toThrow('overrideProvider token mismatch');
  });

  it('supports useExisting provider descriptors in overrideProvider', async () => {
    const SOURCE = Symbol('source-token');
    const TARGET = Symbol('target-token');

    @Module({
      providers: [
        { provide: SOURCE, useValue: 'source-value' },
        { provide: TARGET, useValue: 'target-value' },
      ],
    })
    class AliasModule {}

    const testingModule = await createTestingModule({ rootModule: AliasModule })
      .overrideProvider(TARGET, {
        provide: TARGET,
        useExisting: SOURCE,
      })
      .compile();

    await expect(testingModule.resolve<string>(TARGET)).resolves.toBe('source-value');
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

  it('shares singleton state between resolve() and dispatch()', async () => {
    class CounterService {
      count = 0;

      next() {
        this.count += 1;
        return this.count;
      }
    }

    @Inject([CounterService])
    @Controller('/counter')
    class CounterController {
      constructor(private readonly counter: CounterService) {}

      @Get('/')
      read() {
        return { count: this.counter.next() };
      }
    }

    @Module({
      controllers: [CounterController],
      providers: [CounterService],
    })
    class CounterModule {}

    const testingModule = await createTestingModule({ rootModule: CounterModule }).compile();
    const service = await testingModule.resolve<CounterService>(CounterService);

    expect(service.count).toBe(0);

    const first = await testingModule.dispatch({ method: 'GET', path: '/counter' });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ count: 1 });
    expect(service.count).toBe(1);

    const second = await testingModule.dispatch({ method: 'GET', path: '/counter' });
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ count: 2 });
    expect(service.count).toBe(2);
  });
});

describe('overrideGuard', () => {
  it('replaces a guard with a passthrough that always allows access', async () => {
    const GUARD_TOKEN = Symbol('AuthGuard');

    const builder = createTestingModule({ rootModule: AppModule });
    builder.overrideGuard(GUARD_TOKEN);

    const testingModule = await builder.compile();
    const guard = await testingModule.resolve<{ canActivate(): boolean }>(GUARD_TOKEN);

    expect(guard.canActivate()).toBe(true);
  });

  it('merges partial guard override with the passthrough default', async () => {
    const GUARD_TOKEN = Symbol('RoleGuard');
    const canActivate = vi.fn().mockReturnValue(false);

    const builder = createTestingModule({ rootModule: AppModule });
    builder.overrideGuard(GUARD_TOKEN, { canActivate });

    const testingModule = await builder.compile();
    const guard = await testingModule.resolve<{ canActivate(): boolean }>(GUARD_TOKEN);

    expect(guard.canActivate()).toBe(false);
    expect(canActivate).toHaveBeenCalledOnce();
  });
});

describe('overrideInterceptor', () => {
  it('replaces an interceptor with a passthrough that calls next.handle()', async () => {
    const INTERCEPTOR_TOKEN = Symbol('LoggingInterceptor');

    const builder = createTestingModule({ rootModule: AppModule });
    builder.overrideInterceptor(INTERCEPTOR_TOKEN);

    const testingModule = await builder.compile();
    const interceptor = await testingModule.resolve<{
      intercept(_ctx: unknown, next: { handle(): unknown }): unknown;
    }>(INTERCEPTOR_TOKEN);

    const next = { handle: vi.fn().mockReturnValue('result') };
    const result = interceptor.intercept({}, next);

    expect(result).toBe('result');
    expect(next.handle).toHaveBeenCalledOnce();
  });
});

describe('overrideFilter', () => {
  it('replaces a filter token with a provided fake value', async () => {
    const FILTER_TOKEN = Symbol('ErrorFilter');
    const fakeFilter = { catch: vi.fn() };

    const builder = createTestingModule({ rootModule: AppModule });
    builder.overrideFilter(FILTER_TOKEN, fakeFilter);

    const testingModule = await builder.compile();
    const filter = await testingModule.resolve<typeof fakeFilter>(FILTER_TOKEN);

    expect(filter).toBe(fakeFilter);
  });
});

describe('overrideModule', () => {
  it('swaps an imported module with a replacement before compilation', async () => {
    class RealService {
      value() {
        return 'real';
      }
    }

    class FakeService {
      value() {
        return 'fake';
      }
    }

    @Inject([RealService])
    class ConsumerService {
      constructor(readonly dep: RealService) {}
    }

    @Module({ providers: [RealService], exports: [RealService] })
    class RealModule {}

    @Module({ providers: [{ provide: RealService, useClass: FakeService }], exports: [RealService] })
    class FakeModule {}

    @Module({ imports: [RealModule], providers: [ConsumerService] })
    class RootModule {}

    const testingModule = await createTestingModule({ rootModule: RootModule })
      .overrideModule(RealModule, FakeModule)
      .compile();

    const consumer = await testingModule.resolve(ConsumerService);
    expect(consumer.dep.value()).toBe('fake');
  });
});

describe('createDeepMock', () => {
  it('wraps every class method in a vi.fn() spy', () => {
    class MailService {
      send(_to: string) {
        return true;
      }
      queue(_msg: string) {
        return 0;
      }
    }

    const mock = createDeepMock(MailService);

    expect(typeof mock.send).toBe('function');
    expect(typeof mock.queue).toBe('function');

    mock.send('test@example.com');
    expect(vi.isMockFunction(mock.send)).toBe(true);
    expect((mock.send as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('includes inherited methods from parent classes', () => {
    class Base {
      baseMethod() {
        return 'base';
      }
    }

    class Child extends Base {
      childMethod() {
        return 'child';
      }
    }

    const mock = createDeepMock(Child);

    expect(vi.isMockFunction(mock.baseMethod)).toBe(true);
    expect(vi.isMockFunction(mock.childMethod)).toBe(true);
  });

  it('child method overrides parent method with a single spy', () => {
    class Base {
      method() {
        return 'base';
      }
    }

    class Child extends Base {
      override method() {
        return 'child';
      }
    }

    const mock = createDeepMock(Child);
    expect(vi.isMockFunction(mock.method)).toBe(true);
  });
});

describe('mockToken', () => {
  it('produces a ValueProvider for the given token and partial', () => {
    const MY_TOKEN = Symbol('MyService');

    interface MyService {
      find(id: string): string;
    }

    const find = vi.fn().mockReturnValue('found');
    const provider = mockToken<MyService>(MY_TOKEN, { find });

    expect(provider.provide).toBe(MY_TOKEN);
    expect(provider.useValue.find('1')).toBe('found');
  });

  it('defaults to an empty object when no partial is given', () => {
    const TOKEN = Symbol('Token');
    const provider = mockToken(TOKEN);

    expect(provider.provide).toBe(TOKEN);
    expect(provider.useValue).toEqual({});
  });

  it('can be passed directly to overrideProvider', async () => {
    const TOKEN = Symbol('Greeter');

    interface Greeter {
      greet(): string;
    }

    class Logger {
      readonly name = 'logger';
    }

    @Inject([Logger])
    class UserService {
      constructor(readonly logger: Logger) {}
    }

    @Module({ providers: [Logger, UserService] })
    class ServiceModule {}

    const greet = vi.fn().mockReturnValue('hello from mock');
    const provider = mockToken<Greeter>(TOKEN, { greet });

    const testingModule = await createTestingModule({ rootModule: ServiceModule })
      .overrideProvider(TOKEN, provider)
      .compile();

    const greeter = await testingModule.resolve<Greeter>(TOKEN);
    expect(greeter.greet()).toBe('hello from mock');
  });
});
