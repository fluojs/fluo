import { describe, expect, it } from 'vitest';

import * as prismaPublicApi from './index.js';

describe('@fluojs/prisma public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(prismaPublicApi).toHaveProperty('PrismaModule');
    expect(prismaPublicApi).toHaveProperty('PrismaService');
    expect(prismaPublicApi).toHaveProperty('PrismaTransactionInterceptor');
    expect(prismaPublicApi).toHaveProperty('createPrismaPlatformStatusSnapshot');
    expect(prismaPublicApi).toHaveProperty('PRISMA_CLIENT');
    expect(prismaPublicApi).toHaveProperty('PRISMA_OPTIONS');
    expect(prismaPublicApi).toHaveProperty('getPrismaClientToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaOptionsToken');
    expect(prismaPublicApi).toHaveProperty('getPrismaServiceToken');
  });

  it('does not expose internal module wiring values from the root barrel', () => {
    expect(prismaPublicApi).not.toHaveProperty('PRISMA_NORMALIZED_OPTIONS');
    expect(prismaPublicApi).not.toHaveProperty('normalizePrismaModuleOptions');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaRuntimeProviders');
    expect(prismaPublicApi).not.toHaveProperty('createPrismaProviders');
  });
});
