import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { cpus, platform, release } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const suite = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** Read resolved installations rather than treating dependency ranges as versions. */
export async function readDeliveryVersions(app) {
  const versions = {};
  for (const name of ['react', 'react-dom', 'vite', '@fluojs/react']) {
    const path = await realpath(resolve(app, 'node_modules', name, 'package.json'));
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-|$)/u.test(manifest.version)) {
      throw new TypeError(`Unavailable resolved package version: ${name}`);
    }
    versions[name] = { version: manifest.version, manifestPath: path };
  }
  return versions;
}

/** Retain tracked patches and untracked source inputs instead of a dirty flag alone. */
export async function captureDeliverySource(source, output) {
  const [{ stdout: head }, { stdout: patch }, { stdout: dirty }, { stdout: paths }, { stdout: pnpm }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: source }),
    execFileAsync('git', ['diff', 'HEAD', '--binary'], { cwd: source }),
    execFileAsync('git', ['status', '--porcelain=v1'], { cwd: source }),
    execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: source }),
    execFileAsync('pnpm', ['--version'], { cwd: source }),
  ]);
  const untracked = [];
  for (const path of paths.trim().split('\n').filter(Boolean).sort()) {
    const content = await readFile(resolve(source, path), 'utf8');
    untracked.push({ path, sha256: sha256(content), content });
  }
  const snapshot = `${JSON.stringify(untracked, null, 2)}\n`;
  await writeFile(resolve(output, 'source.patch'), patch, { flag: 'wx' });
  await writeFile(resolve(output, 'untracked-inputs.json'), snapshot, { flag: 'wx' });
  return {
    head: head.trim(), dirty: dirty.trim(), patchSha256: sha256(patch),
    untrackedSha256: sha256(snapshot),
    pnpm: pnpm.trim(),
  };
}

/** Capture the emitted production graph without changing chunks or the manifest. */
export function deliveryGraphPlugin(consume) {
  return {
    name: 'fluo-client-delivery-observation',
    generateBundle(_options, bundle) {
      consume({
        version: 1,
        chunks: Object.values(bundle).filter((item) => item.type === 'chunk').map((chunk) => ({
          file: chunk.fileName,
          entry: chunk.isEntry,
          dynamicEntry: chunk.isDynamicEntry,
          facade: chunk.facadeModuleId,
          bytes: Buffer.byteLength(chunk.code),
          sha256: sha256(chunk.code),
          imports: [...chunk.imports],
          dynamicImports: [...chunk.dynamicImports],
          modules: Object.entries(chunk.modules).map(([id, info]) => ({
            id,
            renderedBytes: info.renderedLength,
            originalBytes: info.originalLength,
          })),
        })).sort((a, b) => a.file.localeCompare(b.file)),
      });
    },
  };
}

/** Follow only emitted static import edges, never infer a route or a destination. */
export function staticChunkClosure(graph, entries) {
  const chunks = new Map(graph.chunks.map((chunk) => [chunk.file, chunk]));
  const visited = new Set();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    const chunk = chunks.get(file);
    if (!chunk) throw new TypeError(`Missing emitted chunk: ${file}`);
    visited.add(file);
    pending.push(...chunk.imports);
  }
  return [...visited].sort();
}

/** Report code membership and duplicate emitted modules separately from transfer. */
export function summarizeDeliveryGraph(graph, entries) {
  const eager = staticChunkClosure(graph, entries);
  const owners = new Map();
  const reactRuntimeRoots = new Set();
  for (const chunk of graph.chunks) {
    for (const module of chunk.modules) {
      if (module.renderedBytes === 0) continue;
      const files = owners.get(module.id) ?? [];
      files.push(chunk.file);
      owners.set(module.id, files);
      const id = module.id.replace(/^\0/u, '').split('?', 1)[0];
      const marker = id.indexOf('/node_modules/react/');
      if (marker !== -1) reactRuntimeRoots.add(id.slice(0, marker + '/node_modules/react'.length));
    }
  }
  return {
    eager,
    eagerBytes: graph.chunks.filter((chunk) => eager.includes(chunk.file))
      .reduce((sum, chunk) => sum + chunk.bytes, 0),
    lazy: graph.chunks.filter((chunk) => !eager.includes(chunk.file)).map((chunk) => chunk.file),
    duplicateModules: [...owners].filter(([, files]) => files.length > 1)
      .map(([id, files]) => ({ id, files })),
    reactRuntimeRoots: [...reactRuntimeRoots].sort(),
  };
}

