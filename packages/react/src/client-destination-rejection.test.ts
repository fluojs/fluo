import { expect, it, vi } from 'vitest';

import {
  type ClientNavigationEnvironment,
  createClientNavigationStore,
} from './client/store.js';
import { createReactRouteSnapshot, ReactClientNavigationError } from './client.js';

type RejectedNavigationCase = {
  readonly destination: string;
  readonly kind: 'cross-origin' | 'non-HTTP(S)';
  readonly method: 'push' | 'replace';
};

const rejectedNavigationCases = [
  {
    destination: 'https://outside.test/products/sku-84',
    kind: 'cross-origin',
    method: 'push',
  },
  {
    destination: 'https://outside.test/products/sku-126',
    kind: 'cross-origin',
    method: 'replace',
  },
  {
    destination: 'ftp://example.test/products/sku-84',
    kind: 'non-HTTP(S)',
    method: 'push',
  },
  {
    destination: 'ftp://example.test/products/sku-126',
    kind: 'non-HTTP(S)',
    method: 'replace',
  },
] satisfies readonly RejectedNavigationCase[];

it.each(rejectedNavigationCases)('rejects a $kind $method without invoking browser navigation', ({ destination, method }) => {
  // Given: a connected client store and observable browser navigation APIs.
  const assign = vi.fn();
  const replace = vi.fn();
  const store = createClientNavigationStore(
    createReactRouteSnapshot({ url: '/products/sku-42' }),
  );
  const environment = {
    assign,
    back: vi.fn(),
    currentHref: () => 'https://example.test/products/sku-42',
    reload: vi.fn(),
    replace,
    subscribe: () => () => undefined,
  } satisfies ClientNavigationEnvironment;
  store.connect(environment);

  // When: the router targets an unsupported destination.
  let thrown: ReactClientNavigationError | undefined;
  try {
    store.router[method](destination);
  } catch (error) {
    if (!(error instanceof ReactClientNavigationError)) {
      throw error;
    }
    thrown = error;
  }

  // Then: the stable error is observable before either browser API runs.
  expect(thrown).toMatchObject({ code: 'unsupported-destination' });
  expect(assign).not.toHaveBeenCalled();
  expect(replace).not.toHaveBeenCalled();
});
