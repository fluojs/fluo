#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/u;
const DIGEST = /^[0-9a-f]{64}$/u;

export function classifyAcquisitionFailure({ status, text = '' }) {
  const intermediary403 = status === 403 && /intermediary|upstream|timeout|gateway/iu.test(text);
  return { retry: intermediary403 || [500, 502, 503, 504].includes(status) };
}

export function validateArtifactMetadata(metadata, expected) {
  if (!metadata || metadata.id !== expected.id || metadata.name !== expected.name) throw new TypeError('artifact identity mismatch');
  if (metadata.workflow_run?.id !== expected.runId || metadata.workflow_run?.head_sha !== expected.sha || !SHA.test(expected.sha)) {
    throw new TypeError('artifact run or SHA mismatch');
  }
  if (metadata.digest !== expected.digest || !DIGEST.test(expected.digest)) throw new TypeError('artifact digest mismatch');
  return true;
}

export async function acquireBuildArtifact({ fetch, expected, outputPath, attempts = 3, now = () => Date.now(), deadlineMs = 60_000 }) {
  const started = now();
  for (let attempt = 1; attempt <= attempts && now() - started <= deadlineMs; attempt += 1) {
    const stage = `${outputPath}.attempt-${attempt}`;
    rmSync(stage, { force: true });
    try {
      const metadataResponse = await fetch(expected.metadataUrl);
      const metadataText = await metadataResponse.text();
      if (!metadataResponse.ok) throw Object.assign(new Error('artifact metadata request failed'), { status: metadataResponse.status, text: metadataText });
      validateArtifactMetadata(JSON.parse(metadataText), expected);
      const downloadResponse = await fetch(expected.downloadUrl);
      const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
      if (!downloadResponse.ok) throw Object.assign(new Error('artifact download request failed'), { status: downloadResponse.status, text: new TextDecoder().decode(bytes) });
      if (createHash('sha256').update(bytes).digest('hex') !== expected.digest) throw new TypeError('artifact digest mismatch');
      mkdirSync(resolve(outputPath, '..'), { recursive: true });
      writeFileSync(stage, bytes);
      renameSync(stage, outputPath);
      return { attempt, digest: expected.digest, outputPath };
    } catch (error) {
      rmSync(stage, { force: true });
      if (attempt === attempts || now() - started > deadlineMs || !classifyAcquisitionFailure(error).retry) throw error;
    }
  }
  throw new Error('artifact acquisition deadline exceeded');
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

export function main(argv = process.argv.slice(2), dependencies = {}) {
  const input = cliArgs(argv);
  const execute = dependencies.execFileSync ?? execFileSync;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) throw new TypeError('GITHUB_REPOSITORY is required');
  const expected = { digest: input.digest, id: Number(input.id), name: input.name, runId: Number(input.runId), sha: input.sha };
  const metadata = JSON.parse(execute('gh', ['api', `repos/${repository}/actions/artifacts/${input.id}`], { encoding: 'utf8' }));
  validateArtifactMetadata(metadata, expected);
  const archive = execute('gh', ['api', `repos/${repository}/actions/artifacts/${input.id}/zip`], { encoding: null });
  if (createHash('sha256').update(archive).digest('hex') !== expected.digest) throw new TypeError('artifact digest mismatch');
  mkdirSync(resolve(input.output, '..'), { recursive: true });
  writeFileSync(`${input.output}.zip`, archive);
  execute('unzip', ['-q', `${input.output}.zip`, '-d', resolve(input.output, '..')]);
  rmSync(`${input.output}.zip`, { force: true });
  process.stdout.write(JSON.stringify({ artifactId: expected.id, digest: expected.digest, name: expected.name, sha: expected.sha }) + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