/** Missing asset bodies remain unavailable; encoded transport includes protocol overhead. */
export function summarizeDeliveryRequests(requests) {
  const assets = requests.filter((request) => request.type === 'Script' || request.type === 'Stylesheet');
  const complete = assets.length > 0 && assets.every((request) =>
    request.complete && Number.isFinite(request.decodedBytes) && Number.isFinite(request.encodedTransportBytes));
  const transfers = new Map();
  for (const request of assets) {
    if (request.complete && !request.diskCache && !request.serviceWorker && request.encodedTransportBytes > 0) {
      transfers.set(request.url, (transfers.get(request.url) ?? 0) + 1);
    }
  }
  return {
    status: complete ? 'complete' : 'inconclusive',
    decodedBytes: complete ? assets.reduce((sum, request) => sum + request.decodedBytes, 0) : null,
    encodedTransportBytes: complete ? assets.reduce((sum, request) => sum + request.encodedTransportBytes, 0) : null,
    duplicateTransfers: [...transfers].filter(([, count]) => count > 1)
      .map(([url, count]) => ({ url, count })),
  };
}

/** Attribute stages to observed requests and exact rendered DOM, not store completion. */
export function attributeDeliveryStages(manifest, requests, domStages, initial, destination, base = '/assets/') {
  const observed = (name, predicate) => {
    const request = requests.find(predicate);
    if (!request?.complete || !Number.isFinite(request.end)) throw new TypeError(`Missing delivery stage: ${name}`);
    return { name, clock: 'cdp-monotonic-seconds', requestId: request.id, start: request.start, end: request.end };
  };
  const moduleStage = (name, payload) => {
    const key = payload?.destination?.module;
    if (typeof key !== 'string' || !key.startsWith('./')) throw new TypeError(`Missing approved module: ${name}`);
    const built = manifest[`src/${key.slice(2)}`];
    if (!built?.file) throw new TypeError(`Unbuilt approved module: ${key}`);
    return { ...observed(name, (request) =>
      request.type === 'Script' && new URL(request.url).pathname === `${base}${built.file}`), module: key, file: built.file };
  };
  const bootstrap = Object.values(manifest).find((entry) => entry.isEntry && entry.name === 'entry-client');
  if (!bootstrap) throw new TypeError('Missing built bootstrap');
  const dom = (name) => {
    const stage = domStages.find((entry) => entry.name === name);
    if (!stage || !Number.isFinite(stage.time)) throw new TypeError(`Missing rendered delivery stage: ${name}`);
    return { ...stage, clock: 'document-performance-milliseconds' };
  };
  return [
    observed('html', (request) => request.type === 'Document'),
    observed('bootstrap', (request) => new URL(request.url).pathname === `${base}${bootstrap.file}`),
    moduleStage('initial-module', initial),
    dom('hydration-control-ack'),
    observed('navigation-payload', (request) => request.accept === 'application/vnd.fluo.react-navigation+json;v=2'),
    moduleStage('destination-module', destination),
    dom('rendered-commit'),
    dom('rendered-frame'),
  ];
}

/** Attach CDP observers before document navigation or an activation stimulus. */
export async function observeDeliveryRequests(page) {
  const cdp = await page.context().newCDPSession(page);
  const requests = new Map();
  const bodies = new Set();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (event) => {
    requests.set(event.requestId, {
      id: event.requestId,
      url: event.request.url,
      method: event.request.method,
      accept: event.request.headers.Accept ?? event.request.headers.accept ?? null,
      type: event.type,
      start: event.timestamp,
      wallTime: event.wallTime,
      initiator: event.initiator,
      complete: false,
    });
  });
  cdp.on('Network.responseReceived', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    Object.assign(request, {
      response: event.timestamp,
      status: event.response.status,
      headers: event.response.headers,
      diskCache: event.response.fromDiskCache,
      serviceWorker: event.response.fromServiceWorker,
      contentEncoding: Object.entries(event.response.headers)
        .find(([name]) => name.toLowerCase() === 'content-encoding')?.[1] ?? null,
    });
  });
  cdp.on('Network.loadingFailed', (event) => {
    const request = requests.get(event.requestId);
    if (request) Object.assign(request, { error: event.errorText, end: event.timestamp });
  });
  cdp.on('Network.loadingFinished', (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    Object.assign(request, { end: event.timestamp, encodedTransportBytes: event.encodedDataLength });
    const body = cdp.send('Network.getResponseBody', { requestId: event.requestId }).then((result) => {
      Object.assign(request, {
        decodedBytes: result.base64Encoded
          ? Buffer.from(result.body, 'base64').byteLength : Buffer.byteLength(result.body),
        complete: true,
      });
    }, (error) => {
      request.bodyError = error.message;
    });
    bodies.add(body);
    void body.finally(() => bodies.delete(body));
  });
  return {
    cdp,
    async finish() {
      await Promise.all([...bodies]);
      await cdp.detach();
      return [...requests.values()];
    },
  };
}

