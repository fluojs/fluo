import type { Token } from '@konekti/core';

import type { GraphqlModuleOptions } from './types.js';

export const GRAPHQL_MODULE_OPTIONS: Token<GraphqlModuleOptions> = Symbol.for('konekti.graphql.module-options');
