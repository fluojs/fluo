import { Cron as Croner } from 'croner';

import type { CronScheduler } from './types.js';

export const defaultCronScheduler: CronScheduler = (expression, options, callback) => {
  return new Croner(expression, {
    name: options.name,
    protect: options.protect,
    timezone: options.timezone,
  }, callback);
};
