import type { MetadataPropertyKey } from '@fluojs/core';
import type { Container } from '@fluojs/di';
import { resolveMultiContribution } from '@fluojs/di/internal';
import type { ApplicationLogger } from '@fluojs/runtime';

import type { CronTaskDescriptor } from './types.js';
import type { CronTaskInvocationDescriptor } from './task-discovery.js';

interface ResolvedTaskInvocation {
  callable: (this: unknown) => Promise<void>;
  instance: unknown;
}

/**
 * Represents the cron task runner.
 */
export class CronTaskRunner {
  constructor(
    private readonly runtimeContainer: Container,
    private readonly logger: ApplicationLogger,
  ) {}

  async executeTask(
    descriptor: CronTaskInvocationDescriptor,
    postRunErrorProvider?: () => Error | Promise<Error | undefined> | undefined,
  ): Promise<unknown> {
    const taskInvocation = await this.resolveTaskInvocation(descriptor);

    if (!taskInvocation) {
      return undefined;
    }

    let taskError: unknown;
    let failed = false;

    try {
      await this.runTaskBeforeHook(descriptor);
      await Promise.resolve(taskInvocation.callable.call(taskInvocation.instance));

      const postRunError = await postRunErrorProvider?.();

      if (postRunError) {
        throw postRunError;
      }

      await this.runTaskSuccessHook(descriptor);
    } catch (error) {
      failed = true;
      taskError = error;
      this.logger.error(`Cron task ${descriptor.taskName} failed.`, error, 'CronLifecycleService');
    }

    if (failed) {
      await this.runTaskErrorHook(descriptor, taskError);
    }
    await this.runTaskAfterHook(descriptor);
    return taskError;
  }

  private async resolveTaskInvocation(descriptor: CronTaskInvocationDescriptor): Promise<ResolvedTaskInvocation | undefined> {
    if (descriptor.callback) {
      return {
        callable: descriptor.callback as (this: unknown) => Promise<void>,
        instance: undefined,
      };
    }

    if (!descriptor.token || descriptor.methodKey === undefined || !descriptor.targetName || !descriptor.moduleName || !descriptor.methodName) {
      this.logger.error(
        `Scheduling task ${descriptor.taskName} is missing invocation metadata and was skipped.`,
        undefined,
        'CronLifecycleService',
      );
      return undefined;
    }

    let instance: unknown;

    try {
      instance = descriptor.contributionIndex === undefined
        ? await this.runtimeContainer.resolve(descriptor.token)
        : await resolveMultiContribution(this.runtimeContainer, descriptor.token, descriptor.contributionIndex);
    } catch (error) {
      this.logger.error(
        `Failed to resolve cron task target ${descriptor.targetName} from module ${descriptor.moduleName}.`,
        error,
        'CronLifecycleService',
      );
      return undefined;
    }

    const value = (instance as Record<MetadataPropertyKey, unknown>)[descriptor.methodKey];

    if (typeof value !== 'function') {
      this.logger.warn(
        `Cron method ${descriptor.targetName}.${descriptor.methodName} is not callable and was skipped.`,
        'CronLifecycleService',
      );
      return undefined;
    }

    return {
      callable: value as (this: unknown) => Promise<void>,
      instance,
    };
  }

  private async runTaskBeforeHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.beforeRun) {
      return;
    }

    await Promise.resolve(descriptor.beforeRun());
  }

  private async runTaskSuccessHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.onSuccess) {
      return;
    }

    await Promise.resolve(descriptor.onSuccess());
  }

  private async runTaskErrorHook(descriptor: CronTaskDescriptor, taskError: unknown): Promise<void> {
    if (descriptor.onError) {
      try {
        await Promise.resolve(descriptor.onError(taskError));
      } catch (hookError) {
        this.logger.error(`Cron onError hook ${descriptor.taskName} failed.`, hookError, 'CronLifecycleService');
      }
    }
  }

  private async runTaskAfterHook(descriptor: CronTaskDescriptor): Promise<void> {
    if (!descriptor.afterRun) {
      return;
    }

    try {
      await Promise.resolve(descriptor.afterRun());
    } catch (hookError) {
      this.logger.error(`Cron afterRun hook ${descriptor.taskName} failed.`, hookError, 'CronLifecycleService');
    }
  }
}
