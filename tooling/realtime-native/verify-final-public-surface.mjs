import { readFile } from 'node:fs/promises';

const manifestUrl = new URL('../../packages/websockets/package.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const load = async (entrypoint) => await import(new URL(manifest.exports[entrypoint].import, manifestUrl).href);

const [root, node, bun, deno, workers] = await Promise.all([
  load('.'),
  load('./node'),
  load('./bun'),
  load('./deno'),
  load('./cloudflare-workers'),
]);

const forbiddenRootExports = [
  'WebSocketGatewayLifecycleService',
  'WebSocketModule',
];
const runtimeAuthoringExports = Object.keys(root);

for (const name of forbiddenRootExports) {
  if (name in root) {
    throw new Error(`Final root entrypoint still exposes removed ${name}.`);
  }
}

for (const [entrypoint, exports_] of Object.entries({ bun, deno, node, workers })) {
  for (const name of runtimeAuthoringExports) {
    if (name in exports_) {
      throw new Error(`Final ${entrypoint} entrypoint still re-exports root authoring API ${name}.`);
    }
  }
}

for (const [name, adapterName] of [
  ['platform-bun', 'BunHttpApplicationAdapter'],
  ['platform-deno', 'DenoHttpApplicationAdapter'],
  ['platform-cloudflare-workers', 'CloudflareWorkerHttpApplicationAdapter'],
]) {
  const packageUrl = new URL(`../../packages/${name}/package.json`, import.meta.url);
  const packageManifest = JSON.parse(await readFile(packageUrl, 'utf8'));
  const exports_ = await import(new URL(packageManifest.exports['.'].import, packageUrl).href);
  const adapter = exports_[adapterName].create();
  for (const removed of ['configureWebSocketBinding', 'configureRealtimeBinding']) {
    if (removed in adapter) throw new Error(`${name} still exposes legacy ${removed}.`);
  }
  const capability = adapter.getRealtimeCapability();
  if (capability.version !== 1 || capability.bindingInstallation?.version !== 1 ||
      typeof capability.bindingInstallation.install !== 'function') {
    throw new Error(`${name} does not expose the canonical version-1 installer.`);
  }
  let rejected = false;
  try {
    capability.bindingInstallation.install({ invalid: true });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`${name} accepted an invalid binding shape.`);
  await adapter.close();
}

console.log('realtime-native final public surface verified.');
