import { describe, expect, it } from 'vitest';

import {
  createHttpAdapterPortabilityHarness,
  type NetworkHttpErrorRepresentationBootstrapOptions,
} from './http-adapter-portability.js';

describe('HTTP error-representation abort portability', () => {
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
});
