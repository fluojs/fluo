import type { Token } from '@konekti/core';

import type { GraphqlLifecycleService } from './service.js';
import type { GraphqlModuleOptions } from './types.js';

export const GRAPHQL_MODULE_OPTIONS: Token<GraphqlModuleOptions> = Symbol.for('konekti.graphql.module-options');
export const GRAPHQL_LIFECYCLE_SERVICE: Token<GraphqlLifecycleService> = Symbol.for('konekti.graphql.lifecycle-service');
