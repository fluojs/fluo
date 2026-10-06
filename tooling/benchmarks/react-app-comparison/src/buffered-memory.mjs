import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const args = process.argv.slice(2);
const bodyBytes = Number(args[args.indexOf('--body-bytes') + 1]);
const concurrency = Number(args[args.indexOf('--concurrency') + 1]);
const output = args[args.indexOf('--output') + 1];
if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 0 || !Number.isSafeInteger(concurrency)
  || concurrency < 1 || !output || !args.includes('--output')) {
  throw new TypeError('usage: node src/buffered-memory.mjs --body-bytes <n> --concurrency <n> --output <results/head/file.json>');
}
const suite = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const [{ stdout: commit }, { stdout: dirty }] = await Promise.all([
  exec('git', ['rev-parse', 'HEAD'], { cwd: suite }),
  exec('git', ['status', '--porcelain'], { cwd: suite }),
]);
if (!resolve(output).startsWith(`${suite}/results/${commit.trim()}/`)) {
  throw new Error(`Buffered evidence output must be under results/${commit.trim()}/`);
}

const fromFluoApp = createRequire(new URL('../apps/fluo/package.json', import.meta.url));
const { createElement } = fromFluoApp('react');
const { createReactServerEntry, renderReactResponse } =
  await import(new URL('../apps/fluo/node_modules/@fluojs/react/dist/index.js', import.meta.url));
const chunkBytes = Math.min(bodyBytes || 1, 64 * 1024);
const baseline = process.memoryUsage();
let peakRssBytes = baseline.rss;
let peakArrayBufferBytes = baseline.arrayBuffers;
let receivedBytes = 0;
let committed = 0;
let failures = 0;

function sample() {
  const memory = process.memoryUsage();
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
  peakArrayBufferBytes = Math.max(peakArrayBufferBytes, memory.arrayBuffers);
}

const samplingIntervalMs = 10;
const sampler = setInterval(sample, samplingIntervalMs);
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    let sent = 0;
    let acceptedBytes = 0;
    const response = {
      committed: false,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      setStatus(code) { this.statusCode = code; this.statusSet = true; },
      send(body) {
        if (!(body instanceof Uint8Array)) throw new TypeError('Expected buffered HTML bytes.');
        acceptedBytes = body.byteLength;
        this.committed = true;
        committed++;
        sample();
      },
    };
    try {
      await renderReactResponse(
        createReactServerEntry(createElement('main')),
        { request: {}, response },
        {
          renderToReadableStream: async () => new ReadableStream({
            pull(controller) {
              if (sent >= bodyBytes) {
                controller.close();
                return;
              }
              const length = Math.min(chunkBytes, bodyBytes - sent);
              controller.enqueue(new Uint8Array(length).fill(65));
              sent += length;
              sample();
            },
          }, { highWaterMark: 0 }),
        },
      );
      if (acceptedBytes !== bodyBytes || response.statusCode !== 200 || !response.committed) {
        throw new Error(`Buffered body mismatch: ${acceptedBytes}/${bodyBytes}, HTTP ${response.statusCode}`);
      }
      receivedBytes += acceptedBytes;
    } catch (error) {
      failures++;
      throw error;
    }
  }));
} finally {
  clearInterval(sampler);
}
sample();
const preCommit = {};
for (const outcome of ['abort', 'error']) {
  const controller = new AbortController();
  const failure = new Error('buffered source failed before commit');
  const response = {
    committed: false,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    setStatus(code) { this.statusCode = code; },
    send() { this.committed = true; },
  };
  let observed;
  try {
    await renderReactResponse(createReactServerEntry(createElement('main')),
      { request: { signal: controller.signal }, response },
      { renderToReadableStream: async () => new ReadableStream({
        pull(source) {
          if (outcome === 'abort') {
            source.enqueue(new Uint8Array(64));
            controller.abort();
          } else {
            source.error(failure);
          }
        },
      }, { highWaterMark: 0 }) });
    throw new Error(`Expected buffered ${outcome} to fail before commit.`);
  } catch (error) {
    observed = error;
  }
  preCommit[outcome] = {
    committed: response.committed,
    statusCode: response.statusCode ?? null,
    headers: response.headers,
    errorName: observed?.name ?? null,
    originalErrorPreserved: outcome === 'error' ? observed === failure : null,
  };
  if (response.committed || response.statusCode !== undefined
    || Object.keys(response.headers).length !== 0
    || (outcome === 'error' && observed !== failure)
    || (outcome === 'abort' && observed?.name !== 'RequestAbortedError')) {
    throw new Error(`Invalid buffered ${outcome} pre-commit outcome: ${JSON.stringify(preCommit[outcome])}`);
  }
}
const record = {
  commit: commit.trim(),
  dirty: dirty.length > 0,
  scriptSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { platform: platform(), arch: arch(), cpuModel: cpus()[0]?.model, runtime: process.version },
  bodyBytes,
  concurrency,
  sourceChunkBytes: chunkBytes,
  aggregateBodyBytes: receivedBytes,
  committed,
  failures,
  samplingIntervalMs,
  baselineRssBytes: baseline.rss,
  peakRssBytes,
  baselineArrayBufferBytes: baseline.arrayBuffers,
  peakArrayBufferBytes,
  finalRssBytes: process.memoryUsage().rss,
  preCommit,
  note: 'Peak RSS and arrayBuffers are process observations, not a public size cap or exact retained-body attribution. Collection holds source chunks and creates a final contiguous array.',
};
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(record));
