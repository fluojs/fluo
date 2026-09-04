import { describe, expect, it } from 'vitest';

import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import { compileModuleGraph } from './module-graph.js';

describe('module graph alias visibility', () => {
  it('rejects aliases whose target is not exported by an imported module', () => {
    // Given
    const HIDDEN_SERVICE = Symbol('hidden-service');
    const SERVICE_ALIAS = Symbol('service-alias');

    class OwnerModule {}
    class ConsumerModule {}
    class AppModule {}

    defineRuntimeModuleMetadata(OwnerModule, {
      providers: [{ provide: HIDDEN_SERVICE, useValue: {} }],
    });
    defineRuntimeModuleMetadata(ConsumerModule, {
      imports: [OwnerModule],
      providers: [{ provide: SERVICE_ALIAS, useExisting: HIDDEN_SERVICE }],
    });
    defineRuntimeModuleMetadata(AppModule, {
      imports: [ConsumerModule],
    });

    // When
    const compile = () => compileModuleGraph(AppModule);

    // Then
    expect(compile).toThrow('not local, not exported by an imported module');
  });
});
