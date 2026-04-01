import type { Token } from '@konekti/core';

import type { NormalizedCronModuleOptions, SchedulingRegistry } from './types.js';

export const CRON_OPTIONS: Token<NormalizedCronModuleOptions> = Symbol.for('konekti.cron.options');
export const SCHEDULING_REGISTRY: Token<SchedulingRegistry> = Symbol.for('konekti.cron.scheduling-registry');
