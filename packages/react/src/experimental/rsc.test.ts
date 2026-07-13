import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('@fluojs/react/experimental/rsc export boundary', () => {
  it('exports the experimental subpath without widening the stable root', async () => {
    // Given: the package export map and stable root entrypoint.
    const packageManifest = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const rootEntrypoint = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const clientEntrypoint = readFileSync(new URL('../client.ts', import.meta.url), 'utf8');

    // When: the experimental entrypoint is imported directly.
    const rsc = await import('./rsc.js');

    // Then: only the dedicated export map exposes the RSC runtime values.
    expect(packageManifest).toContain('"./experimental/rsc"');
    expect(packageManifest).toContain('"./dist/experimental/rsc.js"');
    expect(rootEntrypoint).not.toContain('./experimental/rsc.js');
    expect(rootEntrypoint).not.toContain('server-function');
    expect(clientEntrypoint).not.toContain('server-function');
    expect(Object.keys(rsc).sort()).toEqual([
      'REACT_RSC_DIAGNOSTIC_CODES',
      'REACT_RSC_FLIGHT_CONTENT_TYPE',
      'REACT_RSC_SUPPORTED_VERSION',
      'REACT_SERVER_FUNCTION_ERROR_CODES',
      'REACT_SERVER_FUNCTION_REQUEST_HEADER',
      'ReactServerFunctionClientError',
      'ReactServerFunctionConfigurationError',
      'createReactFlightResponse',
      'createReactRscManifest',
      'createReactServerFunctionClient',
      'createReactServerFunctionRegistry',
      'inspectReactRscEnvironment',
    ]);
  });
});
