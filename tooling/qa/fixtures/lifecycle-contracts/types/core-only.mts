import type { LifecycleHooks, OnModuleInit, OnApplicationBootstrap, OnModuleDestroy, OnApplicationShutdown } from '@fluojs/core';
const init: OnModuleInit = { onModuleInit() {} };
const bootstrap: OnApplicationBootstrap = { async onApplicationBootstrap() {} };
const destroy: OnModuleDestroy = { onModuleDestroy() {} };
const shutdown: OnApplicationShutdown = { async onApplicationShutdown(signal?: string) {} };
const hooks: LifecycleHooks[] = [init, bootstrap, destroy, shutdown];
shutdown.onApplicationShutdown();
shutdown.onApplicationShutdown('SIGTERM');