/** Reject absent, partial, symlink-escaped or out-of-root trace references. */
export async function verifyDeliveryTraceFiles(root, paths) {
  const outputRoot = await realpath(root);
  if (!paths.length) throw new TypeError('Delivery traces are required');
  for (const path of paths) {
    const absolute = await realpath(resolve(outputRoot, path));
    const rel = relative(outputRoot, absolute);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new TypeError(`Delivery trace outside output root: ${path}`);
    }
    const trace = JSON.parse(await readFile(absolute, 'utf8'));
    if (trace.version !== 1 || trace.complete !== true || !trace.provenance
      || !Array.isArray(trace.requests) || !trace.requests.length
      || trace.requests.some((request) => request.complete !== true)
      || trace.inventory?.status !== 'complete'
      || !Array.isArray(trace.attributed) || trace.attributed.length !== 8) {
      throw new TypeError(`Incomplete delivery trace: ${path}`);
    }
    const provenance = trace.provenance;
    if (!/^[a-f0-9]{40}$/u.test(provenance.head)
      || !/^[a-f0-9]{64}$/u.test(provenance.lockSha256)
      || !/^[a-f0-9]{64}$/u.test(provenance.buildId)
      || !provenance.browser || !provenance.runtime || !provenance.pnpm
      || !provenance.dataset || !provenance.profile || !provenance.uncertainty
      || ['react', 'react-dom', 'vite', '@fluojs/react'].some((name) =>
        !provenance.resolvedVersions?.[name]?.version)
      || !['cold', 'warm'].includes(provenance.cache)) {
      throw new TypeError(`Incomplete delivery provenance: ${path}`);
    }
    const names = ['html', 'bootstrap', 'initial-module', 'hydration-control-ack',
      'navigation-payload', 'destination-module', 'rendered-commit', 'rendered-frame'];
    if (trace.attributed.some((stage, index) => stage.name !== names[index]
      || (stage.clock === 'document-performance-milliseconds' ? !Number.isFinite(stage.time)
        : stage.clock !== 'cdp-monotonic-seconds' || !Number.isFinite(stage.start) || !Number.isFinite(stage.end)
          || !trace.requests.some((request) => request.id === stage.requestId && request.complete)))) {
      throw new TypeError(`Incomplete delivery attribution: ${path}`);
    }
    for (const [file, field] of [
      ['source.patch', 'patchSha256'], ['untracked-inputs.json', 'untrackedSha256'],
      ['manifest.json', 'manifestSha256'], ['package.json', 'packageSha256'],
    ]) {
      const artifact = await realpath(resolve(dirname(absolute), file));
      const location = relative(outputRoot, artifact);
      if (location.startsWith(`..${sep}`) || location === '..' || isAbsolute(location)
        || sha256(await readFile(artifact)) !== provenance[field]) {
        throw new TypeError(`Mismatched delivery artifact: ${file}`);
      }
    }
  }
}

