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

export function refreshStarterSnapshotVersions(snapshot, packageManifests) {
  if (snapshot.version !== 1 || snapshot.lockfile?.lockfileVersion !== '9.0') {
    throw new TypeError('Expected a version 1 starter snapshot with pnpm lockfile version 9.0');
  }
  const manifests = new Map(packageManifests.map((manifest) => [manifest.name, manifest]));
  const previousVersions = new Map(Object.values(snapshot.internalGraphs).map(({ name, version }) => [name, version]));
  const currentVersions = new Map(packageManifests.map(({ name, version }) => [name, version]));
  const referenceFor = (name, version) => `file:.fluo-ci/packages/${name.replace(/^@/, '').replaceAll('/', '-')}-${version}.tgz`;
  const packedGraph = (manifest, versions) => {
    const packed = structuredClone(graph(manifest));
    packed.version = versions.get(manifest.name);
    // Match the local starter packer's production/optional/peer workspace rewrite.
    // Dev dependencies stay workspace ranges in the packed manifest.
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, specifier] of Object.entries(packed[section] ?? {})) {
        if (!specifier.startsWith('workspace:')) continue;
        const version = versions.get(name);
        if (version === undefined) throw new TypeError(`Unknown workspace dependency in starter graph: ${name}`);
        const range = specifier.slice('workspace:'.length);
        packed[section][name] = range === '^' || range === '~' ? `${range}${version}`
          : range === '*' || range === '' ? version : range;
      }
    }
    return packed;
  };
  const references = new Map();
  const internalGraphs = {};
  for (const [reference, previousGraph] of Object.entries(snapshot.internalGraphs)) {
    const manifest = manifests.get(previousGraph.name);
    if (!manifest || reference !== referenceFor(previousGraph.name, previousGraph.version)
      || !same(previousGraph, packedGraph(manifest, previousVersions))) {
      throw new TypeError(`Starter dependency graph changed for ${previousGraph.name}; regenerate the reviewed verification snapshot`);
    }
    const nextReference = referenceFor(manifest.name, manifest.version);
    references.set(reference, nextReference);
    internalGraphs[nextReference] = packedGraph(manifest, currentVersions);
  }
  const replaceReference = (value) => {
    for (const [previous, current] of references) value = value.replaceAll(previous, current);
    return value;
  };
  const rebind = (value) => {
    if (typeof value === 'string') return replaceReference(value);
    if (Array.isArray(value)) return value.map(rebind);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [replaceReference(key), rebind(item)]));
    }
    return value;
  };
  const lockfile = rebind(snapshot.lockfile);
  for (const [key, entry] of Object.entries(snapshot.lockfile.packages ?? {})) {
    const reference = entry.resolution?.tarball;
    if (typeof reference !== 'string' || !reference.startsWith('file:')) continue;
    const previousGraph = snapshot.internalGraphs[reference];
    if (!previousGraph || entry.version !== previousGraph.version) {
      throw new TypeError(`Packed dependency version mismatch in verification snapshot: ${reference}`);
    }
    lockfile.packages[replaceReference(key)].version = currentVersions.get(previousGraph.name);
  }
  // Keep captured integrity bytes intact. The strict consumer binds real packed bytes
  // only after checking the complete new manifest and internal graphs.
  return { ...snapshot, manifest: rebind(snapshot.manifest), internalGraphs, lockfile };
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
