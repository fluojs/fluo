import type { FetchStyleHttpAdapterRealtimeCapability, HttpApplicationAdapter } from '@fluojs/http';

/**
 * Describes the fetch style web socket conformance harness options contract.
 */
export interface FetchStyleWebSocketConformanceHarnessOptions<
  TAdapter extends HttpApplicationAdapter = HttpApplicationAdapter,
> {
  createAdapter: () => TAdapter;
  expectedReason: string;
  expectedSupport?: FetchStyleHttpAdapterRealtimeCapability['support'];
  name: string;
}

/**
 * Represents the fetch style web socket conformance harness.
 */
export class FetchStyleWebSocketConformanceHarness<
  TAdapter extends HttpApplicationAdapter = HttpApplicationAdapter,
> {
  constructor(private readonly options: FetchStyleWebSocketConformanceHarnessOptions<TAdapter>) {}

  assertExposesRawWebSocketExpansionContract(): void {
    const adapter = this.options.createAdapter();

    if (typeof adapter.getRealtimeCapability !== 'function') {
      throw new Error(`${this.options.name} adapter must expose getRealtimeCapability() for fetch-style websocket contract checks.`);
    }

    const capability = adapter.getRealtimeCapability();
    const expectedSupport = this.options.expectedSupport ?? 'contract-only';

    if (capability.kind !== 'fetch-style') {
      throw new Error(`${this.options.name} adapter must expose a fetch-style realtime capability.`);
    }

    if (capability.contract !== 'raw-websocket-expansion') {
      throw new Error(`${this.options.name} adapter changed the raw websocket expansion contract tag.`);
    }

    if (capability.mode !== 'request-upgrade') {
      throw new Error(`${this.options.name} adapter changed the fetch-style raw websocket upgrade mode.`);
    }

    if (capability.version !== 1) {
      throw new Error(`${this.options.name} adapter changed the fetch-style raw websocket contract version.`);
    }

    if (capability.support !== expectedSupport) {
      throw new Error(
        `${this.options.name} adapter changed raw websocket support honesty. Expected "${expectedSupport}" but received "${capability.support}".`,
      );
    }

    if (capability.reason !== this.options.expectedReason) {
      throw new Error(`${this.options.name} adapter changed the fetch-style raw websocket contract reason.`);
    }
  }
}

/**
 * Create fetch style web socket conformance harness.
 *
 * @param options The options.
 * @returns The create fetch style web socket conformance harness result.
 */
export function createFetchStyleWebSocketConformanceHarness<
  TAdapter extends HttpApplicationAdapter = HttpApplicationAdapter,
>(
  options: FetchStyleWebSocketConformanceHarnessOptions<TAdapter>,
): FetchStyleWebSocketConformanceHarness<TAdapter> {
  return new FetchStyleWebSocketConformanceHarness(options);
}
