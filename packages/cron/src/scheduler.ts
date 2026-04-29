import { Cron as Croner } from 'croner';

import type { CronScheduler } from './types.js';

/**
 * Provides the default cron scheduler value.
 *
 * @param expression The expression.
 * @param options The options.
 * @param callback The callback.
 */
export const defaultCronScheduler: CronScheduler = (expression, options, callback) => {
  return new Croner(expression, {
    name: options.name,
    protect: options.protect,
    timezone: options.timezone,
  }, callback);
};
