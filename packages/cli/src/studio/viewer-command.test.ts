import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioSidecar } from './sidecar.js';
import { runStudioViewerCommand, studioUsage } from './viewer-command.js';

const sidecarModule = vi.hoisted(() => ({
  resolveStudioViewerPath: vi.fn<() => string | undefined>(),
  startStudioSidecar: vi.fn(),
}));

vi.mock('./sidecar.js', () => sidecarModule);

function createSidecar(url: string): { close: ReturnType<typeof vi.fn>; sidecar: StudioSidecar } {
  const close = vi.fn(async (): Promise<void> => undefined);

  return {
    close,
    sidecar: {
      appId: 'test-app',
      close,
      env: {},
      epoch: 'test-epoch',
      host: '127.0.0.1',
      port: 0,
      token: 'test-token',
      url,
    },
  };
}

describe('Studio viewer command', () => {
  beforeEach(() => {
    sidecarModule.resolveStudioViewerPath.mockReturnValue('/tmp/viewer/index.html');
  });

  it('prints standalone viewer help when requested', async () => {
    // Given the standalone viewer command surface.

    // When its help text is rendered without the top-level CLI dispatcher.
    const usage = studioUsage();

    // Then it describes the supported HTTP viewer launch path.
    expect(usage).toContain('Usage: fluo studio [options]');
  });

  it('rejects an out-of-range viewer port', async () => {
    // Given a caller selecting a port outside the TCP port range.

    // When the caller starts the standalone viewer.
    const result = runStudioViewerCommand(['--port', '65536']);

    // Then the CLI rejects the invalid boundary input before starting a server.
    await expect(result).rejects.toThrow('--port requires an integer from 0 through 65535.');
  });

  it('closes the sidecar when URL construction fails after startup', async () => {
    // Given a started sidecar that reports a malformed listener URL.
    const { close, sidecar } = createSidecar('not a URL');

    // When the viewer command constructs the announcement URL.
    const result = runStudioViewerCommand([], {
      startStudioSidecar: async () => sidecar,
      stdout: { write: () => undefined },
      waitForShutdown: async () => undefined,
    });

    // Then the failed command closes the started sidecar.
    await expect(result).rejects.toThrow('Invalid URL');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the sidecar when writing the viewer URL fails', async () => {
    // Given a started sidecar and an output stream that rejects the announcement.
    const { close, sidecar } = createSidecar('http://127.0.0.1:51234');

    // When the viewer command writes its browser URL.
    const result = runStudioViewerCommand([], {
      startStudioSidecar: async () => sidecar,
      stdout: {
        write: () => {
          throw new Error('stdout closed');
        },
      },
      waitForShutdown: async () => undefined,
    });

    // Then the failed command closes the started sidecar.
    await expect(result).rejects.toThrow('stdout closed');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
