import type { Token } from '@konekti/core';

import type { NormalizedCronModuleOptions, SchedulingRegistry } from './types.js';

/** Injection token for normalized cron module options used by {@link CronLifecycleService}. */
export const CRON_OPTIONS: Token<NormalizedCronModuleOptions> = Symbol.for('konekti.cron.options');
/** Injection token for the runtime scheduling registry exposed to application code. */
export const SCHEDULING_REGISTRY: Token<SchedulingRegistry> = Symbol.for('konekti.cron.scheduling-registry');
