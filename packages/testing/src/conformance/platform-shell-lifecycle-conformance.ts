import { PlatformLifecycleConflictError } from '@fluojs/runtime';
import type {
  PlatformComponent,
  PlatformHealthReport,
  PlatformLifecycleOperation,
  PlatformReadinessReport,
  PlatformShell,
  PlatformSnapshot,
  PlatformState,
  PlatformValidationResult,
} from '@fluojs/runtime';

type LifecycleHook = () => Promise<void> | void;

interface ControlledPlatformComponentOptions {
  readonly failStartTimes?: number;
  readonly failStopTimes?: number;
  readonly onStart?: LifecycleHook;
  readonly onStop?: LifecycleHook;
  readonly startGate?: Promise<void>;
  readonly stopGate?: Promise<void>;
}

class Deferred {
  readonly promise: Promise<void>;
  private settle: () => void = () => {
    throw new Error('Deferred promise was not initialized.');
  };

  constructor() {
    this.promise = new Promise<void>((resolve) => {
      this.settle = resolve;
    });
  }

  resolve(): void {
    this.settle();
  }
}

class ControlledPlatformComponent implements PlatformComponent {
  readonly id = 'platform-shell-lifecycle-conformance';
  readonly kind = 'platform-shell-lifecycle-conformance';
  readonly entered: Record<PlatformLifecycleOperation, Deferred> = {
    start: new Deferred(),
    stop: new Deferred(),
  };
  startCalls = 0;
  stopCalls = 0;

  private currentState: PlatformState = 'created';
  private startFailuresRemaining: number;
  private stopFailuresRemaining: number;

  constructor(private readonly options: ControlledPlatformComponentOptions = {}) {
    this.startFailuresRemaining = options.failStartTimes ?? 0;
    this.stopFailuresRemaining = options.failStopTimes ?? 0;
  }

  health(): Promise<PlatformHealthReport> {
    return Promise.resolve({ status: 'healthy' });
  }

  ready(): Promise<PlatformReadinessReport> {
    return Promise.resolve({ critical: true, status: 'ready' });
  }

  snapshot(): PlatformSnapshot {
    return {
      dependencies: [],
      details: {},
      health: { status: 'healthy' },
      id: this.id,
      kind: this.kind,
      ownership: { externallyManaged: false, ownsResources: true },
      readiness: { critical: true, status: 'ready' },
      state: this.currentState,
      telemetry: { namespace: 'fluo.platform-shell-lifecycle-conformance', tags: {} },
    };
  }

  async start(): Promise<void> {
    this.startCalls += 1;
    this.entered.start.resolve();
    await this.options.onStart?.();
    await this.options.startGate;

    if (this.startFailuresRemaining > 0) {
      this.startFailuresRemaining -= 1;
      throw new Error('controlled start failure');
    }

    this.currentState = 'ready';
  }

  state(): PlatformState {
    return this.currentState;
  }

  async stop(): Promise<void> {
    this.stopCalls += 1;
    this.entered.stop.resolve();
    await this.options.onStop?.();
    await this.options.stopGate;

    if (this.stopFailuresRemaining > 0) {
      this.stopFailuresRemaining -= 1;
      throw new Error('controlled stop failure');
    }

    this.currentState = 'stopped';
  }

  validate(): Promise<PlatformValidationResult> {
    return Promise.resolve({ issues: [], ok: true });
  }
}

/**
 * Describes the PlatformShell lifecycle conformance harness options contract.
 */
export interface PlatformShellLifecycleConformanceHarnessOptions {
  createShell: (component: PlatformComponent) => PlatformShell;
}

/**
 * Represents lifecycle exclusivity checks for a PlatformShell implementation.
 */
export class PlatformShellLifecycleConformanceHarness {
  constructor(private readonly options: PlatformShellLifecycleConformanceHarnessOptions) {}

  async assertAll(): Promise<void> {
    await this.assertOverlappingTransitionsRejectImmediately();
    await this.assertCallbackReentryRejects();
    await this.assertSettledTransitionsPermitRetries();
    await this.assertSequentialTransitionsRemainIdempotent();
  }

  async assertOverlappingTransitionsRejectImmediately(): Promise<void> {
    const overlapPairs: readonly (readonly [PlatformLifecycleOperation, PlatformLifecycleOperation])[] = [
      ['start', 'start'],
      ['start', 'stop'],
      ['stop', 'start'],
      ['stop', 'stop'],
    ];

    for (const [active, requested] of overlapPairs) {
      const gate = new Deferred();
      const component = new ControlledPlatformComponent(
        active === 'start' ? { startGate: gate.promise } : { stopGate: gate.promise },
      );
      const shell = this.options.createShell(component);

      if (active === 'stop') {
        await shell.start();
      }

      const activeTransition = shell[active]();
      await component.entered[active].promise;

      try {
        await assertLifecycleConflict(shell[requested](), active, requested);
      } finally {
        gate.resolve();
      }

      await activeTransition;

      if (active === 'start') {
        await shell.stop();
      }
    }
  }

