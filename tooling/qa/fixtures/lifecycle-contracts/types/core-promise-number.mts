import type { OnModuleInit, LifecycleHooks, OnApplicationShutdown } from '@fluojs/core';
const hook: OnModuleInit = { onModuleInit() { return Promise.resolve(123); } };
