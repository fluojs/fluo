import { describe, expect, it } from 'vitest';

import * as cron from './index.js';

describe('@fluojs/cron root barrel public surface', () => {
  it('keeps CronModule.forRoot as the canonical root entrypoint', () => {
    expect(cron).toHaveProperty('Cron');
    expect(cron).toHaveProperty('Interval');
    expect(cron).toHaveProperty('Timeout');
    expect(cron).toHaveProperty('CronExpression');
    expect(cron).toHaveProperty('CronModule');
    expect((cron as { CronModule: { forRoot: unknown } }).CronModule).toHaveProperty('forRoot');
    expect(cron).not.toHaveProperty('createCronModule');
    expect(cron).not.toHaveProperty('createCronProviders');
    expect(cron).toHaveProperty('SCHEDULING_REGISTRY');
    expect(cron).not.toHaveProperty('CRON_OPTIONS');
    expect(cron).toHaveProperty('createCronPlatformStatusSnapshot');
    expect(cron).not.toHaveProperty('normalizeCronModuleOptions');
    expect(cron).not.toHaveProperty('defineSchedulingTaskMetadata');
    expect(cron).not.toHaveProperty('defineCronTaskMetadata');
    expect(cron).not.toHaveProperty('getCronTaskMetadata');
    expect(cron).not.toHaveProperty('getCronTaskMetadataEntries');
    expect(cron).not.toHaveProperty('cronMetadataSymbol');
    expect(Object.keys(cron).sort()).toMatchSnapshot();
  });
});
