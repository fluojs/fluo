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
});
