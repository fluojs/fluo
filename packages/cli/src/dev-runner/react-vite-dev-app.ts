import { createHash } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY } from '../studio/runtime-config.js';

/**
 * Keeps the React development WebSocket and public listener alive across app generations.
 *
 * @param projectDirectory Installed React application directory.
 * @param options Signal source and output streams for the supervised child.
 * @returns Zero after clean shutdown, or one when setup or cleanup fails.
 */
export async function runReactViteDevApp(
  projectDirectory: string,
  options: {
    port?: number;
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
  let appUrl: URL | undefined;
  const onSignal = () => {
    stopping = true;
    appUrl = undefined;
    interrupt();
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  let vite: import('vite').ViteDevServer | undefined;
  let closeApp: (() => Promise<void>) | undefined;
  let desiredGeneration = 0;
  let attemptedGeneration = -1;
  let reloadDocument = false;
  let restartInFlight: Promise<void> = Promise.resolve();
  let exitCode = 0;
  const sourcePrefix = `${join(projectDirectory, 'src').split(sep).join('/')}/`;
  const gateway = createServer((incoming, outgoing) => {
    const target = appUrl;
    if (!target) {
      outgoing.writeHead(503, { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '1' });
      outgoing.end('React dev server is restarting. Retry after readiness.\n');
      return;
    }
    const upstream = request({
      agent: false,
      hostname: target.hostname,
      headers: { ...incoming.headers, connection: 'close' },
      method: incoming.method,
      path: incoming.url ?? '/',
      port: target.port,
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', (error) => {
      if (outgoing.headersSent) outgoing.destroy(error);
      else {
        outgoing.writeHead(503, { 'retry-after': '1' });
        outgoing.end('React dev server is restarting. Retry after readiness.\n');
      }
    });
    incoming.pipe(upstream);
  });
  const listenGateway = async () => {
    if (gateway.listening) return;
    await new Promise<void>((resolve, reject) => {
      gateway.once('error', reject);
      gateway.listen(options.port ?? Number(process.env.PORT ?? '3000'), '127.0.0.1', () => {
        gateway.off('error', reject);
        resolve();
      });
    });
    process.send?.({ type: 'fluo:react-vite-host-ready' });
  };
  const collectServerFiles = async (developmentPages: ReadonlySet<string>): Promise<Set<string> | undefined> => {
    const root = await vite?.moduleGraph.getModuleByUrl('/src/main.ts');
    if (!root) return undefined;
    const visited = new Set<import('vite').ModuleNode>();
    const files = new Set<string>();
    const visit = (module: import('vite').ModuleNode) => {
      if (visited.has(module)) return;
      visited.add(module);
      if (module.file?.startsWith(sourcePrefix) && !developmentPages.has(module.file)) files.add(module.file);
      for (const dependency of module.importedModules) visit(dependency);
    };
    visit(root);
    return files;
  };
  const bootstrap = async () => {
    if (!vite || stopping) return;
    const generation = desiredGeneration;
    try {
      const entry: unknown = await vite.ssrLoadModule('/src/main.ts');
      if (stopping || generation !== desiredGeneration) return;
      if (typeof entry !== 'object' || entry === null || !('startReactViteApp' in entry) || typeof entry.startReactViteApp !== 'function') {
        throw new Error('The generated React entry must export startReactViteApp for fluo dev.');
      }
      const app: unknown = await entry.startReactViteApp(vite, gateway);
      if (typeof app !== 'object' || app === null || !('close' in app) || typeof app.close !== 'function'
        || !('url' in app) || typeof app.url !== 'string') {
        throw new Error('The generated React application must expose its shutdown lifecycle and listener URL.');
      }
      const close = app.close;
      closeApp = async () => { await close.call(app); };
      if (stopping || generation !== desiredGeneration) return;
      const pageModules = 'developmentPageModules' in entry && Array.isArray(entry.developmentPageModules)
        ? new Set(entry.developmentPageModules
          .filter((module): module is string => typeof module === 'string' && /^\.\//u.test(module))
          .map((module) => join(projectDirectory, 'src', module.slice(2))))
        : new Set<string>();
      const serverFiles = await collectServerFiles(pageModules);
      if (stopping || generation !== desiredGeneration) return;
      appUrl = new URL(app.url);
      if (serverFiles) {
        Reflect.set(process, Symbol.for('fluo:react-server-files'), serverFiles);
        process.send?.({ type: 'fluo:react-vite-server-files', files: [...serverFiles] });
      }
      await listenGateway();
      if (stopping || generation !== desiredGeneration) {
        appUrl = undefined;
        return;
      }
      stdout.write('[fluo] React dev app ready\n');
      process.send?.({ type: 'fluo:react-vite-app-ready', generation });
      vite.ws.send({ type: 'custom', event: 'fluo:server-status', data: { status: 'ready', generation } });
      if (reloadDocument) {
        vite.ws.send({ type: 'full-reload', path: '*' });
        reloadDocument = false;
      }
    } catch (error) {
      stderr.write(`[fluo] React dev startup failed (not ready; fix the source and save again): ${String(error)}\n`);
      vite.ws.send({ type: 'custom', event: 'fluo:server-status', data: { status: 'failed', generation } });
    }
  };
  const processRestarts = async () => {
    while (!stopping && desiredGeneration > attemptedGeneration) {
      appUrl = undefined;
      try {
        await closeApp?.();
      } catch (error) {
        stderr.write(`[fluo] React dev application shutdown failed: ${String(error)}\n`);
        exitCode = 1;
        stopping = true;
        interrupt();
        return;
      } finally {
        closeApp = undefined;
      }
      if (stopping) return;
      attemptedGeneration = desiredGeneration;
      await bootstrap();
    }
  };
  const onMessage = (message: unknown) => {
    if (!vite || stopping || typeof message !== 'object' || message === null || !('type' in message)) return;
    if (message.type === 'fluo:react-vite-hmr-reconcile'
      && 'file' in message && typeof message.file === 'string' && message.file.startsWith(sourcePrefix)) {
      vite.watcher.emit('change', message.file.split('/').join(sep));
    } else if (message.type === 'fluo:react-vite-server-restart'
      && 'files' in message && Array.isArray(message.files)
      && message.files.every((file) => typeof file === 'string' && file.startsWith(sourcePrefix))) {
      for (const file of message.files) {
        const modules = vite.moduleGraph.getModulesByFile(file);
        if (modules) for (const module of modules) vite.moduleGraph.invalidateModule(module);
      }
      if ('epoch' in message && typeof message.epoch === 'string') {
        process.env.FLUO_STUDIO_EPOCH = message.epoch;
        const config: unknown = Reflect.get(globalThis, STUDIO_DEVTOOLS_GLOBAL_CONFIG_KEY);
        if (typeof config === 'object' && config !== null) {
          Object.assign(config, { FLUO_STUDIO_EPOCH: message.epoch });
        }
      }
      reloadDocument ||= 'reload' in message && message.reload === true;
      desiredGeneration += 1;
      vite.ws.send({
        type: 'custom',
        event: 'fluo:server-status',
        data: {
          status: 'restarting',
          generation: desiredGeneration,
          reason: reloadDocument ? 'Shared server/client graph changed; reloading after readiness.' : 'Server graph changed; retaining document.',
        },
      });
      restartInFlight = restartInFlight.then(processRestarts);
    }
  };
  process.on('message', onMessage);

  try {
    const projectRequire = createRequire(join(projectDirectory, 'package.json'));
    const viteModule: typeof import('vite') = await import(pathToFileURL(projectRequire.resolve('vite')).href);
    if (!stopping) {
      vite = await viteModule.createServer({
        appType: 'custom',
        configFile: join(projectDirectory, 'vite.server.config.ts'),
        configLoader: 'runner',
        root: projectDirectory,
        server: {
          middlewareMode: true,
          watch: {
            ignored: [
              join(projectDirectory, '.env'),
              join(projectDirectory, 'vite.client.config.ts'),
              join(projectDirectory, 'vite.server.config.ts'),
            ],
          },
          ws: { server: gateway },
        },
      });
      vite.watcher.on('change', (file) => {
        try {
          process.send?.({
            type: 'fluo:react-vite-hmr-observed',
            file: file.split(sep).join('/'),
            digest: createHash('sha256').update(readFileSync(file)).digest('hex'),
          });
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        }
      });
      await vite.transformRequest('/src/entry-client.tsx');
      await vite.waitForRequestsIdle();
      attemptedGeneration = desiredGeneration;
      await bootstrap();
    }
    if (!stopping) await interrupted;
  } catch (error) {
    stderr.write(`[fluo] React dev startup failed: ${String(error)}\n`);
    exitCode = 1;
  } finally {
    stopping = true;
    appUrl = undefined;
    await restartInFlight;
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
    try {
      if (gateway.listening) {
        await new Promise<void>((resolve, reject) => gateway.close((error) => error ? reject(error) : resolve()));
      }
    } catch (error) {
      stderr.write(`[fluo] React dev HTTP shutdown failed: ${String(error)}\n`);
      exitCode = 1;
    }
    signals.off('SIGINT', onSignal);
    signals.off('SIGTERM', onSignal);
    process.off('message', onMessage);
    Reflect.deleteProperty(process, Symbol.for('fluo:react-server-files'));
  }

  return exitCode;
}
