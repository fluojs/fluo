import assert from 'node:assert/strict';
import type * as Core from '@fluojs/core';
import { defineModule, FluoFactory } from '@fluojs/runtime';

const events: string[] = [];
const order: string[] = [];
const failures: string[] = [];
const sentinel = new Error('packed bootstrap sentinel');
const destroyFailure = new Error('packed destroy sentinel');
let resourceHeld = false;
let sentinelIdentityPreserved = false;
let cleanupSettledBeforeRejection = false;
let destroyErrorIdentityPreserved = false;

function indexOfEvent(name: string): number {
  const index = events.indexOf(name);
  assert.notEqual(index, -1, `Missing lifecycle event: ${name}`);
  return index;
}

class ResourceHolder implements Core.OnModuleInit, Core.OnModuleDestroy, Core.OnApplicationShutdown {
  onModuleInit(): void {
    resourceHeld = true;
    events.push('resource:init');
  }
  async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve) => setImmediate(resolve));
    resourceHeld = false;
    events.push('resource:cleanup:done');
  }
  onApplicationShutdown(signal?: string): void { events.push(`resource:shutdown:${signal}`); }
}
class FailingBootstrap implements Core.OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    events.push('bootstrap:throw');
    throw sentinel;
  }
}
class BootstrapModule {}
defineModule(BootstrapModule, { providers: [ResourceHolder, FailingBootstrap] });

class HookedA implements Core.OnModuleDestroy, Core.OnApplicationShutdown {
  onModuleDestroy(): void { order.push('A:destroy'); }
  onApplicationShutdown(signal?: string): void { order.push(`A:shutdown:${signal}`); }
}
class FailingB implements Core.OnModuleDestroy, Core.OnApplicationShutdown {
  onModuleDestroy(): void {
    order.push('B:destroy');
    throw destroyFailure;
  }
  onApplicationShutdown(signal?: string): void { order.push(`B:shutdown:${signal}`); }
}
class DestroyModule {}
defineModule(DestroyModule, { providers: [HookedA, FailingB] });

try {
  try {
    await FluoFactory.createApplicationContext(BootstrapModule);
  } catch (error) {
    sentinelIdentityPreserved = error === sentinel;
    events.push('rejected');
  }
  cleanupSettledBeforeRejection =
    indexOfEvent('resource:cleanup:done') < indexOfEvent('rejected') && !resourceHeld;
  assert.equal(sentinelIdentityPreserved, true);
  assert.equal(cleanupSettledBeforeRejection, true);
  assert.ok(events.includes('resource:shutdown:bootstrap-failed'));
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

try {
  const context = await FluoFactory.createApplicationContext(DestroyModule);
  try {
    await context.close('SIGTERM');
  } catch (error) {
    destroyErrorIdentityPreserved = error === destroyFailure;
  }
  assert.equal(destroyErrorIdentityPreserved, true);
  assert.deepEqual(order, ['B:destroy', 'A:destroy', 'B:shutdown:SIGTERM', 'A:shutdown:SIGTERM']);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
}

console.log(`###LIFECYCLE-RESULT### ${JSON.stringify({
  kind: 'failures', ok: failures.length === 0, failures, events, order,
  sentinelIdentityPreserved, cleanupSettledBeforeRejection, destroyErrorIdentityPreserved,
})}`);
if (failures.length > 0) process.exitCode = 1;
