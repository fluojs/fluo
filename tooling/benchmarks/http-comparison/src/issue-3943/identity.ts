import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { object, sha256 } from '../profile-report';
import { sourceSnapshot, WORKSPACE_ROOT } from '../provenance';
import { WDIR } from '../targets';
import { workerdExecutable } from '../workerd';
import { DESIGN } from './design';
import { authenticateGeneratorEvidence, type FrozenGenerator, parseFrozenGenerator } from './generator-identity';
import { assertTransport, type LanTransport, parseTransport } from './transport';

export interface FrozenInput {
  readonly phase: 'headroom' | 'aa';
  readonly parentReceipt: string;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly capacity: { readonly path: string; readonly sha256: string };
  readonly transport: LanTransport;
  readonly generator: FrozenGenerator;
}

export function parseFrozenInput(value: unknown): FrozenInput {
  const input = object(value);
  if (input.issue !== 3943 || !isDeepStrictEqual(input.design, DESIGN)) {
    throw new TypeError('Issue3943 requires the exact parent-frozen diagnostic design');
  }
  const artifacts = object(input.artifacts);
  const hashes: Record<string, string> = {};
  for (const [path, hash] of Object.entries(artifacts)) {
    if (!isAbsolute(path) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new TypeError('Frozen artifacts require absolute paths and SHA256 hashes');
    }
    hashes[path] = hash;
  }
  const capacity = object(input.capacity);
  const generator = parseFrozenGenerator(input.generator);
  const transport = parseTransport(input.transport);
  if ((input.phase !== 'headroom' && input.phase !== 'aa')
    || typeof input.parentReceipt !== 'string' || !isAbsolute(input.parentReceipt)
    || typeof capacity.path !== 'string' || !isAbsolute(capacity.path)
    || typeof capacity.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(capacity.sha256)
    || generator.directory !== transport.remoteDirectory
    || Object.keys(generator.artifacts).some((path) => path in hashes)) {
    throw new TypeError('Missing frozen local generator/capacity identity');
  }
  return {
    phase: input.phase, parentReceipt: input.parentReceipt,
    artifacts: hashes, capacity: { path: capacity.path, sha256: capacity.sha256 },
    generator, transport,
  };
}

export async function assertArtifacts(artifacts: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, expected] of Object.entries(artifacts)) {
    const actual = sha256(await readFile(path));
    if (actual !== expected) throw new Error(`Frozen bytes changed: ${path}; expected=${expected}; actual=${actual}`);
  }
}

async function files(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await files(path));
    else if (entry.isFile()) paths.push(path);
    else throw new Error(`Unsupported source/build artifact: ${path}`);
  }
  return paths;
}

export async function authenticateFrozenInput(input: FrozenInput): Promise<void> {
  assertTransport(input.transport);
  const required = [
    ...Object.keys(await sourceSnapshot(WDIR)).map((path) => join(WDIR, path)),
    ...await files(join(WDIR, 'dist', DESIGN.target)),
    workerdExecutable(), process.execPath, input.capacity.path,
    input.parentReceipt, input.generator.evidence.path,
  ];
  // Root package builds are linked into the bundle. Bind every package source and
  // emitted tree, not only the selected adapter or its serving entry.
  for (const entry of await readdir(join(WORKSPACE_ROOT, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(WORKSPACE_ROOT, 'packages', entry.name);
    required.push(join(directory, 'package.json'), ...await files(join(directory, 'src')),
      ...await files(join(directory, 'dist')));
  }
  for (const directory of [WORKSPACE_ROOT, WDIR]) {
    required.push(join(directory, 'pnpm-lock.yaml'), join(directory, 'node_modules/.pnpm/lock.yaml'));
  }
  for (const path of required) {
    if (!(path in input.artifacts)) throw new Error(`Frozen identity omitted required artifact: ${path}`);
  }
  if (input.artifacts[input.capacity.path] !== input.capacity.sha256) {
    throw new Error('Capacity evidence hash differs from frozen artifact identity');
  }
  if (input.artifacts[input.generator.evidence.path] !== input.generator.evidence.sha256) {
    throw new Error('Generator evidence receipt hash differs from frozen server artifact identity');
  }
  await assertArtifacts(input.artifacts);
  await authenticateGeneratorEvidence(input.generator);
  const receipt = object(JSON.parse(await readFile(input.parentReceipt, 'utf8')));
  if (receipt.issue !== 3943 || receipt.phase !== input.phase || receipt.rootBuildExitCode !== 0
    || !isDeepStrictEqual(receipt.design, DESIGN)
    || !isDeepStrictEqual(receipt.transport, input.transport)
    || !isDeepStrictEqual(receipt.generator, input.generator)
    || !isDeepStrictEqual(receipt.artifacts, Object.fromEntries(Object.entries(input.artifacts)
      .filter(([path]) => path !== input.parentReceipt)))) {
    throw new Error('Parent release/source/build receipt does not bind the frozen input');
  }
  if (input.phase === 'aa') {
    if (receipt.capacityReview !== 'accepted' || typeof receipt.headroomManifest !== 'string'
      || !(receipt.headroomManifest in input.artifacts)) {
      throw new Error('A/A requires parent-reviewed capacity and a frozen headroom manifest');
    }
    const headroom = object(JSON.parse(await readFile(receipt.headroomManifest, 'utf8')));
    if (!isDeepStrictEqual(headroom.design, DESIGN) || !Array.isArray(headroom.observations)
      || headroom.observations.length !== 12 || !Array.isArray(headroom.invalidAttempts)
      || headroom.invalidAttempts.length !== 0 || !Array.isArray(headroom.verdicts)
      || headroom.verdicts.length !== 1 || object(headroom.verdicts[0]).phase !== 'headroom') {
      throw new Error('A/A headroom prerequisite is incomplete or invalid');
    }
  }
}
