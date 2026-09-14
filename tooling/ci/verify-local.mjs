#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, platform, release, arch } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildVerificationPlan,
  digest,
  readVerificationManifest,
  receiptMatchesPlan,
} from './local-verification.mjs';

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
const hash = (value) => createHash('sha256').update(value).digest('hex');

export function parseArgs(argv) {
  const options = { baseRef: 'origin/main', plan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--plan') options.plan = true;
    else if (value === '--base-ref') {
      const baseRef = argv[index + 1];
      if (!baseRef) throw new TypeError('--base-ref requires a value');
      options.baseRef = baseRef;
      index += 1;
    } else if (value === '--help') options.help = true;
    else throw new TypeError(`unknown option: ${value}`);
  }
  return options;
}

export function collectIdentity(root, baseRef) {
  const headSha = text(root, 'git', ['rev-parse', 'HEAD']);
  const mergeBase = text(root, 'git', ['merge-base', 'HEAD', baseRef]);
  const changedFiles = rawText(root, 'git', ['diff', '--name-only', '-z', `${mergeBase}...HEAD`])
    .split('\0').filter(Boolean).sort();
  const diff = text(root, 'git', ['diff', '--binary', `${mergeBase}...HEAD`]);
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

function executePlan(root, plan, baseRef) {
  const logRoot = resolve(root, '.omo/verification/logs', plan.identity.headSha);
  mkdirSync(logRoot, { recursive: true });
  const commands = [];
  const logs = [];
  for (const [index, item] of plan.commands.entries()) {
    const startedAt = time();
    const identityBefore = collectIdentity(root, baseRef);
    if (!identityBefore.clean || !sameIdentity(plan.identity, identityBefore)) {
      commands.push({
        ...item,
        cwd: root,
        exitCode: 1,
        finishedAt: time(),
        identityAfter: identityBefore,
        identityBefore,
        signal: null,
        spawnError: 'worktree identity changed before command execution',
        startedAt,
      });
      break;
    }
    const commandRoot = resolve(root, item.cwd);
    if (commandRoot !== root && !commandRoot.startsWith(`${root}${sep}`)) {
      throw new TypeError(`verification command ${item.id} cwd escapes the worktree`);
    }
    const result = run(commandRoot, item.executable, item.argv);
    const identityAfter = collectIdentity(root, baseRef);
    const content = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const path = resolve(logRoot, `${index}.log`);
    writeFileSync(path, content);
    commands.push({
      ...item,
      exitCode: result.status,
      finishedAt: time(),
      identityAfter,
      identityBefore,
      signal: result.signal,
      spawnError: result.error ? String(result.error.message) : null,
      startedAt,
    });
    logs.push({ commandId: item.id, digest: hash(content), path: relative(root, path) });
    if (result.status !== 0 || result.signal || result.error || !identityAfter.clean || !sameIdentity(plan.identity, identityAfter)) break;
  }
  return { commands, logs };
}

function usage() {
  return [
    'Usage: pnpm verify:local [--plan] [--base-ref <ref>]',
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
  });
  if (options.plan) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const startedAt = time();
  const execution = executePlan(root, plan, options.baseRef);
  const finalIdentity = collectIdentity(root, options.baseRef);
  const completed = execution.commands.length === plan.commands.length
    && execution.commands.every((result) => result.exitCode === 0 && result.signal === null && result.spawnError === null);
  const receipt = {
    commands: execution.commands,
    completedAt: time(),
    environment: { arch: arch(), home: homedir(), node: process.version, os: platform(), osRelease: release() },
    identity,
    limitations: plan.mode === 'full' ? ['CI-only runners, artifact transfer, and aggregate semantics require GitHub Actions.'] : [],
    logs: execution.logs,
    manifestDigest: plan.manifestDigest,
    planDigest: digest(JSON.stringify(plan.commands)),
    startedAt,
    status: identity.clean && finalIdentity.clean && completed && receiptMatchesPlan({
      commands: execution.commands,
      completedAt: time(),
      identity,
      limitations: [],
      logs: execution.logs,
      manifestDigest: plan.manifestDigest,
      planDigest: digest(JSON.stringify(plan.commands)),
      startedAt,
      status: 'passed',
      version: 1,
    }, finalIdentity, plan) ? 'passed' : 'failed',
    version: 1,
  };
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
