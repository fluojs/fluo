import type { Token } from '@konekti/core';

import type { ApplicationLogger } from './types.js';

export const APPLICATION_LOGGER: Token<ApplicationLogger> = Symbol.for('konekti.runtime.application-logger');
