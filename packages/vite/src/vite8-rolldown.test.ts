import { fileURLToPath } from 'node:url';
import { build as buildWorkspaceVite, version as workspaceViteVersion } from 'vite';
import { build as buildVite8, type Plugin, type PluginOption, version as vite8Version } from 'vite8';
import { describe, expect, it } from 'vitest';

import { fluoDecoratorsPlugin } from './index.js';

const fixturePath = fileURLToPath(new URL('../test-fixtures/vite8-field-decorator.ts', import.meta.url));
const coreEntryPath = fileURLToPath(new URL('../../core/src/index.ts', import.meta.url));
const coreInternalPath = fileURLToPath(new URL('../../core/src/internal.ts', import.meta.url));
const coreRequestPipelinePath = fileURLToPath(new URL('../../core/src/request-pipeline.ts', import.meta.url));
const httpDecoratorsPath = fileURLToPath(new URL('../../http/src/decorators.ts', import.meta.url));
const decoratorBoundaryProbe: Plugin = {
  name: 'decorator-boundary-probe',
  transform(code, id) {
    if (id === fixturePath && code.includes('@FromBody')) {
      throw new Error('Field decorator syntax reached the normal Vite plugin stage.');
    }

    return null;
  },
};
const vitePipelines = [
  {
    build: buildWorkspaceVite as unknown as typeof buildVite8,
    name: `workspace Vite ${workspaceViteVersion}`,
  },
  {
    build: buildVite8,
    name: `Vite ${vite8Version} Rolldown`,
  },
];

describe('fluoDecoratorsPlugin Vite build integration', () => {
  it.each(vitePipelines)('$name preserves field decorator metadata through its real build pipeline', async ({ build, name }) => {
    const plugin = fluoDecoratorsPlugin() as unknown as PluginOption;
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [decoratorBoundaryProbe, plugin],
      resolve: {
        alias: [
          { find: '@fluojs/core/request-pipeline', replacement: coreRequestPipelinePath },
          { find: '@fluojs/core/internal', replacement: coreInternalPath },
          { find: '@fluojs/core', replacement: coreEntryPath },
          { find: '@fluojs/http', replacement: httpDecoratorsPath },
        ],
      },
      build: {
        minify: false,
        ssr: fixturePath,
        write: false,
      },
    });
    if (Array.isArray(result) || !('output' in result)) {
      throw new Error('Expected one Vite build output.');
    }

    const chunk = result.output.find((output) => output.type === 'chunk');

    expect(chunk?.type).toBe('chunk');
    if (chunk?.type !== 'chunk') {
      return;
    }

    const encodedModule = Buffer.from(chunk.code).toString('base64');
    const bundledModule = await import(`data:text/javascript;base64,${encodedModule}#${encodeURIComponent(name)}`);

    expect(bundledModule.default).toEqual([
      {
        metadata: { key: 'display_name', source: 'body' },
        propertyKey: 'name',
      },
    ]);
  });
});
