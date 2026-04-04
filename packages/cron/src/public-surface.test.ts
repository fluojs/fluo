import { describe, expect, it } from 'vitest';

import * as cron from './index.js';

describe('@konekti/cron root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(cron).toHaveProperty('Cron');
    expect(cron).toHaveProperty('Interval');
    expect(cron).toHaveProperty('Timeout');
    expect(cron).toHaveProperty('CronExpression');
    expect(cron).toHaveProperty('CronModule');
    expect(cron).not.toHaveProperty('createCronModule');
    expect(cron).toHaveProperty('createCronProviders');
    expect(cron).toHaveProperty('SCHEDULING_REGISTRY');
    expect(cron).toHaveProperty('createCronPlatformStatusSnapshot');
    expect(cron).toHaveProperty('normalizeCronModuleOptions');
    expect(Object.keys(cron).sort()).toMatchSnapshot();
  });
});
