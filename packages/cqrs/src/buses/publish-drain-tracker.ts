import type { ApplicationLogger } from '@fluojs/runtime';

/** Tracks active CQRS publish pipelines and their shutdown-drain capabilities. */
export class CqrsPublishDrainTracker {
  private readonly activePipelines = new Set<Promise<void>>();
  private readonly activeTokens = new Map<symbol, number>();
  private drainTimeouts = 0;

  constructor(private readonly logger: ApplicationLogger) {}

  /** Current count of bounded shutdown-drain timeouts. */
  get shutdownDrainTimeouts(): number {
    return this.drainTimeouts;
  }

  /** Whether at least one publish pipeline remains active. */
  get hasActivePipelines(): boolean {
    return this.activePipelines.size > 0;
  }

  /**
   * Returns whether a private publish capability belongs to active work.
   *
   * @param token Private publish-drain token from an opaque context.
   * @returns `true` while at least one associated pipeline is active.
   */
  isActive(token: symbol): boolean {
    return (this.activeTokens.get(token) ?? 0) > 0;
  }

  /**
   * Tracks one publish pipeline and releases its private capability on settlement.
   *
   * @param pipeline Publish work to track.
   * @param token Private drain token associated with the pipeline.
   * @returns A promise that mirrors the tracked pipeline.
   */
  async track(pipeline: Promise<void>, token: symbol): Promise<void> {
    this.activePipelines.add(pipeline);
    this.activeTokens.set(token, (this.activeTokens.get(token) ?? 0) + 1);

    try {
      await pipeline;
    } finally {
      this.activePipelines.delete(pipeline);
      const activeCount = this.activeTokens.get(token) ?? 0;

      if (activeCount <= 1) {
        this.activeTokens.delete(token);
      } else {
        this.activeTokens.set(token, activeCount - 1);
      }
    }
  }

  /**
   * Waits for publish quiescence within the configured shutdown bound.
   *
   * @param timeoutMs Maximum drain duration in milliseconds.
   * @returns A promise that resolves after quiescence or timeout reporting.
   */
  async drain(timeoutMs: number): Promise<void> {
    const drained = await this.awaitDrain(timeoutMs);

    if (drained) {
      return;
    }

    this.drainTimeouts += 1;
    this.logger.warn(
      `CQRS event shutdown drain exceeded ${String(timeoutMs)}ms with ${String(this.activePipelines.size)} active publish pipeline(s); continuing shutdown.`,
      'CqrsEventBusService',
    );
  }

  private async awaitDrain(timeoutMs: number): Promise<boolean> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((resolve) => {
      timeoutId = setTimeout(() => resolve(false), timeoutMs);
    });
    const drain = this.waitForQuiescence().then(() => true);

    try {
      return await Promise.race([drain, timeout]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async waitForQuiescence(): Promise<void> {
    while (this.activePipelines.size > 0) {
      await Promise.allSettled([...this.activePipelines]);
    }
  }
}
