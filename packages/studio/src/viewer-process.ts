import type { ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

type ViewerProcess = NodeJS.EventEmitter &
  Pick<ChildProcessByStdio<null, Readable, Readable>, 'exitCode' | 'kill' | 'signalCode' | 'stderr' | 'stdout'>;

const DEFAULT_VIEWER_TIMEOUT_MS = 10_000;
const MAX_VIEWER_STARTUP_OUTPUT_LENGTH = 4_096;

class ViewerProcessTimeoutError extends Error {}

function exitResultMatches(signal: NodeJS.Signals, code: number | null, exitedSignal: NodeJS.Signals | null): boolean {
  return code === null && exitedSignal === signal;
}

function waitForViewerExit(process: ViewerProcess, signal: NodeJS.Signals, timeoutMs: number): Promise<void> {
  return new Promise((resolveExit, rejectExit) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      process.off('error', rejectFromError);
      process.off('exit', resolveFromExit);
    };
    const rejectFromError = (error: Error): void => {
      cleanup();
      rejectExit(error);
    };
    const resolveFromExit = (code: number | null, exitedSignal: NodeJS.Signals | null): void => {
      cleanup();

      if (exitResultMatches(signal, code, exitedSignal)) {
        resolveExit();
        return;
      }

      rejectExit(new Error(`Installed viewer exited with code ${String(code)} and signal ${String(exitedSignal)}; expected ${signal}.`));
    };

    process.once('error', rejectFromError);
    process.once('exit', resolveFromExit);

    if (process.exitCode !== null || process.signalCode !== null) {
      cleanup();
      resolveExit();
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      rejectExit(new ViewerProcessTimeoutError(`Installed viewer did not exit after ${signal} within ${String(timeoutMs)}ms.`));
    }, timeoutMs);

    try {
      const sent = process.kill(signal);
      if (!sent && process.exitCode === null && process.signalCode === null) {
        cleanup();
        rejectExit(new Error(`Failed to send ${signal} to the installed viewer.`));
      }
    } catch (error) {
      cleanup();
      rejectExit(error);
    }
  });
}

/**
 * Stops an installed Studio viewer process without leaving a child behind.
 *
 * @param process Viewer process started by the installed-viewer browser harness.
 * @param timeoutMs Bounded grace period used for each termination signal.
 * @returns A promise that resolves after the viewer exits.
 */
export async function stopViewerProcess(process: ViewerProcess, timeoutMs = DEFAULT_VIEWER_TIMEOUT_MS): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) {
    return;
  }

  try {
    await waitForViewerExit(process, 'SIGTERM', timeoutMs);
  } catch (error) {
    if (!(error instanceof ViewerProcessTimeoutError)) {
      throw error;
    }

    await waitForViewerExit(process, 'SIGKILL', timeoutMs);
  }
}

/**
 * Reads the first local URL announced by an installed Studio viewer process.
 *
 * @param process Viewer process started by the installed-viewer browser harness.
 * @param timeoutMs Bounded startup period for the URL announcement.
 * @returns The announced local Studio viewer URL.
 */
export function readViewerUrl(process: ViewerProcess, timeoutMs = DEFAULT_VIEWER_TIMEOUT_MS): Promise<URL> {
  return new Promise((resolveUrl, rejectUrl) => {
    let stderr = '';
    let stdout = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      process.stdout.off('data', resolveFromStdout);
      process.stderr.off('data', retainStderr);
      process.off('error', rejectFromError);
      process.off('exit', rejectFromExit);
    };
    const resolveWithUrl = (url: URL): void => {
      cleanup();
      resolveUrl(url);
    };
    const rejectWithError = (error: Error): void => {
      cleanup();
      rejectUrl(error);
    };
    const resolveFromStdout = (chunk: string): void => {
      stdout = `${stdout}${chunk}`.slice(-MAX_VIEWER_STARTUP_OUTPUT_LENGTH);
      const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+\//u)?.[0];

      if (url) {
        resolveWithUrl(new URL(url));
      }
    };
    const retainStderr = (chunk: string): void => {
      stderr = `${stderr}${chunk}`.slice(-MAX_VIEWER_STARTUP_OUTPUT_LENGTH);
    };
    const rejectFromError = (error: Error): void => rejectWithError(error);
    const rejectFromExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      rejectWithError(
        new Error(
          `Installed viewer exited before announcing its URL (code ${String(code)}, signal ${String(signal)}): stdout: ${stdout}; stderr: ${stderr}`,
        ),
      );
    };

    process.stdout.setEncoding('utf8');
    process.stderr.setEncoding('utf8');
    process.stdout.on('data', resolveFromStdout);
    process.stderr.on('data', retainStderr);
    process.once('error', rejectFromError);
    process.once('exit', rejectFromExit);

    if (process.exitCode !== null || process.signalCode !== null) {
      rejectFromExit(process.exitCode, process.signalCode);
      return;
    }

    timer = setTimeout(() => {
      rejectWithError(
        new Error(`Installed viewer did not announce its URL within ${String(timeoutMs)}ms: stdout: ${stdout}; stderr: ${stderr}`),
      );
    }, timeoutMs);
  });
}
