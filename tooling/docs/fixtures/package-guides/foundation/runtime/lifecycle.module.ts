import { Module } from '@fluojs/core';
import type { OnApplicationBootstrap, OnApplicationShutdown, OnModuleDestroy, OnModuleInit } from '@fluojs/runtime';

/**
 * Lifecycle order evidence for the @fluojs/runtime guide: startup runs
 * provider-ordered onModuleInit then onApplicationBootstrap; shutdown reverses
 * provider order across onModuleDestroy then onApplicationShutdown.
 */

export const lifecycleEvents: string[] = [];

export class SecondService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  onModuleInit(): void {
    lifecycleEvents.push('second:init');
  }

  onApplicationBootstrap(): void {
    lifecycleEvents.push('second:bootstrap');
  }

  onModuleDestroy(): void {
    lifecycleEvents.push('second:destroy');
  }

  onApplicationShutdown(): void {
    lifecycleEvents.push('second:shutdown');
  }
}

export class FirstService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown {
  onModuleInit(): void {
    lifecycleEvents.push('first:init');
  }

  onApplicationBootstrap(): void {
    lifecycleEvents.push('first:bootstrap');
  }

  onModuleDestroy(): void {
    lifecycleEvents.push('first:destroy');
  }

  onApplicationShutdown(): void {
    lifecycleEvents.push('first:shutdown');
  }
}

@Module({
  providers: [FirstService, SecondService],
  exports: [FirstService, SecondService],
})
export class LifecycleModule {}
