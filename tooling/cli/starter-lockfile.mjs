import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]))
    : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const graph = (manifest) => Object.fromEntries([
  'name', 'version', 'packageManager', 'engines', 'dependencies', 'devDependencies',
  'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'pnpm', 'overrides', 'resolutions',
].filter((key) => manifest[key] !== undefined).map((key) => [key, manifest[key]]));
const hash = (algorithm, bytes, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);

function packedDependencies(projectDirectory) {
  const manifestPath = join(projectDirectory, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const packed = {};
  mkdirSync(join(projectDirectory, '.fluo-ci/packages'), { recursive: true });
  for (const dependencies of [
    manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies,
    manifest.overrides, manifest.resolutions, manifest.pnpm?.overrides,
  ]) {
    for (const [name, specifier] of Object.entries(dependencies ?? {})) {
      if (!name.startsWith('@fluojs/') || !specifier.startsWith('file:')) continue;
      const source = resolve(projectDirectory, specifier.slice(5));
      if (!source.endsWith('.tgz')) throw new TypeError(`Expected a packed internal dependency: ${name}`);
      const reference = `file:.fluo-ci/packages/${basename(source)}`;
      const target = resolve(projectDirectory, reference.slice(5));
      if (source !== target) copyFileSync(source, target);
      dependencies[name] = reference;
      const internalManifest = JSON.parse(execFileSync('tar', ['-xOf', target, 'package/package.json'], { encoding: 'utf8' }));
      if (internalManifest.name !== name) throw new TypeError(`Packed dependency identity mismatch: ${name}`);
      packed[reference] = {
        graph: graph(internalManifest),
        integrity: `sha512-${hash('sha512', readFileSync(target), 'base64')}`,
      };
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest: graph(manifest), packed };
}

export function captureStarterSnapshot(projectDirectory, lockfile) {
  if (lockfile?.lockfileVersion !== '9.0') throw new TypeError('Expected pnpm lockfile version 9.0');
  const current = packedDependencies(projectDirectory);
  return {
    version: 1,
    manifest: current.manifest,
    internalGraphs: Object.fromEntries(Object.entries(current.packed).map(([reference, value]) => [reference, value.graph])),
    lockfile,
  };
}

export function prepareStarterDependencies(projectDirectory, snapshotPath) {
  const current = packedDependencies(projectDirectory);
  if (snapshotPath === undefined) return { mode: 'fresh', internal: current.packed };
  const bytes = readFileSync(snapshotPath);
  const snapshot = JSON.parse(bytes.toString('utf8'));
  const internalGraphs = Object.fromEntries(Object.entries(current.packed).map(([reference, value]) => [reference, value.graph]));
  if (snapshot.version !== 1 || snapshot.lockfile?.lockfileVersion !== '9.0'
    || !same(snapshot.manifest, current.manifest) || !same(snapshot.internalGraphs, internalGraphs)) {
    throw new TypeError('Starter dependency graph changed; regenerate the reviewed verification snapshot');
  }
  for (const entry of Object.values(snapshot.lockfile.packages ?? {})) {
    const reference = entry.resolution?.tarball;
    if (typeof reference !== 'string' || !reference.startsWith('file:')) continue;
    const internal = current.packed[reference];
    if (!internal) throw new TypeError(`Unknown packed dependency in verification snapshot: ${reference}`);
    entry.resolution.integrity = internal.integrity;
  }
  // JSON is valid YAML and pnpm accepts it without adding a parser dependency.
  writeFileSync(join(projectDirectory, 'pnpm-lock.yaml'), `${JSON.stringify(snapshot.lockfile, null, 2)}\n`);
  return {
    mode: 'locked',
    snapshotDigest: hash('sha256', bytes),
    internal: Object.fromEntries(Object.entries(current.packed).map(([reference, value]) => [reference, value.integrity])),
  };
}
