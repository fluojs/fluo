import { Inject, Module } from '@fluojs/core';
import { getQueueToken, QueueModule, QueueWorker, type Queue } from '@fluojs/queue';
import { RedisModule } from '@fluojs/redis';

import { createDeferred, type Deferred } from './helpers';

/**
 * Complete canonical queue application from the Queue guide
 * (apps/docs/content/docs/packages/queue.mdx): one job class, one worker,
 * one producer, and the module wiring them to a lifecycle-managed Redis
 * client. Guide fixtures run this app against a real redis:7.4-alpine server
 * through the repository's native fixture harness.
 */

export class ProcessOrderJob {
  constructor(public readonly orderId: string) {}
}

/** A job class that is never registered with @QueueWorker; enqueue must reject it. */
export class UnregisteredOrderJob {
  constructor(public readonly orderId: string) {}
}

/** A job whose worker always fails; with attempts: 1 the failure is terminal. */
export class ExplodeJob {
  constructor(public readonly attemptMarker: string) {}
}

/**
 * Application-owned observation seam. Workers record deliveries here and
 * tests await them through event barriers - never through sleeps or polling.
 */
export class QueueProbe {
  readonly handledJobs: ProcessOrderJob[] = [];
  readonly attempts: ExplodeJob[] = [];

  private readonly handledWaiters: Array<(job: ProcessOrderJob) => void> = [];
  private readonly attemptWaiters: Array<(job: ExplodeJob) => void> = [];
  private readonly pendingHandled: ProcessOrderJob[] = [];
  private readonly pendingAttempts: ExplodeJob[] = [];
  private gate: Deferred<void> | undefined;

  recordHandled(job: ProcessOrderJob): void {
    this.handledJobs.push(job);

    // One waiter per delivery: a delivery that lands before the test awaits
    // is buffered, so no signal is lost and none is delivered twice.
    const waiter = this.handledWaiters.shift();

    if (waiter) {
      waiter(job);
    } else {
      this.pendingHandled.push(job);
    }
  }

  waitHandled(): Promise<ProcessOrderJob> {
    const pending = this.pendingHandled.shift();

    if (pending) {
      return Promise.resolve(pending);
    }

    return new Promise((resolve) => {
      this.handledWaiters.push(resolve);
    });
  }

  recordAttempt(job: ExplodeJob): void {
    this.attempts.push(job);

    const waiter = this.attemptWaiters.shift();

    if (waiter) {
      waiter(job);
    } else {
      this.pendingAttempts.push(job);
    }
  }

  waitAttempt(): Promise<ExplodeJob> {
    const pending = this.pendingAttempts.shift();

    if (pending) {
      return Promise.resolve(pending);
    }

    return new Promise((resolve) => {
      this.attemptWaiters.push(resolve);
    });
  }

  /** Makes the order worker block inside handle() until `release()` is called. */
  hold(): void {
    this.gate = createDeferred<void>();
  }

  release(): void {
    this.gate?.resolve();
    this.gate = undefined;
  }

  waitGateIfHeld(): Promise<void> {
    return this.gate ? this.gate.promise : Promise.resolve();
  }
}

@QueueWorker(ProcessOrderJob, { attempts: 3 })
@Inject(QueueProbe)
export class OrderWorker {
  constructor(private readonly probe: QueueProbe) {}

  async handle(job: ProcessOrderJob): Promise<void> {
    await this.probe.waitGateIfHeld();
    this.probe.recordHandled(job);
  }
}

@QueueWorker(ExplodeJob, { attempts: 1 })
@Inject(QueueProbe)
export class ExplodeWorker {
  constructor(private readonly probe: QueueProbe) {}

  async handle(job: ExplodeJob): Promise<void> {
    this.probe.recordAttempt(job);
    throw new Error('boom');
  }
}

@Inject(getQueueToken())
export class OrderService {
  constructor(private readonly queue: Queue) {}

  async placeOrder(orderId: string): Promise<string> {
    return this.queue.enqueue(new ProcessOrderJob(orderId));
  }
}

export function createQueueGuideApp(redisOptions: { host: string; port: number }) {
  @Module({
    imports: [
      RedisModule.forRoot(redisOptions),
      QueueModule.forRoot({ workerShutdownTimeoutMs: 5_000 }),
    ],
    providers: [QueueProbe, OrderWorker, ExplodeWorker, OrderService],
  })
  class QueueGuideAppModule {}

  return { AppModule: QueueGuideAppModule, QueueProbe, OrderService };
}

/**
 * A second registration against the same Redis backend with no workers,
 * used to exercise the read-only `inspectDeadLetters` facade after the
 * processing context has shut down (shutdown drains pending dead-letter
 * writes before returning, so their arrival in Redis is deterministic).
 */
export function createQueueInspectionApp(redisOptions: { host: string; port: number }) {
  @Module({
    imports: [RedisModule.forRoot(redisOptions), QueueModule.forRoot()],
    providers: [],
  })
  class QueueInspectionAppModule {}

  return { AppModule: QueueInspectionAppModule };
}
