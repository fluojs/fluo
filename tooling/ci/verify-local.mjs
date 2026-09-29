#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVerificationPlan,
  digest,
  readVerificationManifest,
  receiptMatchesPlan,
} from './local-verification.mjs';
import { aggregateResults, runHostChecks, runTask } from './verification-runner.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const run = (root, executable, argv) => spawnSync(executable, argv, { cwd: root, encoding: 'utf8' });
const text = (root, executable, argv) => {
  const result = run(root, executable, argv);
  if (result.status !== 0) throw new Error(`${executable} ${argv.join(' ')} failed`);
  return result.stdout.trim();
};
const rawText = (root, executable, argv) => {
  const result = run(root, executable, argv);
  if (result.status !== 0) throw new Error(`${executable} ${argv.join(' ')} failed`);
  return result.stdout;
};
const time = () => new Date().toISOString();

export function parseArgs(argv) {
  const options = { baseRef: 'origin/main', plan: false, profile: 'pr' };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--plan') options.plan = true;
    else if (value === '--base-ref') {
      const baseRef = argv[index + 1];
      if (!baseRef) throw new TypeError('--base-ref requires a value');
      options.baseRef = baseRef;
      index += 1;
    } else if (value === '--help') options.help = true;
    else if (value === '--profile') {
      if (!['pr', 'extended'].includes(argv[index + 1])) throw new TypeError('--profile requires pr or extended');
      options.profile = argv[++index];
    }
    else throw new TypeError(`unknown option: ${value}`);
  }
  return options;
}

export function collectIdentity(root, baseRef) {
  const headSha = text(root, 'git', ['rev-parse', 'HEAD']);
  const mergeBase = text(root, 'git', ['merge-base', 'HEAD', baseRef]);
  const changedFiles = rawText(root, 'git', ['diff', '--name-only', '-z', `${mergeBase}...HEAD`])
    .split('\0').filter(Boolean).sort();
  const diff = rawText(root, 'git', ['diff', '--binary', `${mergeBase}...HEAD`]);
  const status = rawText(root, 'git', ['status', '--porcelain=v1', '--untracked-files=all', '-z']);
  return {
    baseRef,
    baseSha: text(root, 'git', ['rev-parse', baseRef]),
    changedFiles,
    changedFilesDigest: digest(changedFiles.join('\n')),
    clean: status.length === 0,
    diffDigest: digest(diff),
    headSha,
    mergeBase,
    root,
    treeSha: text(root, 'git', ['rev-parse', 'HEAD^{tree}']),
    worktreeStatusDigest: digest(status),
  };
}

function writeReceipt(root, receipt) {
  const path = resolve(root, '.omo/verification', `${receipt.identity.headSha}.json`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return path;
}

function sameIdentity(left, right) {
  return ['baseRef', 'baseSha', 'changedFilesDigest', 'clean', 'diffDigest', 'headSha', 'mergeBase', 'root', 'treeSha', 'worktreeStatusDigest']
    .every((key) => left[key] === right[key]);
}

function usage() {
  return [
    'Usage: pnpm verify:local [--plan] [--base-ref <sha>] [--profile pr|extended]',
    '',
    'Runs the exact-head local verification plan and writes a receipt under .omo/verification.',
    '--plan prints the command plan only and never writes a passing receipt.',
  ].join('\n');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const root = text(dirname(scriptPath), 'git', ['rev-parse', '--show-toplevel']);
  const identity = collectIdentity(root, options.baseRef);
  const plan = buildVerificationPlan({
    changedFiles: identity.changedFiles,
    identity,
    manifest: readVerificationManifest(),
    profile: options.profile,
  });
  if (options.plan) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  if (!identity.clean) throw new TypeError('canonical verification requires a clean frozen worktree');
  const startedAt = time();
  const evidenceRoot = resolve(root, '.omo/verification/ci-parity/runner',
    `${identity.headSha}-${Date.now()}-${process.pid}`);
  const output = resolve(evidenceRoot, 'results');
  const artifactsRoot = resolve(evidenceRoot, 'artifacts');
  mkdirSync(output, { recursive: true });
  mkdirSync(artifactsRoot, { recursive: true });
  const planPath = resolve(evidenceRoot, 'plan.json');
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  let reason = null;
  let hostChecks = null;
  try { hostChecks = runHostChecks(plan, output, root); }
  catch (error) { reason = `host integration: ${error instanceof Error ? error.message : String(error)}`; }
  for (const task of plan.tasks) {
    if (reason) break;
    try {
      if (!sameIdentity(identity, collectIdentity(root, options.baseRef))) throw new TypeError('host identity changed before task');
      runTask(plan, task.id, output, artifactsRoot, planPath, root);
    } catch (error) {
      reason = `${task.id}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  let taskResults = [];
  if (!reason) {
    try { taskResults = aggregateResults(plan, output, artifactsRoot); }
    catch (error) { reason = error instanceof Error ? error.message : String(error); }
  }
  const finalIdentity = collectIdentity(root, options.baseRef);
  if (!sameIdentity(identity, finalIdentity)) reason = 'host source identity changed during verification';
  const files = (items) => items.map((path) => ({ path: relative(root, path), digest: digest(readFileSync(path)) }));
  const logs = taskResults.flatMap((result) => result.logs.map((log) => resolve(output, log.path)));
  logs.push(...taskResults.map((result) => resolve(output, `${result.taskId}.json`)));
  if (hostChecks) {
    logs.push(...hostChecks.logs.map((log) => resolve(output, log.path)), resolve(output, 'host-checks.json'));
  }
  const artifacts = taskResults.flatMap((result) => result.artifacts.map((file) => resolve(artifactsRoot, file.path)));
  const receipt = {
    artifacts: files(artifacts),
    capabilityTasks: plan.capabilityTasks,
    completedAt: time(),
    environment: { imageKey: plan.environment.imageKey, lock: plan.environment.lock },
    environmentLockDigest: plan.environment.lockDigest,
    hostChecks,
    identity,
    imageIdentity: { key: plan.environment.imageKey, id: taskResults[0]?.imageId ?? null },
    logs: files(logs),
    manifestDigest: plan.manifestDigest,
    planDigest: plan.semanticDigest,
    profile: plan.profile,
    source: plan.source,
    startedAt,
    status: reason ? 'failed' : 'passed',
    taskResults,
    version: 2,
  };
  if (receipt.status === 'passed' && !receiptMatchesPlan(receipt, finalIdentity, plan)) {
    receipt.status = 'failed';
    reason = 'receipt did not match the frozen verification plan';
  }
  if (reason) receipt.reason = reason;
  const path = writeReceipt(root, receipt);
  process.stdout.write(`${JSON.stringify({ path, status: receipt.status }, null, 2)}\n`);
  if (receipt.status !== 'passed') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
