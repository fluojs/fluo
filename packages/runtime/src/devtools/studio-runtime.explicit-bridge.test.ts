import { describe, expect, it } from 'vitest';

import { bootstrapApplication } from '../bootstrap.js';
import { defineRuntimeModuleMetadata } from '../internal/core-metadata.js';
import type { ApplicationLogger } from '../types.js';
import type { StudioLiveEvent } from './contracts.js';
import { StudioDevtoolsRuntime } from './studio-runtime.js';

const logger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

describe('explicit Studio runtime bridge', () => {
  it('publishes bootstrap events through a Bun bridge without global configuration', async () => {
    // Given
    const events: StudioLiveEvent[] = [];
    class AppModule {}
    defineRuntimeModuleMetadata(AppModule, {});
    const studio = new StudioDevtoolsRuntime({
      appId: 'bun-app',
      runtime: 'bun',
      transport: { publish(event) { events.push(event); } },
    });

    // When
    const app = await bootstrapApplication({ logger, rootModule: AppModule, studio });

    // Then
    expect(events).toMatchObject([
      { sequence: 1, source: { appId: 'bun-app', runtime: 'bun' }, type: 'timing' },
      {
        payload: { appId: 'bun-app', graph: { nodes: [expect.objectContaining({ id: 'module:AppModule', kind: 'module' })] } },
        sequence: 2,
        source: { appId: 'bun-app', runtime: 'bun' },
        type: 'snapshot',
      },
    ]);

    await app.close();
  });
});
