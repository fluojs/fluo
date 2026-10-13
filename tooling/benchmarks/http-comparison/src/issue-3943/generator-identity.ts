import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { object, sha256 } from '../profile-report';
import type { Measurement, TrafficOptions } from '../traffic';

export interface GeneratorHost {
  readonly hostname: string;
  readonly hardwareUuid: string;
  readonly platform: 'darwin';
  readonly arch: 'arm64' | 'x64';
  readonly node: string;
}

export interface GeneratorArtifacts {
  readonly directory: string;
  readonly roles: Readonly<Record<string, string>>;
  readonly artifacts: Readonly<Record<string, string>>;
}

export interface FrozenGenerator extends GeneratorArtifacts {
  readonly host: GeneratorHost;
  readonly evidence: { readonly path: string; readonly sha256: string };
}

export interface GeneratorObservation {
  readonly protocol: 'issue-3943-generator-v1';
  readonly pid: number;
  readonly nonce: string;
  readonly host: GeneratorHost;
  readonly before: GeneratorArtifacts;
  readonly after: GeneratorArtifacts;
  readonly requestSha256: string;
  readonly instrumentation: { readonly execArgv: readonly string[]; readonly nodeOptions: string | null };
}

export interface GeneratorRequest extends TrafficOptions {
  readonly issue3943: { readonly token: string };
}

export type RemoteMeasurement = Measurement & { readonly generator: GeneratorObservation };
const roles = ['executable', 'entry', 'declaredLock', 'installedLock', 'autocannonEntry', 'autocannonManifest'] as const;

function parseArtifacts(value: unknown): GeneratorArtifacts {
  const input = object(value);
  const paths = object(input.roles);
  const artifacts = object(input.artifacts);
  const parsedPaths: Record<string, string> = {};
  const hashes: Record<string, string> = {};
  if (typeof input.directory !== 'string' || !isAbsolute(input.directory)) {
    throw new TypeError('Missing actual generator directory');
  }
  for (const role of roles) {
    const path = paths[role];
    if (typeof path !== 'string' || !isAbsolute(path)
      || typeof artifacts[path] !== 'string' || !/^[a-f0-9]{64}$/.test(String(artifacts[path]))) {
      throw new TypeError(`Missing actual generator artifact: ${role}`);
    }
    parsedPaths[role] = path;
    hashes[path] = String(artifacts[path]);
  }
  if (Object.keys(paths).length !== roles.length
    || Object.keys(artifacts).length !== Object.keys(hashes).length
    || parsedPaths.entry !== join(input.directory, 'load-client.mjs')) {
    throw new TypeError('Unexpected generator client/artifact identity');
  }
  return { directory: input.directory, roles: parsedPaths, artifacts: hashes };
}

function parseHost(value: unknown): GeneratorHost {
  const host = object(value);
  if (host.platform !== 'darwin' || (host.arch !== 'arm64' && host.arch !== 'x64')
    || typeof host.hostname !== 'string' || !host.hostname
    || typeof host.hardwareUuid !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(host.hardwareUuid)
    || typeof host.node !== 'string' || !/^v\d+\.\d+\.\d+$/.test(host.node)) {
    throw new TypeError('Missing actual physical Mac/runtime identity');
  }
  return {
    platform: host.platform, arch: host.arch, hostname: host.hostname,
    hardwareUuid: host.hardwareUuid.toLowerCase(), node: host.node,
  };
}

export function parseFrozenGenerator(value: unknown): FrozenGenerator {
  const input = object(value);
  const evidence = object(input.evidence);
  if (typeof evidence.path !== 'string' || !isAbsolute(evidence.path)
    || typeof evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)) {
    throw new TypeError('Missing hash-bound parent generator observation receipt');
  }
  return {
    ...parseArtifacts(input), host: parseHost(input.host),
    evidence: { path: evidence.path, sha256: evidence.sha256 },
  };
}

export async function authenticateGeneratorEvidence(generator: FrozenGenerator): Promise<void> {
  // This is the copied parent receipt on the SERVER. Remote artifact paths are
  // compared as identities only; none is opened on WSL2.
  const bytes = await readFile(generator.evidence.path);
  if (sha256(bytes) !== generator.evidence.sha256) throw new Error('Parent generator receipt bytes changed');
  const receipt = object(JSON.parse(bytes.toString('utf8')));
  const expected = { host: generator.host, directory: generator.directory, roles: generator.roles, artifacts: generator.artifacts };
  if (receipt.issue !== 3943 || receipt.origin !== 'actual-in-generator-observation'
    || !isDeepStrictEqual(receipt.instrumentation, { execArgv: [], nodeOptions: null })
    || !isDeepStrictEqual(receipt.generator, expected)) {
    throw new Error('Parent receipt does not bind actual generator observations');
  }
}

export function authenticateGenerator(
  generator: FrozenGenerator,
  value: unknown,
  request: GeneratorRequest,
): GeneratorObservation {
  const actual = object(value);
  const host = parseHost(actual.host);
  const before = parseArtifacts(actual.before);
  const after = parseArtifacts(actual.after);
  const instrumentation = object(actual.instrumentation);
  const expected = { directory: generator.directory, roles: generator.roles, artifacts: generator.artifacts };
  if (actual.protocol !== 'issue-3943-generator-v1'
    || typeof actual.pid !== 'number' || !Number.isSafeInteger(actual.pid) || actual.pid <= 0
    || typeof actual.nonce !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(actual.nonce)
    || !Array.isArray(instrumentation.execArgv) || instrumentation.execArgv.length !== 0
    || instrumentation.nodeOptions !== null
    || !isDeepStrictEqual(host, generator.host)
    || !isDeepStrictEqual(before, expected) || !isDeepStrictEqual(after, expected)
    || actual.requestSha256 !== sha256(JSON.stringify(request))) {
    throw new Error('Actual remote generator/request identity differs from frozen parent evidence');
  }
  return {
    protocol: actual.protocol, pid: actual.pid, nonce: actual.nonce,
    host, before, after, requestSha256: sha256(JSON.stringify(request)),
    instrumentation: { execArgv: [], nodeOptions: null },
  };
}
