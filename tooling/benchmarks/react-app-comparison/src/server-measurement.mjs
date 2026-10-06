import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMeasurementReceipt } from './run-gate.mjs';
import { stopOwnedProcess } from './process-group.mjs';
import { evaluateAcceptedEvidence, evaluateAcceptedPair, evaluateEvidence, evaluatePairVerdict } from './gate.mjs';
import { captureIsolatedEnvironment, collectMeasurements, readIsolatedInvocation,
  verifyEnvironmentBinding, verifyMeasurementEnvironment, verifyTraceFiles } from './measure.mjs';

export async function evaluateServerEvidence(baseline, receipts, outputRoot) {
  for (const receipt of receipts) await verifyMeasurementEnvironment(receipt, outputRoot);
  await verifyTraceFiles(receipts.flatMap((receipt) => [
    ...receipt.runs, ...(receipt.warmups ?? []),
  ]), outputRoot);
  const serverMetrics = [
    'coldTtfbMs', 'warmTtfbMs', 'throughputRequestsPerSecond',
    'errorRate', 'cpuPercent', 'rssBytes',
  ];
  const evaluation = await evaluateEvidence(baseline, receipts, outputRoot);
  const checks = evaluation.checks.filter((check) =>
    check.metric === undefined || serverMetrics.includes(check.metric));
  const verdict = checks.some((check) => check.verdict === 'fail') ? 'fail'
    : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass';
  return { checks, verdict, serverMetrics };
}

export async function evaluateAcceptedServerEvidence(baseline, timing, outputRoot, native = []) {
  const evaluation = await evaluateAcceptedEvidence(baseline, timing, outputRoot, native);
  const serverMetrics = ['coldTtfbMs', 'warmTtfbMs', 'throughputRequestsPerSecond',
    'errorRate', 'cpuPercent', 'rssBytes'];
  const checks = evaluation.checks.filter((check) => check.metric === undefined || serverMetrics.includes(check.metric));
  return { ...evaluation, serverMetrics, checks,
    verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
      : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass' };
}

export async function evaluateAcceptedServerPair(baseline, before, after) {
  const pair = await evaluateAcceptedPair(baseline, before, after);
  const serverMetrics = ['coldTtfbMs', 'warmTtfbMs', 'throughputRequestsPerSecond',
    'errorRate', 'cpuPercent', 'rssBytes'];
  const subset = (evaluation) => {
    const checks = evaluation.checks.filter((check) => check.metric === undefined || serverMetrics.includes(check.metric));
    return { ...evaluation, checks, serverMetrics, verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
      : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass' };
  };
  const first = subset(pair.before);
  const second = subset(pair.after);
  return { ...pair, before: first, after: second, serverMetrics,
    verdict: evaluatePairVerdict(first, second, pair.methodVersion) };
}

export async function runServerMeasurement(configPath, receiptPath,
  measurementScript = fileURLToPath(import.meta.url),
  { signal, invocation } = {}) {
  let exitCode;
  let child;
  let onAbort;
  signal?.throwIfAborted();
  try {
    const receipt = await readMeasurementReceipt(() => new Promise((resolve, reject) => {
      child = spawn(process.execPath, [measurementScript,
        '--config', configPath, '--output', receiptPath, ...(invocation ? ['--isolated-guest'] : [])], {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        stdio: invocation ? ['pipe', 'inherit', 'inherit'] : 'inherit',
        detached: true,
      });
      onAbort = () => {
        void stopOwnedProcess(child).then(() => reject(signal.reason), reject);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      child.once('error', reject);
      child.once('exit', (code, exitSignal) => {
        exitCode = code;
        if (signal?.aborted) reject(signal.reason);
        else if (code === 0) resolve();
        else reject(Object.assign(new Error(`server measurement exited ${code ?? exitSignal}`), { code }));
      });
      if (invocation) child.stdin.end(JSON.stringify(invocation));
    }), receiptPath);
    signal?.throwIfAborted();
    return { receipt, exitCode };
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    if (child) await stopOwnedProcess(child);
  }
}

async function main() {
  const flags = process.argv.slice(2);
  const invocation = await readIsolatedInvocation(flags);
  if (!flags.includes('--config') || !flags.includes('--output')) {
    throw new TypeError('usage: node src/server-measurement.mjs --config <JSON> --output <JSON>');
  }
  const config = JSON.parse(await readFile(flags[flags.indexOf('--config') + 1], 'utf8'));
  const output = resolve(flags[flags.indexOf('--output') + 1]);
  if (invocation) {
    config.environmentBinding = await captureIsolatedEnvironment(config, invocation, dirname(output), {
      entrypoints: invocation.collectorEntrypoints,
    });
    await verifyEnvironmentBinding(invocation.parentEnvironmentBinding, dirname(output));
    if (config.environmentBinding.identitySha256 !== invocation.parentEnvironmentBinding.identitySha256) {
      throw new Error('environment binding server child/runner mismatch');
    }
    config.isolatedRepresentative = true;
  } else if (config.isolatedRepresentative || config.environmentBinding) {
    throw new Error('isolated representative requires live host launcher');
  }
  const { createBrowserDriver } = await import('./measure-browser.mjs');
  const driver = await createBrowserDriver(config);
  let receipt;
  try {
    receipt = await collectMeasurements(config, driver, join(dirname(output), 'traces'));
  } finally { await driver.close(); }
  await verifyMeasurementEnvironment(receipt, dirname(output));
  await verifyTraceFiles([...receipt.runs, ...receipt.warmups], dirname(output));
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  if (receipt.runs.some((run) => run.correctness !== 'pass')) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
