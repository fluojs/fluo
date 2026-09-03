import { describe, expect, it } from 'vitest';

import { Cron, Interval, Timeout } from './decorators.js';
import { CronExpression } from './expressions.js';
import { getCronTaskMetadataEntries, getSchedulingTaskMetadataEntries } from './metadata.js';

describe('scheduling decorator metadata inheritance', () => {
  it('preserves base scheduling metadata when a derived class declares a task', () => {
    class BaseTaskService {
      @Cron(CronExpression.EVERY_10_SECONDS, { name: 'base-task' })
      baseTask() {}
    }

    class DerivedTaskService extends BaseTaskService {
      @Interval(1_000, { name: 'derived-task' })
      derivedTask() {}
    }

    expect(getSchedulingTaskMetadataEntries(BaseTaskService.prototype)).toEqual([
      {
        metadata: {
          expression: CronExpression.EVERY_10_SECONDS,
          kind: 'cron',
          options: {
            name: 'base-task',
          },
        },
        propertyKey: 'baseTask',
      },
    ]);
    expect(getSchedulingTaskMetadataEntries(DerivedTaskService.prototype)).toEqual([
      {
        metadata: {
          expression: CronExpression.EVERY_10_SECONDS,
          kind: 'cron',
          options: {
            name: 'base-task',
          },
        },
        propertyKey: 'baseTask',
      },
      {
        metadata: {
          kind: 'interval',
          ms: 1_000,
          options: {
            name: 'derived-task',
          },
        },
        propertyKey: 'derivedTask',
      },
    ]);
  });

  it('preserves base scheduling metadata when a derived class overrides a task', () => {
    class BaseTaskService {
      @Cron(CronExpression.EVERY_10_SECONDS, { name: 'base-task' })
      task() {}
    }

    class DerivedTaskService extends BaseTaskService {
      @Cron(CronExpression.EVERY_MINUTE, { name: 'derived-task' })
      override task() {}
    }

    expect(getCronTaskMetadataEntries(BaseTaskService.prototype)).toEqual([
      {
        metadata: {
          expression: CronExpression.EVERY_10_SECONDS,
          kind: 'cron',
          options: {
            name: 'base-task',
          },
        },
        propertyKey: 'task',
      },
    ]);
    expect(getCronTaskMetadataEntries(DerivedTaskService.prototype)).toEqual([
      {
        metadata: {
          expression: CronExpression.EVERY_MINUTE,
          kind: 'cron',
          options: {
            name: 'derived-task',
          },
        },
        propertyKey: 'task',
      },
    ]);
  });

  it('isolates scheduling metadata between sibling subclasses', () => {
    class BaseTaskService {
      @Cron(CronExpression.EVERY_10_SECONDS, { name: 'base-task' })
      baseTask() {}
    }

    class FirstTaskService extends BaseTaskService {
      @Interval(1_000, { name: 'first-task' })
      firstTask() {}
    }

    class SecondTaskService extends BaseTaskService {
      @Timeout(5_000, { name: 'second-task' })
      secondTask() {}
    }

    expect(getSchedulingTaskMetadataEntries(FirstTaskService.prototype).map((entry) => entry.propertyKey)).toEqual([
      'baseTask',
      'firstTask',
    ]);
    expect(getSchedulingTaskMetadataEntries(SecondTaskService.prototype).map((entry) => entry.propertyKey)).toEqual([
      'baseTask',
      'secondTask',
    ]);
  });
});
