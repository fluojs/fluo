import assert from 'node:assert/strict';
import type * as Core from '@fluojs/core';
import type * as Runtime from '@fluojs/runtime';
import { defineModule, FluoFactory } from '@fluojs/runtime';

const events: string[] = [];
const failures: string[] = [];
let afterCreate: string[] = [];
let afterFirstClose: string[] = [];

class ProviderA implements Core.OnModuleInit, Core.OnApplicationBootstrap,
  Core.OnModuleDestroy, Core.OnApplicationShutdown {
  onModuleInit(): void { events.push('A:init'); }
  onApplicationBootstrap(): void { events.push('A:bootstrap'); }
  onModuleDestroy(): void { events.push('A:destroy'); }
  onApplicationShutdown(signal?: string): void { events.push(`A:shutdown:${signal}`); }
}

class ProviderB implements Runtime.OnModuleInit, Runtime.OnApplicationBootstrap,
  Runtime.OnModuleDestroy, Runtime.OnApplicationShutdown {
  onModuleInit(): void { events.push('B:init'); }
  onApplicationBootstrap(): void { events.push('B:bootstrap'); }
  onModuleDestroy(): void { events.push('B:destroy'); }
  onApplicationShutdown(signal?: string): void { events.push(`B:shutdown:${signal}`); }
}

class AppModule {}
defineModule(AppModule, { providers: [ProviderA, ProviderB] });

try {
  const context = await FluoFactory.createApplicationContext(AppModule);
  afterCreate = [...events];
  await context.close('SIGTERM');
  afterFirstClose = [...events];
  await context.close('SIGTERM');
  assert.deepEqual(afterCreate, ['A:init', 'B:init', 'A:bootstrap', 'B:bootstrap']);
  assert.deepEqual(events, [
    'A:init', 'B:init', 'A:bootstrap', 'B:bootstrap',
    'B:destroy', 'A:destroy', 'B:shutdown:SIGTERM', 'A:shutdown:SIGTERM',
  ]);
  assert.deepEqual(events, afterFirstClose);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

console.log(`###LIFECYCLE-RESULT### ${JSON.stringify({
  kind: 'lifecycle', ok: failures.length === 0, failures, events, afterCreate, afterFirstClose,
})}`);
if (failures.length > 0) process.exitCode = 1;
