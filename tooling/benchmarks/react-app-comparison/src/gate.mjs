import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluateObservedRanges, evaluatePerformance, METRICS } from './evaluate.ts';
import { verifyEnvironmentBinding, verifyMeasurementEnvironment, verifyTraceFiles } from './measure.mjs';
import { pairStimuliComparison, verifyMethodBinding, verifyMethodReceipt } from './fa-v2.mjs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

async function authenticateEvidence(baseline, receipts, outputRoot) {
  const runs = receipts.flatMap((receipt) => {
    if (baseline.profiles[receipt.profile]?.mode !== receipt.mode || !Array.isArray(receipt.runs)) {
      throw new TypeError(`Invalid measurement receipt: ${receipt.profile}`);
    }
    if (receipt.runs.some((run) => run.profile !== receipt.profile || run.mode !== receipt.mode)) {
      throw new TypeError(`Mismatched measurement profile: ${receipt.profile}`);
    }
    return receipt.runs;
  });
  if (new Set(receipts.map((receipt) => receipt.profile)).size !== receipts.length) {
    throw new TypeError('Duplicate measurement profile receipt');
  }
  await verifyTraceFiles(receipts.flatMap((receipt) => [
    ...receipt.runs, ...(receipt.warmups ?? []), ...(receipt.developmentWarmups ?? []),
  ]), outputRoot);
  let provenance;
  for (const run of runs) {
    const trace = JSON.parse(await readFile(run.trace, 'utf8'));
    if (trace.profile !== undefined && (
      trace.profile !== run.profile || trace.mode !== run.mode
      || trace.framework !== run.framework || trace.runId !== run.runId
    )) throw new TypeError(`Mismatched raw trace identity: ${run.trace}`);
    const sources = Array.isArray(trace.sourceTraces)
      ? await Promise.all(trace.sourceTraces.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))
      : [trace];
    for (const source of sources) {
      const signature = JSON.stringify(source.provenance);
      if (provenance === undefined) provenance = signature;
      else if (signature !== provenance) throw new TypeError(`Mismatched raw trace provenance: ${run.trace}`);
    }
    const rawMetrics = Object.assign({}, ...sources.map((source) => source.metrics));
    if (JSON.stringify(rawMetrics) !== JSON.stringify(run.metrics)) {
      throw new TypeError(`Mismatched raw trace metrics: ${run.trace}`);
    }
  }
  return runs;
}

export async function evaluateEvidence(baseline, receipts, outputRoot) {
  const runs = await authenticateEvidence(baseline, receipts, outputRoot);
  const observations = Object.fromEntries(Object.keys(baseline.profiles).map((profile) => [
    profile,
    Object.fromEntries(['fluo', 'next', 'react-router', 'tanstack-start'].map((framework) => [
      framework,
      Object.fromEntries(METRICS.map((metric) => {
        const values = runs.filter((run) => run.profile === profile && run.framework === framework)
          .map((run) => run.metrics[metric])
          .filter((value) => Number.isFinite(value));
        values.sort((left, right) => left - right);
        const middle = Math.floor(values.length / 2);
        return [metric, values.length === 0 ? null
          : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2];
      })),
    ])),
  ]));
  return { ...evaluatePerformance(baseline, runs), observations };
}

