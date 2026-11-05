import type { OnModuleInit, LifecycleHooks, OnApplicationShutdown } from '@fluojs/core';
declare const hook: OnApplicationShutdown; hook.onApplicationShutdown(123);
