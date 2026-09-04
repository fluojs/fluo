import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  PrismaAsyncModuleOptions as RootPrismaAsyncModuleOptions,
  PrismaClientLike,
  PrismaPlatformStatusSnapshotInput as RootPrismaPlatformStatusSnapshotInput,
} from './index.js';
import * as prismaPublicApi from './index.js';
import type { PrismaAsyncModuleOptions as ModulePrismaAsyncModuleOptions } from './module.js';
import type { PrismaPlatformStatusSnapshotInput as StatusPrismaPlatformStatusSnapshotInput } from './status.js';

type PrismaPublicApiTestTransactionClient = {
  readonly transaction: true;
};

type PrismaPublicApiTestTransactionOptions = {
  readonly isolationLevel: 'serializable';
};

type PrismaPublicApiTestClient = PrismaClientLike<
  PrismaPublicApiTestTransactionClient,
  PrismaPublicApiTestTransactionOptions
>;

describe('@fluojs/prisma public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(prismaPublicApi).toHaveProperty('PrismaModule');
    expect(prismaPublicApi).toHaveProperty('PrismaService');
    expect(prismaPublicApi).toHaveProperty('PrismaTransactionInterceptor');
    expect(prismaPublicApi).toHaveProperty('Transaction');
    expect(prismaPublicApi).toHaveProperty('createPrismaPlatformStatusSnapshot');
    expect(prismaPublicApi).toHaveProperty('PRISMA_CLIENT');
    expect(prismaPublicApi).toHaveProperty('PRISMA_OPTIONS');
    expect(prismaPublicApi).toHaveProperty('getPrismaClientToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaOptionsToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaServiceToken');
  });

  it('exports reusable async module and platform status input contracts', () => {
    expectTypeOf<RootPrismaAsyncModuleOptions<
      PrismaPublicApiTestClient,
      PrismaPublicApiTestTransactionClient,
      PrismaPublicApiTestTransactionOptions
    >>().toEqualTypeOf<ModulePrismaAsyncModuleOptions<
      PrismaPublicApiTestClient,
      PrismaPublicApiTestTransactionClient,
      PrismaPublicApiTestTransactionOptions
    >>();
    expectTypeOf<RootPrismaPlatformStatusSnapshotInput>()
      .toEqualTypeOf<StatusPrismaPlatformStatusSnapshotInput>();
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(prismaPublicApi).not.toHaveProperty('PRISMA_NORMALIZED_OPTIONS');
    expect(prismaPublicApi).not.toHaveProperty('normalizePrismaModuleOptions');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaRuntimeProviders');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaProviders');
  });
});
