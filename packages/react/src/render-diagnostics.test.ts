import { RequestAbortedError } from '@fluojs/http/portable';
import { describe, expect, it, vi } from 'vitest';

import { ReactSsrDiagnosticError } from './diagnostics.js';
import type { ReactRenderContext } from './render.js';
import type { ReactServerEntry } from './server-entry.js';

function createRenderContext(): ReactRenderContext {
  return {
    metadata: {},
    request: {},
    response: { committed: false },
  } as unknown as ReactRenderContext;
}

describe('React render diagnostics', () => {
  it('preserves compatible duplicate-copy abort and SSR diagnostic errors without markers', async () => {
    const requestContext = createRenderContext();
    const duplicateAbortError = new RequestAbortedError();
    const duplicateDiagnosticError = new ReactSsrDiagnosticError('duplicate SSR diagnostic', {
      code: 'react-ssr-pre-commit-shell-failure',
      phase: 'pre-commit-shell',
    });
    vi.resetModules();
    const { createReactRenderDiagnostics } = await import('./render-diagnostics.js');
    const { ReactSsrDiagnosticError: currentDiagnosticError, readReactSsrDiagnosticMarker } = await import('./diagnostics.js');
    const diagnostics = createReactRenderDiagnostics({} as ReactServerEntry, requestContext);

    expect(duplicateDiagnosticError).not.toBeInstanceOf(currentDiagnosticError);
    expect(diagnostics.preservePreCommitShellError(duplicateAbortError)).toBe(duplicateAbortError);
    expect(readReactSsrDiagnosticMarker(requestContext, duplicateAbortError)).toBeUndefined();
    expect(diagnostics.preservePreCommitShellError(duplicateDiagnosticError)).toBe(duplicateDiagnosticError);
    expect(readReactSsrDiagnosticMarker(requestContext, duplicateDiagnosticError)).toBeUndefined();
  });

  it('transports request-local SSR diagnostic markers across compatible module copies once', async () => {
    // Given: copy A marks the original error inside one request context.
    const requestContext = createRenderContext();
    const error = new Error('original error');
    const diagnosticsA = await import('./diagnostics.js');
    diagnosticsA.markReactSsrDiagnostic(requestContext, error, {
      code: 'react-ssr-pre-commit-shell-failure',
      error,
      phase: 'pre-commit-shell',
    });

    // When: copy B consumes the marker.
    vi.resetModules();
    const diagnosticsB = await import('./diagnostics.js');

    // Then: the original error identity and classification survive, and consumption is one-shot.
    expect(diagnosticsB.readReactSsrDiagnosticMarker(requestContext, error)).toEqual({
      code: 'react-ssr-pre-commit-shell-failure',
      error,
      phase: 'pre-commit-shell',
    });
    expect(diagnosticsB.readReactSsrDiagnosticMarker(requestContext, error)).toBeUndefined();
  });
});
