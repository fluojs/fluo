import type { OnModuleInit, LifecycleHooks, OnApplicationShutdown } from '@fluojs/runtime';
declare const hook: OnApplicationShutdown; hook.onApplicationShutdown(123);