/** Exercise the installed canonical starter; supplemental traces never replace profile metrics. */
async function collectStarterTraces(app, source, output, url, graph, manifestText) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const stages = [];
      const signals = new Map();
      Reflect.set(window, '__starterDelivery', { stages, signals });
      signals.set('hydrated', new Promise((resolveReady, rejectReady) => {
        const check = () => {
          const counter = [...document.querySelectorAll('button')]
            .find((button) => button.textContent === 'Count: 0');
          if (!counter || counter.disabled) return;
          observer.disconnect();
          clearTimeout(deadline);
          resolveReady();
        };
        const observer = new MutationObserver(check);
        const deadline = setTimeout(() => {
          observer.disconnect();
          rejectReady(new Error('Starter hydration signal did not arrive'));
        }, 10_000);
        observer.observe(document, { subtree: true, childList: true, attributes: true });
        check();
      }));
    });
    for (const cache of ['cold', 'warm']) {
      const observer = await observeDeliveryRequests(page);
      const approvals = [];
      const diagnostics = [];
      const onRequest = (request) => {
        if (request.headers().accept === 'application/vnd.fluo.react-navigation+json;v=2') approvals.push(request.url());
      };
      const onError = (error) => diagnostics.push(error.message);
      page.on('request', onRequest);
      page.on('pageerror', onError);
      const documentResponse = await page.goto(url, { waitUntil: 'load' });
      if (documentResponse?.status() !== 200) throw new Error('Starter document did not succeed');
      await page.evaluate(() => Reflect.get(window, '__starterDelivery').signals.get('hydrated'));
      await page.evaluate(() => {
        const delivery = Reflect.get(window, '__starterDelivery');
        const subscribe = (name, selector, text) => {
          delivery.signals.set(name, new Promise((resolveSignal, rejectSignal) => {
            const check = () => {
              if (![...document.querySelectorAll(selector)].some((element) => element.textContent.includes(text))) return;
              observer.disconnect();
              clearTimeout(deadline);
              delivery.stages.push({ name, time: performance.now() });
              resolveSignal();
            };
            const observer = new MutationObserver(check);
            const deadline = setTimeout(() => {
              observer.disconnect();
              rejectSignal(new Error(`Starter delivery signal did not arrive: ${name}`));
            }, 10_000);
            observer.observe(document, { subtree: true, childList: true, characterData: true });
            check();
          }));
        };
        subscribe('hydration-control-ack', 'button', 'Shell taps: 1');
        subscribe('rendered-commit', 'h1', 'Search: catalog');
      });
      await page.getByRole('button', { name: 'Shell taps: 0', exact: true }).click();
      await page.evaluate(() => Reflect.get(window, '__starterDelivery').signals.get('hydration-control-ack'));
      if (approvals.length) throw new Error('Starter hydration issued redundant initial approval');
      const initial = await page.evaluate(() => JSON.parse(document.getElementById('fluo-initial-page').textContent));
      const approved = page.waitForResponse((response) =>
        response.request().headers().accept === 'application/vnd.fluo.react-navigation+json;v=2'
        && new URL(response.url()).pathname === '/search', { timeout: 10_000 });
      await page.getByRole('link', { name: 'Search catalog', exact: true }).first().click();
      const destination = await (await approved).json();
      await page.evaluate(() => Reflect.get(window, '__starterDelivery').signals.get('rendered-commit'));
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => {
        Reflect.get(window, '__starterDelivery').stages.push({ name: 'rendered-frame', time: performance.now() });
        resolveFrame();
      }))));
      const requests = await observer.finish();
      const inventory = summarizeDeliveryRequests(requests);
      if (approvals.length !== 1 || diagnostics.length || inventory.status !== 'complete' || inventory.duplicateTransfers.length) {
        throw new Error(`Incomplete starter delivery: ${JSON.stringify({ approvals, diagnostics, inventory })}`);
      }
      const stages = await page.evaluate(() => Reflect.get(window, '__starterDelivery').stages);
      const attributed = attributeDeliveryStages(JSON.parse(manifestText), requests, stages, initial, destination);
      const directory = resolve(output, cache);
      await mkdir(directory);
      const sourceIdentity = await captureDeliverySource(source, directory);
      const packageText = await readFile(resolve(app, 'package.json'), 'utf8');
      await writeFile(resolve(directory, 'manifest.json'), manifestText);
      await writeFile(resolve(directory, 'package.json'), packageText);
      await writeFile(resolve(directory, 'trace.json'), `${JSON.stringify({
        version: 1, complete: true, initial, destination, stages, attributed, requests, inventory,
        provenance: {
          ...graph.provenance, ...sourceIdentity, browser: browser.version(), runtime: process.version,
          packageSha256: sha256(packageText), cache, activation: 'private-ordinary',
          buildId: initial.buildId, dataset: 'installed-react-vite-ssr-starter',
          profile: 'unthrottled-correctness', viewport: page.viewportSize(),
          uncertainty: 'one correctness journey with observer overhead, not a representative profile receipt',
        },
      }, null, 2)}\n`);
      await page.screenshot({ path: resolve(directory, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 820, height: 1180 });
      await page.screenshot({ path: resolve(directory, 'mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      page.off('request', onRequest);
      page.off('pageerror', onError);
    }
    await verifyDeliveryTraceFiles(output, ['cold/trace.json', 'warm/trace.json']);
    console.log(`CLIENT_DELIVERY_STARTER_TRACES ${output}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--observe-output')) {
    const output = await realpath(resolve(args[args.indexOf('--observe-output') + 1]));
    const allowed = await realpath(resolve(suite, 'results/issue-3884'));
    if (!output.startsWith(`${allowed}${sep}`) || !args.includes('--capture-url')) {
      throw new TypeError('Observe a retained issue-3884 build with --capture-url');
    }
    const graph = JSON.parse(await readFile(resolve(output, 'graph.json'), 'utf8'));
    const manifest = await readFile(resolve(output, 'manifest.json'), 'utf8');
    if (sha256(manifest) !== graph.provenance.manifestSha256
      || sha256(await readFile(graph.provenance.manifestPath)) !== graph.provenance.manifestSha256) {
      throw new TypeError('Retained or served build manifest changed');
    }
    await collectStarterTraces(graph.provenance.app, graph.provenance.source, output,
      args[args.indexOf('--capture-url') + 1], graph, manifest);
    return;
  }
  if (args.includes('--capture-url')) {
    throw new TypeError('Build first, start that installed starter, then use --observe-output with --capture-url');
  }
  const appArgument = args[args.indexOf('--build-root') + 1];
  const outputArgument = args[args.indexOf('--output-dir') + 1];
  const lockArgument = args.includes('--lockfile') ? args[args.indexOf('--lockfile') + 1] : undefined;
  const sourceArgument = args.includes('--source-root') ? args[args.indexOf('--source-root') + 1] : undefined;
  if (!args.includes('--build-root') || !args.includes('--output-dir') || !appArgument || !outputArgument) {
    throw new TypeError('usage: node src/client-delivery.mjs --build-root <app> --output-dir results/issue-3884/<invocation>');
  }
  const app = await realpath(resolve(appArgument));
  const source = sourceArgument ? await realpath(resolve(sourceArgument)) : app;
  const output = resolve(outputArgument);
  const allowed = resolve(suite, 'results/issue-3884');
  if (!output.startsWith(`${allowed}${sep}`)) throw new TypeError('Delivery output must stay inside results/issue-3884');
  await mkdir(output, { recursive: true });
  const sourceIdentity = await captureDeliverySource(source, output);
  const { stdout: packageManager } = await execFileAsync('pnpm', ['--version'], { cwd: app });
  const requireFromApp = createRequire(resolve(app, 'package.json'));
  const { build, loadConfigFromFile, mergeConfig, version: viteVersion } =
    await import(pathToFileURL(requireFromApp.resolve('vite')).href);
  const configPath = resolve(app, 'vite.client.config.ts');
  const config = await loadConfigFromFile({ command: 'build', mode: 'production' }, configPath);
  if (!config) throw new TypeError(`Missing production configuration: ${configPath}`);
  let graph;
  await build(mergeConfig(config.config, {
    root: app,
    configFile: false,
    plugins: [deliveryGraphPlugin((value) => { graph = value; })],
  }));
  if (!graph?.chunks.length) throw new TypeError('Production build did not emit a graph');
  const manifestPath = resolve(app, config.config.build.outDir, '.vite/manifest.json');
  const manifest = await readFile(manifestPath, 'utf8');
  const lockPath = resolve(lockArgument ?? resolve(app, 'pnpm-lock.yaml'));
  const lock = await readFile(lockPath, 'utf8');
  const provenance = {
    ...sourceIdentity,
    source,
    app,
    package: JSON.parse(await readFile(resolve(app, 'package.json'), 'utf8')),
    resolvedVersions: await readDeliveryVersions(app),
    lockSha256: sha256(lock),
    lockPath,
    configSha256: sha256(await readFile(configPath)),
    manifestSha256: sha256(manifest),
    manifestPath,
    node: process.version,
    pnpm: packageManager.trim(),
    vite: viteVersion,
    host: { platform: platform(), release: release(), cpu: cpus()[0].model, logicalCores: cpus().length },
    command: process.argv,
    purpose: 'production membership diagnostic; not a canonical performance receipt',
  };
  await writeFile(resolve(output, 'graph.json'), `${JSON.stringify({ ...graph, provenance }, null, 2)}\n`, { flag: 'wx' });
  await writeFile(resolve(output, 'manifest.json'), manifest, { flag: 'wx' });
  console.log(`CLIENT_DELIVERY_GRAPH ${output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
