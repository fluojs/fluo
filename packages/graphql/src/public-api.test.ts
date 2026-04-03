import { describe, expect, it } from 'vitest';

import * as graphqlPublicApi from './index.js';

describe('@konekti/graphql public API surface', () => {
  it('does not expose internal lifecycle/module-option tokens', () => {
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_MODULE_OPTIONS');
    expect(graphqlPublicApi).not.toHaveProperty('GRAPHQL_LIFECYCLE_SERVICE');
  });
});
