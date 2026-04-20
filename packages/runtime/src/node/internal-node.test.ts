import { describe, expect, it } from 'vitest';

import * as internalNodeApi from './internal-node.js';
import * as publicNodeApi from '../node.js';

describe('runtime internal node seam', () => {
  it('keeps the public runtime/node path focused on supported node helpers', () => {
    expect(publicNodeApi.bootstrapNodeApplication).toBe(internalNodeApi.bootstrapNodeApplication);
    expect(publicNodeApi.createNodeHttpAdapter).toBe(internalNodeApi.createNodeHttpAdapter);
    expect(publicNodeApi.runNodeApplication).toBe(internalNodeApi.runNodeApplication);
    expect(publicNodeApi.createNodeShutdownSignalRegistration).toBe(internalNodeApi.createNodeShutdownSignalRegistration);
    expect(publicNodeApi).not.toHaveProperty('compressNodeResponse');
    expect(publicNodeApi).not.toHaveProperty('createNodeResponseCompression');
  });
});
