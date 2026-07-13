import { describe, expect, it } from 'vitest';

import { inspectReactRscEnvironment } from './rsc-diagnostics.js';
import {
  REACT_RSC_DIAGNOSTIC_CODES,
  REACT_RSC_SUPPORTED_VERSION,
} from './rsc-types.js';

describe('experimental RSC environment diagnostics', () => {
  it('accepts only the exact supported React stack and required runtime/build capabilities', () => {
    // Given: the exact supported React stack and explicit build/runtime capabilities.
    const environment = {
      build: {
        clientReferenceManifest: true,
        name: 'application-rsc-build',
        serverClientModuleMap: true,
      },
      flightRendererVersion: REACT_RSC_SUPPORTED_VERSION,
      reactDomVersion: REACT_RSC_SUPPORTED_VERSION,
      reactVersion: REACT_RSC_SUPPORTED_VERSION,
      runtime: {
        name: 'node',
        webStreams: true,
      },
    } as const;

    // When: support is inspected.
    const result = inspectReactRscEnvironment(environment);

    // Then: the environment is accepted without diagnostics.
    expect(result).toEqual({ diagnostics: [], ok: true });
  });

  it('diagnoses unsupported React, renderer, runtime, and build conditions', () => {
    // Given: every experimental compatibility boundary is unsupported.
    const environment = {
      build: {
        clientReferenceManifest: false,
        name: 'unconfigured',
        serverClientModuleMap: false,
      },
      flightRendererVersion: '19.2.5',
      reactDomVersion: '19.2.5',
      reactVersion: '19.3.0-canary-test',
      runtime: {
        name: 'legacy-host',
        webStreams: false,
      },
    } as const;

    // When: support is inspected.
    const result = inspectReactRscEnvironment(environment);

    // Then: callers receive stable, actionable diagnostics for every failed boundary.
    expect(result).toEqual({
      diagnostics: [
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedReactVersion }),
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedReactDomVersion }),
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedFlightRendererVersion }),
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.unsupportedRuntime }),
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.missingClientReferenceManifest }),
        expect.objectContaining({ code: REACT_RSC_DIAGNOSTIC_CODES.missingServerClientModuleMap }),
      ],
      ok: false,
    });
  });
});
