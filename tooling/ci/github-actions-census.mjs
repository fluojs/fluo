#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectGithubActionsCensus } from './github-actions-census-github.mjs';

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const LIMITATION = 'Deleted or retention-expired GitHub Actions records cannot be recovered.';

const fingerprint = (value) => createHash('sha256').update(value).digest('hex');
const validTimestamp = (value) => {
  if (typeof value !== 'string' || !UTC.test(value)) return false;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  const normalized = new Date(timestamp).toISOString();
  return value.includes('.') ? value === normalized : value === normalized.replace('.000', '');
};
const safeRecord = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};

export function parseBounds(since, until) {
  if (!validTimestamp(since) || !validTimestamp(until)) throw new TypeError('--since and --until must be UTC ISO timestamps');
  const start = new Date(since);
  const end = new Date(until);
  if (start >= end) throw new TypeError('UTC bounds must be valid and half-open');
  return { since: start.toISOString(), until: end.toISOString() };
}

export function parseCensusArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') return { help: true };
    if (!['--input', '--owner', '--repo', '--workflow', '--since', '--until'].includes(flag)) {
      throw new TypeError(`unknown option: ${flag}`);
    }
    const value = argv[++index];
    if (!value) throw new TypeError(`${flag} requires a value`);
    options[flag.slice(2)] = value;
  }
  for (const key of ['owner', 'repo', 'workflow']) {
    if (typeof options[key] !== 'string' || !NAME.test(options[key])) throw new TypeError(`--${key} must be a GitHub identifier`);
  }
  return { ...options, ...parseBounds(options.since, options.until) };
}

export function classifyAttempt(attempt) {
  const jobs = Array.isArray(attempt?.jobs) ? attempt.jobs : [];
  const failedJobs = jobs.filter((job) => ['failure', 'timed_out'].includes(job?.conclusion) && job.completed_at);
  if (failedJobs.length > 0) return { failedJobs, kind: 'failure-bearing' };
  if (jobs.length !== 0) {
    const knownNonFailure = new Set(['cancelled', 'neutral', 'skipped', 'success']);
    return {
      failedJobs,
      kind: jobs.every((job) => knownNonFailure.has(job?.conclusion)) ? 'non-failure' : 'unknown',
    };
  }
  if (attempt?.conclusion === 'action_required' && /approval/iu.test(String(attempt.event ?? ''))) {
    return { failedJobs, kind: 'zero-job-approval' };
  }
  if (attempt?.conclusion === 'action_required') return { failedJobs, kind: 'zero-job-action-required' };
  if (attempt?.conclusion === 'cancelled' && /replacement/iu.test(String(attempt.event ?? ''))) {
    return { failedJobs, kind: 'zero-job-replacement-cancelled' };
  }
  if (attempt?.conclusion === 'cancelled') return { failedJobs, kind: 'zero-job-cancelled' };
  if (attempt?.conclusion === 'failure') return { failedJobs, kind: 'zero-job-failure' };
  if (attempt?.conclusion === 'timed_out') return { failedJobs, kind: 'zero-job-timed-out' };
  if (['neutral', 'skipped', 'success'].includes(attempt?.conclusion)) return { failedJobs, kind: 'non-failure' };
  return { failedJobs, kind: 'zero-job-unknown' };
}

function normalizeJobName(name) {
  return String(name ?? 'unknown')
    .replace(/Node support \([^)]*\)\s*\/\s*/iu, '')
    .replace(/Test \((?:packages|tooling)-\d+\)/iu, 'Test')
    .trim();
}

