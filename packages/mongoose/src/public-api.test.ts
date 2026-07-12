import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  MongooseAsyncModuleOptions,
  MongooseConnectionLike,
  MongooseHandleProvider,
  MongooseModelFacade,
  MongoosePlatformStatusSnapshotInput,
} from './index.js';
import * as mongoosePublicApi from './index.js';

type UserRecord = {
  readonly id: string;
  readonly name: string;
};

type UserModelFacade = MongooseModelFacade<
  Promise<readonly UserRecord[]>,
  Promise<readonly UserRecord[]>,
  Promise<UserRecord | null>,
  Promise<readonly { readonly count: number }[]>,
  Promise<{ readonly acknowledged: boolean }>
>;

function resolveTypedUserModel(handle: MongooseHandleProvider): UserModelFacade {
  return handle.model<UserModelFacade>('User');
}

describe('@fluojs/mongoose public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(mongoosePublicApi).toHaveProperty('MongooseConnection');
    expect(mongoosePublicApi).toHaveProperty('MongooseModule');
    expect(mongoosePublicApi).toHaveProperty('MongooseTransactionInterceptor');
    expect(mongoosePublicApi).toHaveProperty('createMongooseProviders');
    expect(mongoosePublicApi).toHaveProperty('Transaction');
    expect(mongoosePublicApi).toHaveProperty('createMongoosePlatformStatusSnapshot');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_CONNECTION');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_DISPOSE');
    expect(mongoosePublicApi).toHaveProperty('MONGOOSE_OPTIONS');
    expect(mongoosePublicApi).toHaveProperty('Transaction');
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(mongoosePublicApi).not.toHaveProperty('MONGOOSE_NORMALIZED_OPTIONS');
    expect(mongoosePublicApi).not.toHaveProperty('normalizeMongooseModuleOptions');
    expect(mongoosePublicApi).not.toHaveProperty('createMongooseProvidersAsync');
  });

  it('keeps documented type-only inputs importable from the root barrel', () => {
    expectTypeOf<MongooseAsyncModuleOptions<MongooseConnectionLike>>().toHaveProperty('useFactory');
    expectTypeOf<MongooseAsyncModuleOptions<MongooseConnectionLike>>().toHaveProperty('global');
    expectTypeOf<MongoosePlatformStatusSnapshotInput>().toHaveProperty('activeRequestTransactions');
    expectTypeOf<MongoosePlatformStatusSnapshotInput>().toHaveProperty('lifecycleState');
    expectTypeOf<MongoosePlatformStatusSnapshotInput>().toHaveProperty('supportsStartSession');
    expectTypeOf<MongooseHandleProvider<MongooseConnectionLike>>().toHaveProperty('model');
    expectTypeOf<MongooseModelFacade['create']>().toBeFunction();
    expectTypeOf<MongooseModelFacade['find']>().toBeFunction();
    expectTypeOf<MongooseModelFacade['findOne']>().toBeFunction();
    expectTypeOf<MongooseModelFacade['aggregate']>().toBeFunction();
    expectTypeOf<MongooseModelFacade['bulkWrite']>().toBeFunction();
    expectTypeOf<ReturnType<UserModelFacade['create']>>().toEqualTypeOf<Promise<readonly UserRecord[]>>();
    expectTypeOf<ReturnType<UserModelFacade['find']>>().toEqualTypeOf<Promise<readonly UserRecord[]>>();
    expectTypeOf<ReturnType<UserModelFacade['findOne']>>().toEqualTypeOf<Promise<UserRecord | null>>();
    expectTypeOf<ReturnType<UserModelFacade['aggregate']>>().toEqualTypeOf<
      Promise<readonly { readonly count: number }[]>
    >();
    expectTypeOf<ReturnType<UserModelFacade['bulkWrite']>>().toEqualTypeOf<
      Promise<{ readonly acknowledged: boolean }>
    >();
    expectTypeOf<ReturnType<typeof resolveTypedUserModel>>().toEqualTypeOf<UserModelFacade>();
  });
});
