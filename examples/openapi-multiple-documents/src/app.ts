import { Module } from '@fluojs/core';
import { OpenApiModule } from '@fluojs/openapi';

@Module({
  imports: [
    OpenApiModule.forRoot({
      documentPath: '/openapi/public.json',
      title: 'Public API',
      ui: true,
      uiPath: '/docs/public',
      version: '1.0.0',
    }),
    OpenApiModule.forRoot({
      documentPath: '/openapi/admin.json',
      title: 'Admin API',
      ui: true,
      uiPath: '/docs/admin',
      version: '1.0.0',
    }),
  ],
})
export class AppModule {}
