#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;
const normalizeDigest = (value) => typeof value === 'string' ? value.replace(/^sha256:/u, '') : '';

export function classifyAcquisitionFailure({ status, text = '' }) {
  const intermediary403 = status === 403 && /intermediary|upstream|timeout|gateway/iu.test(text);
  return { retry: intermediary403 || [500, 502, 503, 504].includes(status) };
}

export function validateArtifactMetadata(metadata, expected) {
  if (!metadata || metadata.id !== expected.id || metadata.name !== expected.name) throw new TypeError('artifact identity mismatch');
  if (metadata.workflow_run?.id !== expected.runId || metadata.workflow_run?.head_sha !== expected.sha || !SHA.test(expected.sha)) {
    throw new TypeError('artifact run or SHA mismatch');
  }
  if (normalizeDigest(metadata.digest) !== normalizeDigest(expected.digest) || !DIGEST.test(normalizeDigest(expected.digest))) {
    throw new TypeError('artifact digest mismatch');
  }
  return true;
}

const deadlineExceeded = () => Object.assign(
  new Error('artifact acquisition deadline exceeded'),
  { code: 'ARTIFACT_DEADLINE_EXCEEDED' },
);

export async function acquireBuildArtifact({
  fetch,
  expected,
  outputPath,
  attempts = 3,
  now = () => Date.now(),
  deadlineMs = 60_000,
  scheduleDeadline = (callback, delay) => {
    const timer = setTimeout(callback, delay);
    return () => clearTimeout(timer);
  },
}) {
  const started = now();
  const expiresAt = started + deadlineMs;
  const attemptRecords = [];
  const controller = new AbortController();
  let rejectDeadline;
  const deadline = new Promise((_, reject) => { rejectDeadline = reject; });
  const cancelDeadline = scheduleDeadline(() => {
    const error = deadlineExceeded();
    controller.abort(error);
    rejectDeadline(error);
  }, Math.max(0, deadlineMs));
  const assertBeforeDeadline = () => {
    if (controller.signal.aborted || now() >= expiresAt) {
      const error = deadlineExceeded();
      controller.abort(error);
      throw error;
    }
  };
  const bounded = async (operation) => {
    assertBeforeDeadline();
    const result = await Promise.race([operation, deadline]);
    assertBeforeDeadline();
    return result;
  };

  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      assertBeforeDeadline();
      const stage = `${outputPath}.attempt-${attempt}`;
      rmSync(stage, { force: true });
      try {
        const metadataResponse = await bounded(fetch(expected.metadataUrl, { signal: controller.signal }));
        const metadataText = await bounded(metadataResponse.text());
        if (!metadataResponse.ok) throw Object.assign(new Error('artifact metadata request failed'), { status: metadataResponse.status, text: metadataText });
        validateArtifactMetadata(JSON.parse(metadataText), expected);
        const downloadResponse = await bounded(fetch(expected.downloadUrl, { signal: controller.signal }));
        const bytes = new Uint8Array(await bounded(downloadResponse.arrayBuffer()));
        if (!downloadResponse.ok) throw Object.assign(new Error('artifact download request failed'), { status: downloadResponse.status, text: new TextDecoder().decode(bytes) });
        if (createHash('sha256').update(bytes).digest('hex') !== normalizeDigest(expected.digest)) throw new TypeError('artifact digest mismatch');
        assertBeforeDeadline();
        mkdirSync(resolve(outputPath, '..'), { recursive: true });
        writeFileSync(stage, bytes);
        assertBeforeDeadline();
        renameSync(stage, outputPath);
        attemptRecords.push({ attempt, elapsedMs: now() - started, status: 200 });
        return { attempt, attempts: attemptRecords, digest: normalizeDigest(expected.digest), elapsedMs: now() - started, outputPath };
      } catch (error) {
        rmSync(stage, { force: true });
        attemptRecords.push({ attempt, elapsedMs: now() - started, status: Number(error?.status ?? 0) });
        if (attempt === attempts || error?.code === 'ARTIFACT_DEADLINE_EXCEEDED'
          || controller.signal.aborted || now() >= expiresAt || !classifyAcquisitionFailure(error).retry) {
          if (error && typeof error === 'object') {
            error.attempts = attemptRecords;
            error.elapsedMs = now() - started;
          }
          throw error;
        }
      }
    }
    throw deadlineExceeded();
  } finally {
    cancelDeadline();
  }
}

function cliArgs(argv) {
  const input = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--id', '--digest', '--sha', '--name', '--run-id', '--output'].includes(key) || !argv[index + 1]) {
      throw new TypeError(`invalid option: ${key}`);
    }
    input[key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = argv[index + 1];
  }
  if (!Object.values(input).every(Boolean)) throw new TypeError('artifact id, digest, sha, name, run-id, and output are required');
  return input;
}

export function githubFetch(fetchImpl, token) {
  return async (url, options = {}) => {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'manual',
      signal: options.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw Object.assign(new Error('artifact redirect is malformed'), { status: response.status });
      return fetchImpl(location, { redirect: 'error', signal: options.signal });
    }
    return response;
  };
}

export async function main(argv = process.argv.slice(2), dependencies = {}) {
  const input = cliArgs(argv);
  const repository = dependencies.repository ?? process.env.GITHUB_REPOSITORY;
  if (!repository) throw new TypeError('GITHUB_REPOSITORY is required');
  const expected = { digest: normalizeDigest(input.digest), id: Number(input.id), name: input.name, runId: Number(input.runId), sha: input.sha };
  const metadataUrl = dependencies.metadataUrl ?? `https://api.github.com/repos/${repository}/actions/artifacts/${input.id}`;
  const downloadUrl = dependencies.downloadUrl ?? `${metadataUrl}/zip`;
  const archivePath = `${input.output}.zip`;
  const token = dependencies.token ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (!dependencies.fetch && !token) throw new TypeError('GH_TOKEN or GITHUB_TOKEN is required');
  const summaryPath = dependencies.summaryPath ?? process.env.GITHUB_STEP_SUMMARY;
  const appendSummary = (value) => {
    if (summaryPath) (dependencies.appendFileSync ?? appendFileSync)(summaryPath, `${JSON.stringify(value)}\n`);
  };
  let result;
  try {
    result = await acquireBuildArtifact({
      expected: { ...expected, downloadUrl, metadataUrl },
      fetch: dependencies.fetch ?? githubFetch(dependencies.fetchImpl ?? globalThis.fetch, token),
      outputPath: archivePath,
    });
  } catch (error) {
    appendSummary({
      artifactId: expected.id,
      attempts: Array.isArray(error?.attempts) ? error.attempts : [],
      digest: expected.digest,
      elapsedMs: Number(error?.elapsedMs ?? 0),
      name: expected.name,
      outcome: 'failed',
      sha: expected.sha,
    });
    throw error;
  }
  const extract = dependencies.extract ?? ((archive, directory) => (dependencies.execFileSync ?? execFileSync)('unzip', ['-q', archive, '-d', directory]));
  try {
    extract(archivePath, resolve(input.output, '..'));
  } finally {
    rmSync(archivePath, { force: true });
  }
  const report = { artifactId: expected.id, attempt: result.attempt, digest: expected.digest, elapsedMs: result.elapsedMs, name: expected.name, outcome: 'passed', sha: expected.sha };
  (dependencies.writeOutput ?? ((value) => process.stdout.write(value)))(`${JSON.stringify(report)}\n`);
  appendSummary({ artifactId: expected.id, attempts: result.attempts, digest: expected.digest, name: expected.name, outcome: 'passed', sha: expected.sha });
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