function collectClassificationCounts(attempts) {
  const counts = new Map();
  for (const attempt of attempts) {
    const kind = attempt.classification.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function collectFailureSummary(attempts) {
  const byFingerprint = new Map();
  const derivedAggregateOccurrences = [];
  for (const attempt of attempts) {
    if (attempt.classification.kind !== 'failure-bearing') continue;
    for (const job of attempt.classification.failedJobs) {
      const failedStepEvidence = Array.isArray(job.steps)
        ? job.steps
          .filter((step) => ['failure', 'timed_out'].includes(step?.conclusion))
          .map((step) => [String(step.name ?? 'unknown'), String(step.conclusion)])
          .sort(([left], [right]) => left.localeCompare(right))
        : [];
      const jobFingerprint = fingerprint(JSON.stringify([
        normalizeJobName(job.name),
        String(job.conclusion ?? 'unknown'),
        failedStepEvidence,
      ]));
      const occurrence = {
        fingerprints: { job: jobFingerprint, steps: fingerprint(JSON.stringify(failedStepEvidence)) },
        job: { conclusion: job.conclusion, id: job.id, name: job.name },
        run: { id: attempt.run.id, attempt: attempt.attempt.run_attempt },
        urls: {
          attempt: `${attempt.run.html_url}/attempts/${attempt.attempt.run_attempt}`,
          job: job.html_url ?? null,
          run: attempt.run.html_url ?? null,
        },
      };
      if (normalizeJobName(job.name) === 'Verify') {
        derivedAggregateOccurrences.push(occurrence);
        continue;
      }
      const group = byFingerprint.get(jobFingerprint) ?? { fingerprint: jobFingerprint, occurrences: [] };
      group.occurrences.push(occurrence);
      byFingerprint.set(jobFingerprint, group);
    }
  }
  return {
    classificationCounts: collectClassificationCounts(attempts),
    derivedAggregateOccurrences: derivedAggregateOccurrences.sort((left, right) => left.run.id - right.run.id),
    failureBearingAttempts: attempts.filter((attempt) => attempt.classification.kind === 'failure-bearing').length,
    signatures: [...byFingerprint.values()].sort((left, right) =>
      right.occurrences.length - left.occurrences.length || left.fingerprint.localeCompare(right.fingerprint)),
  };
}

function selectedRuns(input, bounds) {
  if (!Array.isArray(input.workflow_runs) || !Array.isArray(input.attempts)) {
    throw new TypeError('census input must contain workflow_runs and attempts arrays');
  }
  const selected = input.workflow_runs.filter((run) => {
    safeRecord(run, 'workflow run');
    if (!Number.isSafeInteger(run.id) || !validTimestamp(run.created_at)) throw new TypeError('workflow run id and created_at are required');
    const createdAt = Date.parse(run.created_at);
    return createdAt >= Date.parse(bounds.since) && createdAt < Date.parse(bounds.until);
  });
  const attemptsByRun = new Map();
  for (const attempt of input.attempts) {
    safeRecord(attempt, 'attempt');
    if (!Number.isSafeInteger(attempt.run_id) || !Number.isSafeInteger(attempt.run_attempt) || !validTimestamp(attempt.created_at) || !Array.isArray(attempt.jobs)) {
      throw new TypeError('attempt run_id, run_attempt, created_at, and jobs are required');
    }
    const key = `${attempt.run_id}:${attempt.run_attempt}`;
    const previous = attemptsByRun.get(key);
    if (previous && JSON.stringify(previous) !== JSON.stringify(attempt)) {
      throw new TypeError(`census input contains conflicting attempt ${key}`);
    }
    attemptsByRun.set(key, attempt);
  }
  return selected.flatMap((run) => {
    if (!Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) throw new TypeError('workflow run run_attempt is required');
    return Array.from({ length: run.run_attempt }, (_, index) => {
      const attempt = attemptsByRun.get(`${run.id}:${index + 1}`);
      if (!attempt) throw new TypeError(`workflow run ${run.id} is incomplete at attempt ${index + 1}`);
      return { attempt, classification: classifyAttempt(attempt), jobs: attempt.jobs, run };
    });
  });
}

export function buildCensus({ input, owner, repo, workflow, since, until }) {
  for (const [key, value] of Object.entries({ owner, repo, workflow })) {
    if (typeof value !== 'string' || !NAME.test(value)) throw new TypeError(`${key} must be a GitHub identifier`);
  }
  const bounds = parseBounds(since, until);
  const attempts = selectedRuns(safeRecord(input, 'census input'), bounds);
  return {
    attempts,
    limits: [...new Set([...(Array.isArray(input.limits) ? input.limits : []), LIMITATION])].sort(),
    observedAt: validTimestamp(input.observed_at) ? new Date(input.observed_at).toISOString() : null,
    pagination: safeRecord(input.pagination ?? {}, 'pagination'),
    scope: { owner, repo, since: bounds.since, until: bounds.until, workflow },
    summary: collectFailureSummary(attempts),
  };
}

function usage() {
  return 'Usage: github-actions-census --owner <owner> --repo <repo> --workflow <workflow> --since <UTC> --until <UTC> [--input <replay.json>]';
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCensusArgs(argv);
  if (options.help) return process.stdout.write(`${usage()}\n`);
  const input = options.input
    ? JSON.parse(readFileSync(resolve(options.input), 'utf8'))
    : collectGithubActionsCensus(options);
  process.stdout.write(`${JSON.stringify(buildCensus({ ...options, input }))}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
