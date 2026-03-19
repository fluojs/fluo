import type { Token } from '@konekti/core';
import type { Container } from '@konekti/di';

import type { ApplicationLogger } from './types.js';
import type { CompiledModule } from './types.js';

export const APPLICATION_LOGGER: Token<ApplicationLogger> = Symbol('APPLICATION_LOGGER');
export const RUNTIME_CONTAINER: Token<Container> = Symbol('RUNTIME_CONTAINER');
export const COMPILED_MODULES: Token<readonly CompiledModule[]> = Symbol('COMPILED_MODULES');