/** Historical evaluateEvidence is replay only; this is the versioned acceptance seam. */
export async function evaluateAcceptedEvidence(baseline, timingReceipts, outputRoot, nativeReceipts = []) {
  if (!timingReceipts.length || timingReceipts.some((receipt) => receipt.methodVersion !== 'FA-V2'
    || receipt.measurementPurpose !== 'timing')) throw new Error('FA-V2 timing receipts required');
  const frozenBytes = await readFile(new URL('../baseline.json', import.meta.url));
  const frozen = JSON.parse(frozenBytes);
  const baselineSha256 = createHash('sha256').update(frozenBytes).digest('hex');
  if (!isDeepStrictEqual(baseline, frozen)) throw new Error('FA-V2 frozen baseline mutation');
  if (nativeReceipts.length !== timingReceipts.length
    || nativeReceipts.some((receipt) => receipt.methodVersion !== 'FA-V2'
      || receipt.measurementPurpose !== 'native-conformance')) throw new Error('FA-V2 matching native counterpart required');
  const identities = new Set();
  const executions = new Set();
  let product;
  let pairId;
  let pairPhase;
  for (const timing of timingReceipts) {
    if (identities.has(timing.profile)) throw new Error('FA-V2 duplicate profile');
    identities.add(timing.profile);
    const matches = nativeReceipts.filter((receipt) => receipt.profile === timing.profile);
    if (matches.length !== 1) throw new Error('FA-V2 missing/duplicate native counterpart');
    const native = matches[0];
    const timingMethod = await verifyMethodReceipt(timing, outputRoot);
    const nativeMethod = await verifyMethodReceipt(native, outputRoot);
    for (const receipt of [timing, native]) {
      if (!receipt.isolatedRepresentative || !receipt.environmentBinding) {
        throw new Error('FA-V2 representative environment authentication required');
      }
      await verifyMeasurementEnvironment(receipt, outputRoot);
      const method = receipt.methodBinding;
      product ??= method.productSha256;
      pairId ??= method.pairId;
      pairPhase ??= method.pairPhase;
      if (method.baselineSha256 !== baselineSha256 || method.productSha256 !== product
        || method.pairId !== pairId || method.pairPhase !== pairPhase) {
        throw new Error('FA-V2 mixed baseline/product/pair identity');
      }
      if (executions.has(method.executionId)) throw new Error('FA-V2 borrowed execution identity');
      executions.add(method.executionId);
      if (receipt.runs.length !== 20 || receipt.warmups.length !== 8
        || (receipt.developmentMethodBinding && receipt.developmentWarmups?.length !== 8)) {
        throw new Error('FA-V2 incomplete independent repetitions');
      }
      for (const framework of ['fluo', 'next', 'react-router', 'tanstack-start']) {
        const measured = receipt.runs.filter((run) => run.framework === framework);
        const warmups = receipt.warmups.filter((run) => run.framework === framework);
        if (measured.length !== 5 || warmups.length !== 2
          || new Set([...measured, ...warmups].map((run) => run.runId)).size !== 7) {
          throw new Error('FA-V2 incomplete independent repetitions');
        }
        if (receipt.developmentMethodBinding) {
          const developmentWarmups = receipt.developmentWarmups.filter((run) => run.framework === framework);
          if (!isDeepStrictEqual(warmups.map((run) => run.runId).sort(),
            developmentWarmups.map((run) => run.runId).sort())) {
            throw new Error('FA-V2 development warmup inventory mismatch');
          }
        }
      }
    }
    if (timingMethod.stimuliSha256 !== nativeMethod.stimuliSha256
      || timingMethod.configSha256 === nativeMethod.configSha256
      || !isDeepStrictEqual(timing.provenance, native.provenance)) {
      throw new Error('FA-V2 counterpart configuration/product/stimuli mismatch');
    }
    const commonEnvironment = async (receipt) => {
      const { identity } = await verifyEnvironmentBinding(receipt.environmentBinding, outputRoot);
      const { external, python, observer, fileContents, ...guest } = identity.guest;
      return { ...identity, guest };
    };
    if (!isDeepStrictEqual(await commonEnvironment(timing), await commonEnvironment(native))) {
      throw new Error('FA-V2 counterpart environment/tool/build mismatch');
    }
    if (Boolean(timing.developmentMethodBinding) !== Boolean(native.developmentMethodBinding)) {
      throw new Error('FA-V2 counterpart development inventory mismatch');
    }
    if (timing.developmentMethodBinding) {
      const timingDev = await verifyMethodReceipt({ ...timing,
        methodBinding: timing.developmentMethodBinding, runs: timing.developmentWarmups,
        warmups: [], developmentWarmups: undefined, developmentMethodBinding: undefined }, outputRoot);
      const nativeDev = await verifyMethodReceipt({ ...native,
        methodBinding: native.developmentMethodBinding, runs: native.developmentWarmups,
        warmups: [], developmentWarmups: undefined, developmentMethodBinding: undefined }, outputRoot);
      if (timingDev.stimuliSha256 !== nativeDev.stimuliSha256
        || timingDev.executionId === nativeDev.executionId || timingDev.configSha256 === nativeDev.configSha256) {
        throw new Error('FA-V2 counterpart development configuration mismatch');
      }
    }
    const keys = (receipt) => receipt.runs.map((run) => `${run.framework}:${run.runId}`).sort();
    if (!isDeepStrictEqual(keys(timing), keys(native))) throw new Error('FA-V2 native counterpart run inventory mismatch');
  }
  // Native performance values are authenticated but never evaluated as timing.
  await authenticateEvidence(baseline, timingReceipts, outputRoot);
  await authenticateEvidence(baseline, nativeReceipts, outputRoot);
  const evaluation = evaluateObservedRanges(baseline, timingReceipts.flatMap((receipt) => receipt.runs));
  const nativeChecks = [...timingReceipts, ...nativeReceipts].flatMap((receipt) =>
    [...receipt.runs, ...receipt.warmups, ...(receipt.developmentWarmups ?? [])]
      .filter((run) => run.correctness !== 'pass' || run.metrics.errorRate > 0)
      .map((run) => ({ profile: run.profile, mode: run.mode, framework: run.framework,
        verdict: run.correctness === 'fail' || run.metrics.errorRate > 0 ? 'fail' : 'inconclusive', reason: 'measurement-quality',
        measurementPurpose: receipt.measurementPurpose })));
  const checks = [...evaluation.checks, ...nativeChecks];
  return { methodVersion: 'FA-V2', measurementPurpose: 'timing', pairId, pairPhase, checks,
    counterpartConfigurations: nativeReceipts.map((receipt) => receipt.methodBinding),
    verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
      : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass' };
}

export async function evaluateAcceptedPair(baseline, before, after) {
  const results = [];
  const methods = [];
  for (const cohort of [before, after]) {
    results.push(await evaluateAcceptedEvidence(baseline, cohort.timing, cohort.outputRoot, cohort.native));
    methods.push(await Promise.all(cohort.timing.map((receipt) => verifyMethodReceipt(receipt, cohort.outputRoot))));
  }
  if (results[0].pairPhase !== 'before' || results[1].pairPhase !== 'after'
    || results[0].pairId !== results[1].pairId || methods[0].length !== methods[1].length
    ) throw new Error('FA-V2 before/after frozen pair mismatch');
  const sourceRelations = [];
  for (const method of methods[0]) {
    const counterpart = methods[1].find((candidate) => candidate.configuration.profile === method.configuration.profile);
    const first = before.timing.find((receipt) => receipt.profile === method.configuration.profile);
    const second = after.timing.find((receipt) => receipt.profile === method.configuration.profile);
    if (!counterpart || method.executionId === counterpart.executionId
      || first.environmentBinding.identitySha256 !== second.environmentBinding.identitySha256
      || pairStimuliComparison(method.configuration, counterpart.configuration) !== 'identical') {
      throw new Error('FA-V2 before/after production pair mismatch');
    }
    if (Boolean(first.developmentMethodBinding) !== Boolean(second.developmentMethodBinding)) {
      throw new Error('FA-V2 before/after development inventory mismatch');
    }
    if (!first.developmentMethodBinding) continue;
    const firstDev = await verifyMethodBinding(first.developmentMethodBinding, before.outputRoot);
    const secondDev = await verifyMethodBinding(second.developmentMethodBinding, after.outputRoot);
    const comparison = pairStimuliComparison(firstDev.configuration, secondDev.configuration);
    if (comparison === 'mismatch') throw new Error('FA-V2 before/after development stimuli mismatch');
    if (comparison === 'react-edit-source-relation-required') {
      // Client adoption retains its existing RE-A01 verifier. Do not fork it or
      // accept a caller's descriptor/hash as authentication. Server-only pairs
      // never enter this path; absent source authentication fails closed.
      const measurement = await import('./measure.mjs');
      if (typeof measurement.authenticateReactEditPair !== 'function') {
        throw new Error('FA-V2 RE-A01 authenticated source verifier unavailable');
      }
      if (before.outputRoot !== after.outputRoot) throw new Error('FA-V2 RE-A01 requires common evidence root');
      const relation = await measurement.authenticateReactEditPair(
        first.developmentEnvironmentBinding, second.developmentEnvironmentBinding, before.outputRoot);
      if (!relation) throw new Error('FA-V2 RE-A01 source relation missing');
      sourceRelations.push(relation);
    }
  }
  const verdict = results.some((result) => result.verdict === 'fail') ? 'fail'
    : results.some((result) => result.verdict === 'inconclusive') ? 'inconclusive' : 'pass';
  return { methodVersion: 'FA-V2', pairId: results[0].pairId, verdict, sourceRelations,
    before: results[0], after: results[1] };
}

async function main() {
  const args = process.argv.slice(2);
  const baselinePath = args[args.indexOf('--baseline') + 1];
  const outputPath = args[args.indexOf('--output') + 1];
  const root = args[args.indexOf('--trace-root') + 1];
  const files = args.filter((arg, index) =>
    !['--baseline', '--output', '--trace-root'].includes(args[index - 1])
    && !['--baseline', '--output', '--trace-root', '--historical-replay'].includes(arg));
  if (!baselinePath || !outputPath || !root || files.length === 0) {
    throw new TypeError('usage: node src/gate.mjs --baseline baseline.json --output report.json --trace-root traces/ result.json ...');
  }
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const receipts = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const historical = args.includes('--historical-replay');
  if (!historical && receipts.some((receipt) => receipt.methodVersion !== 'FA-V2'
    || !['timing', 'native-conformance'].includes(receipt.measurementPurpose))) {
    throw new Error('FA-V2 timing receipts required; mixed historical/unversioned/purpose evidence rejected');
  }
  const timing = receipts.filter((receipt) => receipt.measurementPurpose === 'timing');
  const native = receipts.filter((receipt) => receipt.measurementPurpose === 'native-conformance');
  const result = historical ? await evaluateEvidence(baseline, receipts, root)
    : await evaluateAcceptedEvidence(baseline, timing.length ? timing : receipts, root, native);
  await writeFile(outputPath, `${JSON.stringify({ ...result, receipts: files }, null, 2)}\n`);
  console.log(`React app performance gate: ${result.verdict} (${result.checks.length} checks)`);
  if (result.verdict !== 'pass') process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
