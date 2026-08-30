import { resolveStudioViewerPath, type StudioSidecar, startStudioSidecar } from './sidecar.js';

type CliStream = {
  write(message: string): unknown;
};

type ViewerLaunchOptions = {
  readonly host: string;
  readonly port: number;
};

/**
 * Defines optional dependencies for the standalone Studio viewer command.
 */
export interface StudioViewerCommandRuntime {
  startStudioSidecar?: typeof startStudioSidecar;
  stdout?: CliStream;
  waitForShutdown?: () => Promise<void>;
}

/**
 * Returns usage text for the standalone Studio viewer command.
 *
 * @returns The command usage text.
 */
export function studioUsage(): string {
  return [
    'Usage: fluo studio [options]',
    '',
    'Serve the installed @fluojs/studio viewer over local HTTP for static inspect artifacts.',
    '',
    'Options:',
    '  --host <host>  Bind the local viewer server (default: 127.0.0.1).',
    '  --port <port>  Bind the local viewer server port (default: 0).',
    '  --help, -h     Show help for the studio command.',
  ].join('\n');
}

function parsePort(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error('--port requires an integer from 0 through 65535.');
  }

  const port = Number(value);
  if (port > 65_535) {
    throw new Error('--port requires an integer from 0 through 65535.');
  }

  return port;
}

function parseViewerLaunchOptions(argv: string[]): ViewerLaunchOptions {
  let host = '127.0.0.1';
  let port = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--host') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--host requires a host value.');
      }
      host = value;
      index += 1;
      continue;
    }

    if (option === '--port') {
      port = parsePort(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown studio option "${option ?? ''}".`);
  }

  return { host, port };
}

function waitForProcessShutdown(): Promise<void> {
  return new Promise((resolve) => {
    const onShutdown = (): void => {
      process.off('SIGINT', onShutdown);
      process.off('SIGTERM', onShutdown);
      resolve();
    };

    process.once('SIGINT', onShutdown);
    process.once('SIGTERM', onShutdown);
  });
}

function viewerUrl(sidecar: StudioSidecar): string {
  const url = new URL(sidecar.url);
  url.searchParams.set('token', sidecar.token);
  return url.toString();
}

/**
 * Serves the installed Studio viewer until the caller stops the CLI process.
 *
 * @param argv Command arguments after `studio`.
 * @param runtime Optional process and server dependencies for embedding and tests.
 * @returns `0` after the server shuts down.
 */
export async function runStudioViewerCommand(argv: string[], runtime: StudioViewerCommandRuntime = {}): Promise<number> {
  const options = parseViewerLaunchOptions(argv);
  if (!resolveStudioViewerPath()) {
    throw new Error('Studio viewer is unavailable. Install @fluojs/studio as a development dependency first.');
  }

  const start = runtime.startStudioSidecar ?? startStudioSidecar;
  const sidecar = await start({ host: options.host, port: options.port, runtime: 'node' });

  try {
    const stdout = runtime.stdout ?? process.stdout;
    stdout.write(`Studio viewer: ${viewerUrl(sidecar)}\n`);
    await (runtime.waitForShutdown ?? waitForProcessShutdown)();
    return 0;
  } finally {
    await sidecar.close();
  }
}
