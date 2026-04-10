import { describe, expect, it } from 'vitest';

import * as mongoosePublicApi from './index.js';

describe('@fluojs/mongoose public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(mongoosePublicApi).toHaveProperty('MongooseConnection');
    expect(mongoosePublicApi).toHaveProperty('MongooseModule');
    expect(mongoosePublicApi).toHaveProperty('createMongooseProviders');
    expect(mongoosePublicApi).toHaveProperty('MongooseTransactionInterceptor');
    expect(mongoosePublicApi).toHaveProperty('createMongoosePlatformStatusSnapshot');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_CONNECTION');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_DISPOSE');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_OPTIONS');
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(mongoosePublicApi).not.toHaveProperty('MONGOOSE_NORMALIZED_OPTIONS');
    expect(mongoosePublicApi).not.toHaveProperty('normalizeMongooseModuleOptions');
    expect(mongoosePublicApi).not.toHaveProperty('createMongooseProvidersAsync');
  });
});
