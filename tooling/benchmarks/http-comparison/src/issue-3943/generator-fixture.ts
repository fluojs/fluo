import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { object, sha256 } from '../profile-report';
import { WDIR } from '../targets';
import { type GeneratorRequest, parseFrozenGenerator } from './generator-identity';
import { DESIGN } from './design';
import { parseFrozenInput } from './identity';

const execute = promisify(execFile);

export function frozenTopologyFixture() {
  const root = join(WDIR, 'results/issue-3943');
  const directory = '/Users/issue-3943-independent-mac';
  const roles = {
    executable: `${directory}/node`, entry: `${directory}/load-client.mjs`,
    declaredLock: `${directory}/pnpm-lock.yaml`, installedLock: `${directory}/node_modules/.pnpm/lock.yaml`,
    autocannonEntry: `${directory}/node_modules/autocannon/autocannon.js`,
    autocannonManifest: `${directory}/node_modules/autocannon/package.json`,
  };
  return {
    issue: 3943, design: DESIGN, phase: 'headroom',
    parentReceipt: join(root, 'parent-release.json'),
    artifacts: { [process.execPath]: 'a'.repeat(64) },
    capacity: { path: join(root, 'capacity.json'), sha256: 'b'.repeat(64) },
    transport: {
      kind: 'ssh-lan', serverHost: '192.168.1.20', serverPort: 33925,
      bindHost: '0.0.0.0', sshTarget: 'ayden@192.168.1.30', remoteDirectory: directory, sshControl: null,
    },
    generator: {
      directory, roles, artifacts: Object.fromEntries(Object.values(roles).map((path) => [path, 'a'.repeat(64)])),
      host: { node: process.version, hostname: 'independent-mac', platform: 'darwin', arch: 'arm64',
        hardwareUuid: '39433943-3943-4943-8943-394339433943' },
      evidence: { path: join(root, 'actual-generator.json'), sha256: 'b'.repeat(64) },
    },
  };
}

export function requestTopologyFixture(): GeneratorRequest {
  return {
    url: 'http://192.168.1.20:33925', duration: 40, connections: 64,
    requests: [{ path: '/stage', method: 'GET', expectedStatus: 200, expectedBody: '{"ok":true}' }],
    issue3943: { token: '39433943-3943-4943-8943-394339433943' },
  };
}

export function observedTopologyFixture(request: GeneratorRequest) {
  const { host, evidence: _evidence, ...snapshot } = parseFrozenInput(frozenTopologyFixture()).generator;
  return {
    protocol: 'issue-3943-generator-v1', pid: process.pid,
    nonce: '39433943-3943-4943-8943-394339433943', host, before: snapshot, after: snapshot,
    requestSha256: sha256(JSON.stringify(request)), instrumentation: { execArgv: [], nodeOptions: null },
  };
}

/** Disposable finite correctness fixture; never an accepted diagnostic sample. */
export async function nativeGeneratorFixture(alter?: 'entry' | 'declaredLock' | 'installedLock' | 'response-body') {
  const root = join(WDIR, 'results/issue-3943');
  const address = Object.values(networkInterfaces()).flatMap((entries) => entries ?? []).find((entry) =>
    entry.family === 'IPv4' && !entry.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address));
  if (!address) throw new Error('Finite native Mac fixture requires its existing private LAN interface');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'native-generator-test-'));
  const state: { wire: { method: string | undefined; path: string | undefined; body: string } | null } = { wire: null };
  const server = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Expected request bytes');
        chunks.push(chunk);
      }
      state.wire = { method: request.method, path: request.url, body: Buffer.concat(chunks).toString('utf8') };
      if (alter && alter !== 'response-body') {
        const path = alter === 'entry' ? join(directory, 'load-client.mjs')
          : alter === 'declaredLock' ? join(directory, 'pnpm-lock.yaml')
          : join(directory, 'node_modules/.pnpm/lock.yaml');
        const bytes = await readFile(path);
        bytes[bytes.length - 1] ^= 1;
        await writeFile(path, bytes);
      }
      response.end(alter === 'response-body' ? '{"ok":tRue}' : '{"ok":true}');
    })().catch((error: unknown) => {
      if (!(error instanceof Error)) throw error;
      response.destroy(error);
    });
  });
  try {
    await mkdir(join(directory, 'node_modules/.pnpm'), { recursive: true });
    await writeFile(join(directory, 'pnpm-lock.yaml'), await readFile(join(WDIR, 'pnpm-lock.yaml')));
    await writeFile(join(directory, 'node_modules/.pnpm/lock.yaml'), await readFile(join(WDIR, 'node_modules/.pnpm/lock.yaml')));
    await build({
      entryPoints: [fileURLToPath(new URL('./generator.ts', import.meta.url))],
      bundle: true, platform: 'node', format: 'esm', packages: 'external',
      outfile: join(directory, 'load-client.mjs'),
    });
    const identity = await execute(process.execPath, ['load-client.mjs', '--identity'], { cwd: directory, timeout: 10_000 });
    const parentBytes = identity.stdout;
    const receipt = object(JSON.parse(parentBytes));
    const parentPath = join(directory, 'parent-generator.json');
    await writeFile(parentPath, parentBytes);
    const generator = parseFrozenGenerator({
      ...object(receipt.generator), evidence: { path: parentPath, sha256: sha256(parentBytes) },
    });
    const listening = once(server, 'listening', { signal: AbortSignal.timeout(5_000) });
    server.listen(0, address.address);
    await listening;
    const socket = server.address();
    if (!socket || typeof socket === 'string') throw new Error('Missing ephemeral fixture port');
    const request: GeneratorRequest = {
      url: `http://${address.address}:${socket.port}`, duration: 1, connections: 1, amount: 1,
      requests: [{
        path: '/payload', method: 'POST', body: '{"value":"actual-wire-body"}',
        headers: { 'content-type': 'application/json' }, expectedStatus: 200, expectedBody: '{"ok":true}',
      }],
      issue3943: { token: '39433943-3943-4943-8943-394339433943' },
    };
    const payload = Buffer.from(JSON.stringify(request)).toString('base64');
    let output: string;
    let stderr: string;
    let exitCode = 0;
    try {
      const result = await execute(process.execPath, ['load-client.mjs', payload], { cwd: directory, timeout: 15_000 });
      output = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      if (!(error instanceof Error && 'stdout' in error && typeof error.stdout === 'string')) throw error;
      output = error.stdout;
      stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr : '';
      exitCode = 1;
    }
    if (!state.wire) throw new Error('No actual HTTP request reached the finite fixture');
    return { generator, request, wire: state.wire, response: object(JSON.parse(output)), exitCode, rawStdout: output, stderr };
  } finally {
    if (server.listening) {
      const closed = once(server, 'close', { signal: AbortSignal.timeout(5_000) });
      server.close();
      server.closeAllConnections();
      await closed;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
