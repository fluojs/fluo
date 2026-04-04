import type { Token } from '@konekti/core';

import type { GraphqlModuleOptions } from './types.js';

export const GRAPHQL_INTERNAL_MODULE_OPTIONS_TOKEN: Token<GraphqlModuleOptions> = Symbol.for(
  'konekti.graphql.module-options',
);
