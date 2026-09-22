import { Test } from '@fluojs/testing';
import { asMock, mockToken, PrototypeMock, ShallowMock } from '@fluojs/testing/mock';
import { describe, expect, it, vi } from 'vitest';
import {
  BillingModule,
  BillingService,
  FakeStripeClient,
  FakeStripeModule,
  GreetingRepository,
  StripeClient,
  StripeModule,
  TestingFixtureModule,
} from './app';

/**
 * @fluojs/testing guide evidence: pre-compilation provider overrides,
 * module replacement with preserved identity, the real request pipeline with
 * the cookies overload, and the public mock helpers.
 */

describe('@fluojs/testing guide examples', () => {
  it('replaces a provider through useValue before compilation', async () => {
    const module = await Test.createTestingModule({ rootModule: TestingFixtureModule })
      .overrideProvider(GreetingRepository)
      .useValue({ findName: () => 'Override' })
      .compile();

    try {
      const repository = await module.resolve(GreetingRepository);
      expect(repository.findName()).toBe('Override');
    } finally {
      await module.container.dispose();
    }
  });

  it('supports factory overrides for constructed fakes', async () => {
    const module = await Test.createTestingModule({ rootModule: TestingFixtureModule })
      .overrideProvider(GreetingRepository)
      .useFactory(() => ({ findName: () => 'Factory' }))
      .compile();

    try {
      const repository = await module.resolve(GreetingRepository);
      expect(repository.findName()).toBe('Factory');
    } finally {
      await module.container.dispose();
    }
  });

  it('swaps imported modules while preserving compiled module identity', async () => {
    const module = await Test.createTestingModule({ rootModule: BillingModule })
      .overrideModule(StripeModule, FakeStripeModule)
      .compile();

    try {
      expect(module.rootModule).toBe(BillingModule);
      expect(module.modules.some((compiled) => compiled.type === StripeModule)).toBe(true);

      const billing = await module.resolve(BillingService);
      expect(billing.charge()).toBe('fake');
      expect(await module.resolve(StripeClient)).toBeInstanceOf(FakeStripeClient);
    } finally {
      await module.container.dispose();
    }
  });

  it('serves the real graph through the request pipeline and cookie overload', async () => {
    const app = await Test.createApp({ rootModule: TestingFixtureModule });

    try {
      const response = await app.request('GET', '/greetings').send();
      expect(response.status).toBe(200);
      expect(response.body).toBe('Hello, Fluo!');

      const withCookies = await app
        .request({ path: '/greetings', cookies: { session: 'test-session' } })
        .send();
      expect(withCookies.status).toBe(200);
      expect(withCookies.body).toBe('Hello, Fluo!');
    } finally {
      await app.close();
    }
  });

  it('creates shallow and prototype mocks for explicit seams', () => {
    const findName = vi.fn(() => 'alice');
    const repository = ShallowMock.create<GreetingRepository>({ findName });
    expect(repository.findName()).toBe('alice');
    expect(findName).toHaveBeenCalledTimes(1);

    const strict = ShallowMock.create<GreetingRepository>({}, { strict: true });
    expect(() => strict.findName()).toThrow(/strict mode/);

    const spy = PrototypeMock.create(GreetingRepository);
    expect(vi.isMockFunction(spy.findName)).toBe(true);
    spy.findName.mockReturnValue('proto');
    expect(spy.findName()).toBe('proto');

    const override = mockToken(GreetingRepository, { findName: () => 'token' });
    expect(override.provide).toBe(GreetingRepository);
    expect(override.useValue.findName()).toBe('token');

    const base = vi.fn((value: number) => value * 2);
    const double = asMock(base);
    double.mockReturnValue(7);
    expect(double(3)).toBe(7);
  });
});
