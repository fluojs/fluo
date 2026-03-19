import type { Token } from '@konekti/core';
import type { Container } from '@konekti/di';
import type { HttpApplicationAdapter } from '@konekti/http';

import type { ApplicationLogger } from './types.js';
import type { CompiledModule } from './types.js';

export const APPLICATION_LOGGER: Token<ApplicationLogger> = Symbol.for('konekti.runtime.application-logger');
export const RUNTIME_CONTAINER: Token<Container> = Symbol('RUNTIME_CONTAINER');
export const COMPILED_MODULES: Token<readonly CompiledModule[]> = Symbol('COMPILED_MODULES');
export const HTTP_APPLICATION_ADAPTER: Token<HttpApplicationAdapter> = Symbol('HTTP_APPLICATION_ADAPTER');
