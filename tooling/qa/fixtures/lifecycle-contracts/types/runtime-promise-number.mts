import type { OnModuleInit, LifecycleHooks, OnApplicationShutdown } from '@fluojs/runtime';
const hook: OnModuleInit = { onModuleInit() { return Promise.resolve(123); } };
