import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseTypegenGenerationMessage, type TypegenGenerationMessage } from './typegen-generation-protocol.js';
import { TypegenCommandError } from './typegen-options.js';

type TypegenGenerationRequest = {
  readonly cwd: string;
  readonly exportName: string;
  readonly modulePath: string;
};

/** Listener boundary for one short-lived typegen generation child. */
export type TypegenGenerationChild = {
  readonly offError: (listener: (error: Error) => void) => void;
  readonly offExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  readonly offMessage: (listener: (message: unknown) => void) => void;
  readonly onError: (listener: (error: Error) => void) => void;
  readonly onExit: (listener: (code: number | null, signal: NodeJS.Signals | null) => void) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
};

type TypegenGenerationSpawner = (request: TypegenGenerationRequest) => TypegenGenerationChild;

function createGenerationChild(request: TypegenGenerationRequest): TypegenGenerationChild {
  const currentPath = fileURLToPath(import.meta.url);
  const extension = extname(currentPath);
  const childPath = join(dirname(currentPath), `typegen-generation-child${extension}`);
  const execArgv = extension === '.ts'
    ? ['--experimental-import-meta-resolve', '--import', createRequire(import.meta.url).resolve('tsx')]
    : ['--experimental-import-meta-resolve'];
  const child = fork(childPath, [request.cwd, request.modulePath, request.exportName], {
    cwd: request.cwd,
    execArgv,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  return {
    offError: (listener) => child.off('error', listener),
    offExit: (listener) => child.off('exit', listener),
    offMessage: (listener) => child.off('message', listener),
    onError: (listener) => child.once('error', listener),
    onExit: (listener) => child.once('exit', listener),
    onMessage: (listener) => child.on('message', listener),
  };
}

function describeExit(code: number | null, signal: NodeJS.Signals | null): string {
  if (signal !== null) {
    return `signal ${signal}`;
  }
  return code === null ? 'without an exit code' : `with exit code ${String(code)}`;
}

/**
 * Waits for a generation child to return source and exit, then removes every completion listener.
 *
 * @param child Generation child listener boundary.
 * @returns Generated source after successful process exit.
 */
export function waitForTypegenGenerationChild(child: TypegenGenerationChild): Promise<string> {
  return new Promise((resolve, reject) => {
    let message: TypegenGenerationMessage | undefined;
    const cleanup = () => {
      child.offError(onError);
      child.offExit(onExit);
      child.offMessage(onMessage);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (value: unknown) => {
      try {
        message = parseTypegenGenerationMessage(value);
      } catch (error: unknown) {
        message = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      if (message?.kind === 'error') {
        reject(new TypegenCommandError(message.message));
        return;
      }
      if (message?.kind === 'source' && code === 0) {
        resolve(message.source);
        return;
      }
      reject(new TypegenCommandError(`Typegen generation process exited ${describeExit(code, signal)} before returning source.`));
    };
    child.onError(onError);
    child.onExit(onExit);
    child.onMessage(onMessage);
  });
}

/**
 * Runs one default typegen generation in a short-lived child process.
 *
 * @param request Consumer directory, application module path, and selected export.
 * @param spawnGeneration Child-process factory used by the default runtime and lifecycle tests.
 * @returns Generated source after the child process has exited.
 */
export async function runTypegenGenerationProcess(
  request: TypegenGenerationRequest,
  spawnGeneration: TypegenGenerationSpawner = createGenerationChild,
): Promise<string> {
  return waitForTypegenGenerationChild(spawnGeneration(request));
}
