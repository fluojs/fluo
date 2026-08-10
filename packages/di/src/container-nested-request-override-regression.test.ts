import { describe, expect, it } from 'vitest';

import { Container } from './container.js';

describe('Container nested request-scope override regressions', () => {
  it('shares a nested single override with its nearest request-scope owner', async () => {
    // Given
    const token = Symbol('nested-single-override');
    const root = new Container().register({
      provide: token,
      useFactory: () => ({ owner: 'root' }),
    });
    const overrideOwner = root.createRequestScope().override({
      provide: token,
      useFactory: () => ({ owner: 'request' }),
    });
    const nestedScope = overrideOwner.createRequestScope();

    // When
    const nestedInstance = await nestedScope.resolve(token);
    const ownerInstance = await overrideOwner.resolve(token);

    // Then
    expect(nestedInstance).toBe(ownerInstance);
  });

  it('keeps a nested single override out of the root singleton cache', async () => {
    // Given
    const token = Symbol('nested-single-root-isolation');
    const rootInstance = { owner: 'root' };
    const requestInstance = { owner: 'request' };
    const root = new Container().register({ provide: token, useValue: rootInstance });
    const nestedScope = root
      .createRequestScope()
      .override({ provide: token, useValue: requestInstance })
      .createRequestScope();

    // When
    await nestedScope.resolve(token);
    const resolvedFromRoot = await root.resolve(token);

    // Then
    expect(resolvedFromRoot).toBe(rootInstance);
  });

  it('shares a nested multi override with its nearest request-scope owner', async () => {
    // Given
    const token = Symbol('nested-multi-override');
    const root = new Container().register({
      multi: true,
      provide: token,
      useFactory: () => ({ owner: 'root' }),
    });
    const overrideOwner = root.createRequestScope().override({
      multi: true,
      provide: token,
      useFactory: () => ({ owner: 'request' }),
    });
    const nestedScope = overrideOwner.createRequestScope();

    // When
    const nestedInstances = await nestedScope.resolve<unknown[]>(token);
    const ownerInstances = await overrideOwner.resolve<unknown[]>(token);

    // Then
    expect(nestedInstances[0]).toBe(ownerInstances[0]);
  });
});
