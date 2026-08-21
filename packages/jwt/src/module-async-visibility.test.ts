import { Inject, type Constructor } from '@fluojs/core';
import { bootstrapApplication, defineModule } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { JwtModule } from './module.js';
import { JwtService } from './service.js';

function defineSiblingConsumerGraph(jwtModule: Constructor) {
  @Inject(JwtService)
  class SiblingJwtConsumer {
    constructor(readonly jwt: JwtService) {}
  }

  class JwtOwnerModule {}
  defineModule(JwtOwnerModule, { imports: [jwtModule] });

  class JwtConsumerModule {}
  defineModule(JwtConsumerModule, { providers: [SiblingJwtConsumer] });

  class AppModule {}
  defineModule(AppModule, { imports: [JwtOwnerModule, JwtConsumerModule] });

  return { consumer: SiblingJwtConsumer, rootModule: AppModule };
}

describe('JwtModule.forRootAsync provider visibility', () => {
  it('makes JWT providers visible to a non-importing sibling when global is true', async () => {
    // Given
    const graph = defineSiblingConsumerGraph(JwtModule.forRootAsync({
      global: true,
      useFactory: () => ({
        algorithms: ['HS256'],
        secret: 'global-visibility-secret',
      }),
    }));

    // When
    const app = await bootstrapApplication({ rootModule: graph.rootModule });

    try {
      const consumer = await app.container.resolve(graph.consumer);

      // Then
      expect(consumer.jwt).toBeInstanceOf(JwtService);
    } finally {
      await app.close();
    }
  });

  it('keeps JWT providers isolated from a non-importing sibling when global is omitted', async () => {
    // Given
    const graph = defineSiblingConsumerGraph(JwtModule.forRootAsync({
      useFactory: () => ({
        algorithms: ['HS256'],
        secret: 'omitted-global-secret',
      }),
    }));

    // When
    const compileModuleGraph = bootstrapApplication({ rootModule: graph.rootModule });

    // Then
    await expect(compileModuleGraph).rejects.toThrow(/not visible through a global module|JwtService/);
  });

  it('keeps JWT providers isolated from a non-importing sibling when global is false', async () => {
    // Given
    const graph = defineSiblingConsumerGraph(JwtModule.forRootAsync({
      global: false,
      useFactory: () => ({
        algorithms: ['HS256'],
        secret: 'local-visibility-secret',
      }),
    }));

    // When
    const compileModuleGraph = bootstrapApplication({ rootModule: graph.rootModule });

    // Then
    await expect(compileModuleGraph).rejects.toThrow(/not visible through a global module|JwtService/);
  });
});
