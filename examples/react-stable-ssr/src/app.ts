import { Module } from '@fluojs/core';
import { ReactModule } from '@fluojs/react';

import {
  PreviewGuard,
  ProductCatalogService,
  ProductPageRouter,
  ReactSsrTraceMiddleware,
  RenderPhaseInterceptor,
} from './pages';

@Module({
  imports: [
    ReactModule.forRoot({
      controllers: [ProductPageRouter],
      middleware: [ReactSsrTraceMiddleware],
      providers: [ProductCatalogService, PreviewGuard, RenderPhaseInterceptor],
    }),
  ],
})
export class AppModule {}
