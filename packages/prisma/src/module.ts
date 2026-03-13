import type { Provider } from '@konekti/di';
import { defineModule, type ModuleType } from '@konekti/runtime';

import { PrismaService } from './service';
import { PRISMA_CLIENT } from './tokens';
import { PrismaTransactionInterceptor } from './transaction';
import type { PrismaClientLike, PrismaModuleOptions } from './types';

export function createPrismaProviders<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): Provider[] {
  return [
    {
      provide: PRISMA_CLIENT,
      useValue: options.client,
    },
    PrismaService,
    PrismaTransactionInterceptor,
  ];
}

export function createPrismaModule<TClient extends PrismaClientLike<TTransactionClient>, TTransactionClient = TClient>(
  options: PrismaModuleOptions<TClient, TTransactionClient>,
): ModuleType {
  class PrismaModule {}

  return defineModule(PrismaModule, {
    exports: [PrismaService, PrismaTransactionInterceptor],
    providers: createPrismaProviders(options),
  });
}
