import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnOwnedCommand } from '../../examples/react-vite-ssr/tests/verify-background-starter.mjs';
import { claimEvidenceRoot, createCommandEvidence } from './command-evidence.mjs';

export class BrowserPreparationError extends TypeError {
  constructor(reason) {
    super(`browser-preparation: ${reason}`);
    this.name = 'BrowserPreparationError';
    this.kind = 'input-preparation';
  }
}
const requireInput = (condition, reason) => {
  if (!condition) throw new BrowserPreparationError(reason);
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// This is a requirement on the host subscription, not a workstation setting.
export const browserObservationPolicy = Object.freeze({
  persistent: true,
  completion: 'command-close',
  observerTimeoutIsTestFailure: false,
});

export function assertBrowserObservation(observer) {
  requireInput(observer?.persistent === true && observer.completion === 'command-close',
    'long runners require a persistent command-close observer; a default 300000ms watcher is not evidence');
  return browserObservationPolicy;
}

/** Validate selected command inputs before the browser process is created. */
export function prepareBrowserCommand(root, command) {
  const env = command.env;
  requireInput(env && ['ordinary', 'form', 'reliability', 'soak'].includes(env.FLUO_BROWSER_SUITE),
    `${command.id}: missing/invalid FLUO_BROWSER_SUITE`);
  let example;
  try { example = realpathSync(resolve(root, 'examples/react-vite-ssr')); }
  catch (error) { throw new BrowserPreparationError(`${command.id}: example checkout unavailable: ${error.message}`); }
  const read = (path) => {
    try {
      const file = realpathSync(resolve(example, path));
      const inside = relative(example, file);
      requireInput(!isAbsolute(inside) && inside !== '..' && !inside.startsWith(`..${sep}`)
        && statSync(file).isFile(), `${command.id}: invalid artifact ${path}`);
      return readFileSync(file);
    } catch (error) {
      if (error instanceof BrowserPreparationError) throw error;
      throw new BrowserPreparationError(`${command.id}: missing artifact ${path}: ${error.message}`);
    }
  };
  for (const name of ['FLUO_BACKGROUND_EVIDENCE', 'FLUO_RELIABILITY_OUTPUT',
    'FLUO_RELIABILITY_REPORT', 'FLUO_BROWSER_OUTPUT']) {
    requireInput(typeof env[name] === 'string' && isAbsolute(env[name]), `${command.id}: missing absolute ${name}`);
  }
  requireInput(env.FLUO_RELIABILITY_SEED === '3886' && env.FLUO_RELIABILITY_ACTIONS === '1000',
    `${command.id}: missing canonical seed/actions`);
  const report = env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? env.FLUO_RELIABILITY_REPORT;
  requireInput(report === resolve(env.FLUO_BROWSER_OUTPUT, command.browserReport),
    `${command.id}: report path mismatch`);
  const wrapper = resolve(root, 'tooling/ci/browser-playwright.config.mjs');
  requireInput(Array.isArray(command.args) && command.args.includes(relative(resolve(root, 'examples/react-vite-ssr'), wrapper)),
    `${command.id}: missing prepared package-local config`);
  let wrapperDigest;
  try { wrapperDigest = digest(readFileSync(wrapper)); }
  catch (error) { throw new BrowserPreparationError(`${command.id}: missing prepared config artifact: ${error.message}`); }
  const original = env.FLUO_BROWSER_SUITE === 'reliability' || env.FLUO_BROWSER_SUITE === 'soak'
    ? 'playwright.reliability.config.ts' : 'playwright.config.ts';
  const pkg = JSON.parse(read('package.json'));
  requireInput(pkg.scripts.start === 'node dist/server/main.js'
    && pkg.scripts['test:reliability'] === 'playwright test --config playwright.reliability.config.ts',
  `${command.id}: package-local runner changed`);
  const config = digest(read(original));
  let manifest;
  try { manifest = JSON.parse(read('dist/client/.vite/manifest.json')); }
  catch (error) { throw new BrowserPreparationError(`${command.id}: invalid client manifest: ${error.message}`); }
  requireInput(manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest),
    `${command.id}: invalid client manifest object`);
  requireInput(manifest['src/entry-client.ts']?.isEntry === true
    && manifest['src/entry-server.ts']?.isEntry === true, `${command.id}: missing client manifest entries`);
  for (const entry of Object.values(manifest)) {
    requireInput(entry && !Array.isArray(entry) && typeof entry.file === 'string', `${command.id}: invalid manifest file`);
    for (const field of ['name', 'src']) {
      requireInput(entry[field] === undefined || typeof entry[field] === 'string',
        `${command.id}: invalid manifest ${field}`);
    }
    for (const field of ['isEntry', 'isDynamicEntry']) {
      requireInput(entry[field] === undefined || typeof entry[field] === 'boolean',
        `${command.id}: invalid manifest ${field}`);
    }
    for (const field of ['imports', 'css', 'assets']) {
      requireInput(entry[field] === undefined || (Array.isArray(entry[field])
        && entry[field].every((value) => typeof value === 'string')),
      `${command.id}: invalid manifest ${field}`);
    }
    read(`dist/client/${entry.file}`);
    for (const file of [...(entry.css ?? []), ...(entry.assets ?? [])]) read(`dist/client/${file}`);
    for (const imported of entry.imports ?? []) {
      requireInput(Object.hasOwn(manifest, imported), `${command.id}: missing manifest import ${imported}`);
    }
  }
  const pending = ['src/entry-client.ts'];
  const visited = new Set();
  while (pending.length > 0) {
    const key = pending.pop();
    if (visited.has(key)) continue;
    visited.add(key);
    pending.push(...(manifest[key].imports ?? []));
  }
  for (const key of new Set(['src/entry-server.ts', ...visited])) {
    const entry = manifest[key];
    const pathname = entry.file.split(/[?#]/u, 1)[0];
    requireInput(['.js', '.mjs', '.cjs'].some((extension) => pathname.endsWith(extension)),
      `${command.id}: unsupported JavaScript output ${key}: ${entry.file}`);
  }
  for (const module of ['src/navigation-product.ts', 'src/navigation-admin.ts']) {
    requireInput(Object.entries(manifest).some(([key, entry]) =>
      key === module || entry.src === module || entry.name === module || entry.file === module),
    `${command.id}: missing navigation mapping ${module}`);
  }
  const normal = read('dist/server/main.js');
  requireInput(!normal.toString().includes('new FormControl(')
    && normal.toString().includes('REACT_SSR_DELIVERY_PROBE'), `${command.id}: normal production entry replaced`);
  const identities = { 'dist/client/.vite/manifest.json': digest(read('dist/client/.vite/manifest.json')),
    'dist/server/main.js': digest(normal) };
  if (env.FLUO_BROWSER_SUITE !== 'ordinary') {
    const form = read('dist/form-server/main.js');
    requireInput(form.toString().includes('new FormControl(')
      && !form.toString().includes('REACT_SSR_DELIVERY_PROBE'), `${command.id}: invalid form-server entry`);
    identities['dist/form-server/main.js'] = digest(form);
  }
  return { version: 1, suite: env.FLUO_BROWSER_SUITE, config: { path: original, sha256: config,
    wrapper: { path: relative(root, wrapper), sha256: wrapperDigest } },
    identities, observer: browserObservationPolicy };
}

/** Ownership remains with the runner until real close, including descendants. */
export async function runBrowserOwnedCommand(command, options, { signal, onChild, observer, evidence } = {}) {
  assertBrowserObservation(observer ?? browserObservationPolicy);
  const capture = evidence ? createCommandEvidence(
    typeof evidence.root === 'string' ? claimEvidenceRoot(evidence.root) : evidence.root,
    evidence.label ?? command.id, command, options, evidence.emit) : null;
  const started = performance.now();
  let owned;
  try {
    owned = spawnOwnedCommand(command.executable, command.args, options, 4_000);
  } catch (error) {
    capture?.finish({ exitCode: null, signal: null, closed: false, error });
    throw error;
  }
  const child = owned.child;
  let commandError;
  const onError = (error) => {
    commandError ??= error;
    owned.stop();
  };
  const closed = new Promise((done) => {
    child.on('error', onError);
    child.once('close', (exitCode, terminationSignal) => done({ exitCode, signal: terminationSignal }));
  });
  const cancel = () => owned.stop();
  signal?.addEventListener('abort', cancel, { once: true });
  capture?.attach(child);
  try {
    try { onChild?.(child); } catch (error) { onError(error); }
    if (signal?.aborted) cancel();
    const outcome = await closed;
    const result = { ...outcome, closed: true, descendantCleanup: 'owned-group-close',
      cancelled: signal?.aborted === true, forced: owned.forced,
      status: signal?.aborted ? 'cancelled' : outcome.exitCode === 0 && outcome.signal === null ? 'passed' : 'test-failed',
      elapsedMs: performance.now() - started };
    if (capture) result.evidence = capture.finish({ ...result, error: commandError });
    if (commandError) throw commandError;
    return result;
  } finally {
    child.off('error', onError);
    signal?.removeEventListener('abort', cancel);
  }
}
