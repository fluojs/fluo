import { describe, expect, it } from 'vitest';

import * as internalNodeApi from './internal-node.js';
import * as compatibilityNodeApi from './node.js';

describe('runtime internal node seam', () => {
  it('keeps the public runtime/node path as a compatibility wrapper over the internal seam', () => {
    expect(compatibilityNodeApi.bootstrapNodeApplication).toBe(internalNodeApi.bootstrapNodeApplication);
    expect(compatibilityNodeApi.createNodeHttpAdapter).toBe(internalNodeApi.createNodeHttpAdapter);
    expect(compatibilityNodeApi.runNodeApplication).toBe(internalNodeApi.runNodeApplication);
    expect(compatibilityNodeApi.createNodeResponseCompression).toBe(internalNodeApi.createNodeResponseCompression);
    expect(compatibilityNodeApi.createNodeShutdownSignalRegistration).toBe(internalNodeApi.createNodeShutdownSignalRegistration);
  });
});
