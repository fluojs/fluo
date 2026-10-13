import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';
import { object } from '../../src/profile-report.js';
import { shoot, type ScenarioRequest, TrafficFailure, type TrafficOptions } from '../../src/traffic.js';

// The parent installs this bundle as load-client.mjs on its prepared generator.
// Collection/setup of that remote host is not owned by this implementer.
async function main(): Promise<void> {
  const input = object(JSON.parse(Buffer.from(process.argv[2] ?? '', 'base64').toString()));
  if (typeof input.url !== 'string' || typeof input.duration !== 'number'
    || typeof input.connections !== 'number' || !Array.isArray(input.requests)) {
    throw new TypeError('Malformed generator traffic options');
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0
    || !Number.isSafeInteger(input.connections) || input.connections < 1 || input.requests.length === 0) {
    throw new TypeError('Invalid traffic duration, concurrency, or request list');
  }
  const requests = input.requests.map((entry: unknown) => {
    const request = object(entry);
    if (typeof request.path !== 'string' || (request.method !== 'GET' && request.method !== 'POST')
      || typeof request.expectedBody !== 'string' || typeof request.expectedStatus !== 'number'
      || (request.body !== undefined && typeof request.body !== 'string')) throw new TypeError('Malformed request');
    const headers = request.headers === undefined ? undefined : object(request.headers);
    if (headers && Object.values(headers).some((value) => typeof value !== 'string')) throw new TypeError('Malformed headers');
    return {
      path: request.path, method: request.method, expectedBody: request.expectedBody,
      expectedStatus: request.expectedStatus,
      ...(typeof request.body === 'string' ? { body: request.body } : {}),
      ...(headers ? { headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, String(value)])) } : {}),
    } satisfies ScenarioRequest;
  });
  const amount = input.amount;
  if (amount !== undefined && (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 1)) throw new TypeError('Invalid finite amount');
  const options: TrafficOptions = {
    url: input.url, duration: input.duration, connections: input.connections, requests,
    ...(typeof amount === 'number' ? { amount } : {}),
  };
  const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const generator = {
    hostname: hostname(), runtime: process.version, executable: process.execPath,
    executableSha256: digest(await readFile(process.execPath)),
    lockfileSha256: digest(await readFile('pnpm-lock.yaml')),
    clientSha256: digest(await readFile(process.argv[1])), pid: process.pid, nonce: randomUUID(),
  };
  const measured = await shoot(options, 'issue-3940 independent generator');
  process.stdout.write(`${JSON.stringify({ ...measured, generator })}\n`);
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    process.stdout.write(`${JSON.stringify({ failure: String(error),
      diagnostics: error instanceof TrafficFailure ? error.diagnostics : null })}\n`);
    process.exitCode = 1;
  });
}
