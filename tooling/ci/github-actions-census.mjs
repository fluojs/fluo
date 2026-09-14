#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export function parseBounds(since, until) {
  if (![since, until].every((value) => typeof value === 'string' && UTC.test(value))) {
    throw new TypeError('--since and --until must be UTC ISO timestamps');
  }
  const parsed = { since: new Date(since), until: new Date(until) };
  if (Number.isNaN(parsed.since.valueOf()) || Number.isNaN(parsed.until.valueOf()) || parsed.since >= parsed.until) {
    throw new TypeError('UTC bounds must be valid and half-open');
  }
  return { since: parsed.since.toISOString(), until: parsed.until.toISOString() };
}

export function classifyAttempt(attempt) {
  const jobs = Array.isArray(attempt?.jobs) ? attempt.jobs : [];
  const failedJobs = jobs.filter((job) => ['failure', 'timed_out'].includes(job?.conclusion) && job.completed_at);
  if (failedJobs.length > 0) return { failedJobs, kind: 'failure-bearing' };
  if (jobs.length === 0 && attempt?.conclusion === 'action_required') return { failedJobs, kind: 'zero-job-action-required' };
  if (jobs.length === 0 && attempt?.conclusion === 'cancelled') return { failedJobs, kind: 'zero-job-cancelled' };
  return { failedJobs, kind: 'non-failure' };
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--help') return { help: true };
    if (!['--input', '--since', '--until'].includes(flag)) throw new TypeError(`unknown option: ${flag}`);
    options[flag.slice(2)] = argv[++index];
  }
  return options;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) return process.stdout.write('Usage: github-actions-census --input <replay.json> --since <UTC> --until <UTC>\n');
  const bounds = parseBounds(options.since, options.until);
  if (!options.input) throw new TypeError('--input is required in replay mode');
  const input = JSON.parse(readFileSync(resolve(options.input), 'utf8'));
  if (!Array.isArray(input?.attempts)) throw new TypeError('replay input must contain attempts');
  const attempts = input.attempts
    .filter((attempt) => attempt.created_at >= bounds.since && attempt.created_at < bounds.until)
    .map((attempt) => ({ ...attempt, classification: classifyAttempt(attempt) }));
  process.stdout.write(`${JSON.stringify({ attempts, capturedAt: new Date().toISOString(), scope: bounds })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
