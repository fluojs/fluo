import type { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Starts Vite's SSR transform and client middleware inside one supervised React app child.
 *
 * @param projectDirectory Installed React application directory.
 * @param options Signal source and output streams for the supervised child.
 * @returns Zero after clean shutdown, or one when startup or cleanup fails.
 */
export async function runReactViteDevApp(
  projectDirectory: string,
  options: {
    signalTarget?: EventEmitter;
    stderr?: Pick<NodeJS.WriteStream, 'write'>;
    stdout?: Pick<NodeJS.WriteStream, 'write'>;
  } = {},
): Promise<number> {
  const signals = options.signalTarget ?? process;
  const stderr = options.stderr ?? process.stderr;
  const stdout = options.stdout ?? process.stdout;
  let interrupt: () => void = () => undefined;
  const interrupted = new Promise<void>((resolve) => { interrupt = resolve; });
  let stopping = false;
  const onSignal = () => {
    stopping = true;
    interrupt();
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  let vite: import('vite').ViteDevServer | undefined;
  let closeApp: (() => Promise<void>) | undefined;
  let exitCode = 0;

  try {
    const projectRequire = createRequire(join(projectDirectory, 'package.json'));
  const viteModule: typeof import('vite') = await import(pathToFileURL(projectRequire.resolve('vite')).href);
    if (!stopping) {
      vite = await viteModule.createServer({
        appType: 'custom',
        configFile: join(projectDirectory, 'vite.server.config.ts'),
        configLoader: 'runner',
        root: projectDirectory,
        server: { hmr: false, middlewareMode: true },
      });
    }

    if (vite && !stopping) {
      const entry: unknown = await vite.ssrLoadModule('/src/main.ts');
      if (!stopping) {
        if (typeof entry !== 'object' || entry === null || !('startReactViteApp' in entry) || typeof entry.startReactViteApp !== 'function') {
          throw new Error('The generated React entry must export startReactViteApp for fluo dev.');
        }
        const app: unknown = await entry.startReactViteApp(vite);
        if (typeof app !== 'object' || app === null || !('close' in app)) {
          throw new Error('The generated React application must expose its shutdown lifecycle.');
        }
        const close = app.close;
        if (typeof close !== 'function') {
          throw new Error('The generated React application must expose its shutdown lifecycle.');
        }
        closeApp = async () => { await close.call(app); };
      }
    }

    if (!stopping) {
      stdout.write('[fluo] React dev app ready\n');
      await interrupted;
    }
  } catch (error) {
    stderr.write(`[fluo] React dev startup failed: ${String(error)}\n`);
    exitCode = 1;
  } finally {
    try {
      await closeApp?.();
    } catch (error) {
      stderr.write(`[fluo] React dev application shutdown failed: ${String(error)}\n`);
      exitCode = 1;
    }
    try {
      await vite?.close();
    } catch (error) {
      stderr.write(`[fluo] React dev Vite shutdown failed: ${String(error)}\n`);
      exitCode = 1;
    }
    signals.off('SIGINT', onSignal);
    signals.off('SIGTERM', onSignal);
  }

  return exitCode;
}
