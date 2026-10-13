import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { isIPv4 } from 'node:net';
import { arch, hostname, platform } from 'node:os';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { shoot, TrafficFailure, type TrafficOptions, type ScenarioRequest, type Measurement } from '../traffic';
import { observeGeneratorArtifacts } from './generator-artifacts';
import type { GeneratorArtifacts, GeneratorHost } from './generator-identity';

const execute = promisify(execFile);

function parseRequest(value: unknown): TrafficOptions {
  if (typeof value !== 'object' || value === null || !('url' in value)
    || typeof value.url !== 'string' || !('duration' in value)
    || typeof value.duration !== 'number' || !Number.isSafeInteger(value.duration)
    || value.duration < 1 || value.duration > 40 || !('connections' in value)
    || typeof value.connections !== 'number' || !Number.isSafeInteger(value.connections)
    || value.connections < 1 || value.connections > 64 || !('requests' in value)
    || !Array.isArray(value.requests) || value.requests.length === 0
    || !('issue3943' in value) || typeof value.issue3943 !== 'object' || value.issue3943 === null
    || !('token' in value.issue3943) || typeof value.issue3943.token !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(value.issue3943.token)) {
    throw new TypeError('Malformed issue3943 one-shot generator request');
  }
  const requests: ScenarioRequest[] = value.requests.map((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('path' in input)
      || typeof input.path !== 'string' || !input.path.startsWith('/')
      || !('method' in input) || (input.method !== 'GET' && input.method !== 'POST')
      || !('expectedBody' in input) || typeof input.expectedBody !== 'string'
      || !('expectedStatus' in input) || typeof input.expectedStatus !== 'number'
      || !Number.isSafeInteger(input.expectedStatus) || input.expectedStatus < 100 || input.expectedStatus > 599
      || ('body' in input && typeof input.body !== 'string')) {
      throw new TypeError('Malformed exact body/status workload');
    }
    const headers: Record<string, string> = {};
    if ('headers' in input) {
      if (typeof input.headers !== 'object' || input.headers === null || Array.isArray(input.headers)) {
        throw new TypeError('Malformed workload headers');
      }
      for (const [key, header] of Object.entries(input.headers)) {
        if (typeof header !== 'string') throw new TypeError('Malformed workload header value');
        headers[key] = header;
      }
    }
    const body = 'body' in input && typeof input.body === 'string' ? input.body : undefined;
    return {
      path: input.path, method: input.method, expectedBody: input.expectedBody, expectedStatus: input.expectedStatus,
      ...(body === undefined ? {} : { body }), ...('headers' in input ? { headers } : {}),
    };
  });
  const url = new URL(value.url);
  if (url.protocol !== 'http:' || url.username || url.password || !isIPv4(url.hostname)
    || !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)) {
    throw new TypeError('Generator may load only the frozen private LAN HTTP server');
  }
  const amount = 'amount' in value ? value.amount : undefined;
  const timeout = 'timeout' in value ? value.timeout : undefined;
  if ((amount !== undefined && amount !== 1)
    || (timeout !== undefined && (typeof timeout !== 'number' || !Number.isFinite(timeout) || timeout <= 0))) {
    throw new TypeError('Invalid finite correctness amount or timeout');
  }
  return {
    url: value.url, duration: value.duration, connections: value.connections, requests,
    ...(amount === undefined ? {} : { amount }),
    ...(typeof timeout === 'number' ? { timeout } : {}),
  };
}

async function observeHost(): Promise<GeneratorHost> {
  const machinePlatform = platform();
  const machineArch = arch();
  if (machinePlatform !== 'darwin' || (machineArch !== 'arm64' && machineArch !== 'x64')) {
    throw new Error('Issue3943 generator must be the independent physical Mac');
  }
  const result = await execute('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']);
  const uuid = /"IOPlatformUUID"\s*=\s*"([a-f0-9-]{36})"/i.exec(result.stdout)?.[1];
  if (!uuid) throw new Error('Actual Mac hardware UUID was not observed');
  return {
    platform: machinePlatform, arch: machineArch, hostname: hostname(),
    hardwareUuid: uuid.toLowerCase(), node: process.version,
  };
}

async function main(): Promise<void> {
  let completed: Measurement | null = null;
  let before: GeneratorArtifacts | null = null;
  let after: GeneratorArtifacts | null = null;
  let host: GeneratorHost | null = null;
  const nonce = randomUUID();
  const instrumentation = { execArgv: [...process.execArgv], nodeOptions: process.env.NODE_OPTIONS ?? null };
  try {
    if (instrumentation.execArgv.length !== 0 || instrumentation.nodeOptions !== null) {
      throw new Error('Instrumented generator process is not an ordinary diagnostic client');
    }
    host = await observeHost();
    before = await observeGeneratorArtifacts(new URL(import.meta.url));
    if (process.argv[2] === '--identity') {
      process.stdout.write(JSON.stringify({
        issue: 3943, origin: 'actual-in-generator-observation', generator: { ...before, host }, instrumentation,
      }));
      return;
    }
    const payload = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8');
    const request = parseRequest(JSON.parse(payload));
    completed = await shoot(request, 'issue-3943-remote-generator');
    after = await observeGeneratorArtifacts(new URL(import.meta.url));
    process.stdout.write(JSON.stringify({
      ...completed, generator: {
        protocol: 'issue-3943-generator-v1', pid: process.pid, nonce,
        host, before, after, instrumentation, requestSha256: createHash('sha256').update(payload).digest('hex'),
      },
    }));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stdout.write(JSON.stringify({
      failure: { name: error.name, message: error.message,
        ...(error instanceof TrafficFailure ? { diagnostics: error.diagnostics } : {}) },
      measurement: completed, generator: { pid: process.pid, nonce, host, before, after, instrumentation },
    }));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
