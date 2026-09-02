import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHttpAdapterPortabilityHarness,
  type NetworkHttpErrorRepresentationBootstrapOptions,
} from './http-adapter-portability.js';
import {
  createWebRuntimeHttpAdapterPortabilityHarness,
  type WebHttpErrorRepresentationBootstrapOptions,
} from './web-runtime-adapter-portability.js';

describe('HTTP error-representation abort portability', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes a request-finish observer to the network abort bootstrap', async () => {
    const bootstrapInspected = new Error('network abort bootstrap inspected');
    const harness = createHttpAdapterPortabilityHarness({
      async bootstrap(_rootModule, options: NetworkHttpErrorRepresentationBootstrapOptions) {
        expect(options.observers).toHaveLength(1);
        expect(options.observers[0]?.onRequestFinish).toEqual(expect.any(Function));
        throw bootstrapInspected;
      },
      createErrorRepresentationBootstrapOptions: (options) => options,
      name: 'abort-lifecycle-completion',
      async run() {
        throw new Error('run should not be used');
      },
    });

    await expect(harness.assertDoesNotCommitAbortedHttpErrorRepresentations()).rejects.toBe(bootstrapInspected);
  });

  it('bounds an aborted Web dispatch and closes the app when dispatch never settles', async () => {
    vi.useFakeTimers();
    let closeCalls = 0;
    let dispatchStartedResolve = (): void => {};
    const dispatchStarted = new Promise<void>((resolve) => {
      dispatchStartedResolve = resolve;
    });
    const harness = createWebRuntimeHttpAdapterPortabilityHarness({
      async bootstrap(_rootModule, options: WebHttpErrorRepresentationBootstrapOptions) {
        return {
          async close() {
            closeCalls += 1;
          },
          dispatch(request) {
            const html = options.errorRepresentation?.html;
            if (html === undefined) {
              return Promise.reject(new Error('Web abort portability bootstrap did not configure HTML errors.'));
            }

            void Reflect.apply(html.render, html, [{ request }]);
            dispatchStartedResolve();
            return new Promise<Response>(() => {});
          },
        };
      },
      createErrorRepresentationBootstrapOptions: (options) => options,
      name: 'never-settling-web-dispatch',
    });

    const assertion = harness.assertDoesNotCommitAbortedHttpErrorRepresentations();
    const assertionError = expect(assertion).rejects.toThrow(
      'never-settling-web-dispatch timed out while waiting for the aborted Web request dispatch to finish.',
    );
    await dispatchStarted;
    await vi.advanceTimersByTimeAsync(2_000);
    await assertionError;
    expect(closeCalls).toBe(1);
  });
});