  async assertCallbackReentryRejects(): Promise<void> {
    await this.assertSynchronousStartCallbackReentryRejects();
    await this.assertAwaitedStopCallbackReentryRejects();
  }

  async assertSettledTransitionsPermitRetries(): Promise<void> {
    await this.assertFailedTransitionPermitsRetry('start');
    await this.assertFailedTransitionPermitsRetry('stop');
  }

  async assertSequentialTransitionsRemainIdempotent(): Promise<void> {
    const component = new ControlledPlatformComponent();
    const shell = this.options.createShell(component);

    await shell.start();
    await shell.start();
    await shell.stop();
    await shell.stop();

    if (component.startCalls !== 1 || component.stopCalls !== 1) {
      throw new Error(
        `Settled lifecycle calls must be idempotent. Received ${component.startCalls} start() and ${component.stopCalls} stop() calls.`,
      );
    }
  }

  private async assertSynchronousStartCallbackReentryRejects(): Promise<void> {
    let reenter: (() => Promise<void>) | undefined;
    const component = new ControlledPlatformComponent({
      onStart: async () => {
        if (!reenter) {
          throw new Error('Lifecycle reentry was not initialized.');
        }

        await assertLifecycleConflict(reenter(), 'start', 'stop');
      },
    });
    const shell = this.options.createShell(component);
    reenter = () => shell.stop();

    await shell.start();
    await shell.stop();
  }

  private async assertAwaitedStopCallbackReentryRejects(): Promise<void> {
    let reenter: (() => Promise<void>) | undefined;
    const component = new ControlledPlatformComponent({
      onStop: async () => {
        await Promise.resolve();
        await Promise.resolve();

        if (!reenter) {
          throw new Error('Lifecycle reentry was not initialized.');
        }

        await assertLifecycleConflict(reenter(), 'stop', 'start');
      },
    });
    const shell = this.options.createShell(component);
    reenter = () => shell.start();

    await shell.start();
    await shell.stop();
  }

  private async assertFailedTransitionPermitsRetry(operation: PlatformLifecycleOperation): Promise<void> {
    const component = new ControlledPlatformComponent(
      operation === 'start' ? { failStartTimes: 1 } : { failStopTimes: 1 },
    );
    const shell = this.options.createShell(component);

    if (operation === 'stop') {
      await shell.start();
    }

    await expectTransitionFailure(shell[operation](), operation);
    await shell[operation]();

    const callCount = operation === 'start' ? component.startCalls : component.stopCalls;
    if (callCount !== 2) {
      throw new Error(`Failed ${operation}() transitions must permit one explicit retry after settlement.`);
    }

    if (operation === 'start') {
      await shell.stop();
    }
  }
}

async function assertLifecycleConflict(
  transition: Promise<void>,
  active: PlatformLifecycleOperation,
  requested: PlatformLifecycleOperation,
): Promise<void> {
  const outcome = await Promise.race([
    transition.then(
      () => ({ status: 'fulfilled' }) as const,
      (error: unknown) => ({ error, status: 'rejected' }) as const,
    ),
    Promise.resolve().then(() => ({ status: 'pending' }) as const),
  ]);

  if (outcome.status === 'pending') {
    throw new Error(`${requested}() must reject with PlatformLifecycleConflictError while ${active}() is active.`);
  }

  if (outcome.status === 'fulfilled') {
    throw new Error(`${requested}() must reject while ${active}() is active.`);
  }

  if (!(outcome.error instanceof PlatformLifecycleConflictError)) {
    throw new Error(`${requested}() must reject with PlatformLifecycleConflictError while ${active}() is active.`);
  }

  const { error } = outcome;
  const metadata = error.meta;
  if (
    error.code !== 'PLATFORM_LIFECYCLE_CONFLICT' ||
    error.activeOperation !== active ||
    error.requestedOperation !== requested ||
    metadata?.['activeOperation'] !== active ||
    metadata?.['requestedOperation'] !== requested
  ) {
    throw new Error(`${requested}() returned incorrect PlatformLifecycleConflictError metadata.`);
  }
}

async function expectTransitionFailure(transition: Promise<void>, operation: PlatformLifecycleOperation): Promise<void> {
  try {
    await transition;
  } catch {
    return;
  }

  throw new Error(`The first ${operation}() transition must fail before retry conformance is checked.`);
}

/**
 * Create PlatformShell lifecycle conformance harness.
 *
 * @param options The options.
 * @returns The create PlatformShell lifecycle conformance harness result.
 */
export function createPlatformShellLifecycleConformanceHarness(
  options: PlatformShellLifecycleConformanceHarnessOptions,
): PlatformShellLifecycleConformanceHarness {
  return new PlatformShellLifecycleConformanceHarness(options);
}
