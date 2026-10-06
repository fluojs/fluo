import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { evaluatePerformance, METRICS } from './evaluate.ts';
import { pairStimuliComparison, verifyMethodBinding, verifyMethodReceipt } from './fa-v2.mjs';
import { verifyEnvironmentBinding, verifyMeasurementEnvironment, verifyTraceFiles } from './measure.mjs';

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
  const samples = receipts.flatMap((receipt) => [
    ...receipt.runs, ...(receipt.warmups ?? []), ...(receipt.developmentWarmups ?? []),
  ]);
  await verifyTraceFiles(samples, outputRoot);
  let provenance;
  for (const run of samples) {
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

export function evaluateMeasurementQuality(receipts) {
  return receipts.flatMap((receipt) =>
    [...receipt.runs, ...receipt.warmups, ...(receipt.developmentWarmups ?? [])].flatMap((run) => {
      const errorRateFailure = run.metrics.errorRate > 0
        && (receipt.methodVersion !== 'FA-V3' || run.framework === 'fluo');
      if (run.correctness === 'pass' && !errorRateFailure) return [];
      return [{ profile: run.profile, mode: run.mode, framework: run.framework,
        verdict: run.correctness === 'fail' || errorRateFailure ? 'fail' : 'inconclusive',
        reason: 'measurement-quality', measurementPurpose: receipt.measurementPurpose }];
    }));
}

export function evaluatePairVerdict(before, after, methodVersion) {
  const beforeChecks = methodVersion === 'FA-V3' ? before.checks.filter((check) =>
    check.metric === undefined || check.metric === 'errorRate' && check.framework === 'fluo'
    || !['absolute-budget', 'relative-band'].includes(check.reason)) : before.checks;
  const checks = [...beforeChecks, ...after.checks];
  return checks.some((check) => check.verdict === 'fail') ? 'fail'
    : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass';
}

/** Historical evaluateEvidence is replay only; this is the versioned acceptance seam. */
export async function evaluateAcceptedEvidence(baseline, timingReceipts, outputRoot, nativeReceipts = []) {
  const integrated = timingReceipts[0]?.methodVersion === 'FA-V3';
  const methodVersion = integrated ? 'FA-V3' : 'FA-V2';
  const purpose = integrated ? 'integrated' : 'timing';
  if (!timingReceipts.length || timingReceipts.some((receipt) => receipt.methodVersion !== methodVersion
    || receipt.measurementPurpose !== purpose || integrated && receipt.measurementKind !== 'production')) {
    throw new Error('FA-V2 timing receipts required or FA-V3 production integrated receipts required');
  }
  if (integrated && nativeReceipts.length) throw new Error('FA-V3 cannot borrow native counterparts from another execution');
  const frozenBytes = await readFile(new URL('../baseline.json', import.meta.url));
  const frozen = JSON.parse(frozenBytes);
  const baselineSha256 = createHash('sha256').update(frozenBytes).digest('hex');
  if (!isDeepStrictEqual(baseline, frozen)) throw new Error('FA-V2 frozen baseline mutation');
  if (!integrated && (nativeReceipts.length !== timingReceipts.length
    || nativeReceipts.some((receipt) => receipt.methodVersion !== 'FA-V2'
      || receipt.measurementPurpose !== 'native-conformance'))) throw new Error('FA-V2 matching native counterpart required');
  const identities = new Set();
  const executions = new Set();
  const environments = new Map();
  let product;
  let pairId;
  let pairPhase;
  for (const timing of timingReceipts) {
    if (identities.has(timing.profile)) throw new Error('FA-V2 duplicate profile');
    identities.add(timing.profile);
    const matches = nativeReceipts.filter((receipt) => receipt.profile === timing.profile);
    if (!integrated && matches.length !== 1) throw new Error('FA-V2 missing/duplicate native counterpart');
    const native = matches[0];
    const timingMethod = await verifyMethodReceipt(timing, outputRoot);
    const nativeMethod = integrated ? undefined : await verifyMethodReceipt(native, outputRoot);
    for (const receipt of integrated ? [timing] : [timing, native]) {
      if (!receipt.isolatedRepresentative || !receipt.environmentBinding) {
        throw new Error('FA-V2 representative environment authentication required');
      }
      await verifyMeasurementEnvironment(receipt, outputRoot);
      const environment = receipt.environmentBinding.identitySha256;
      if (environments.has(receipt.measurementPurpose)
        && environments.get(receipt.measurementPurpose) !== environment) {
        throw new Error('FA-V2/FA-V3 mixed profile environment identity');
      }
      environments.set(receipt.measurementPurpose, environment);
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
    if (integrated) continue;
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
      const timingDev = await verifyMethodBinding(timing.developmentMethodBinding, outputRoot);
      const nativeDev = await verifyMethodBinding(native.developmentMethodBinding, outputRoot);
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
  const evaluation = evaluatePerformance(baseline, timingReceipts.flatMap((receipt) => receipt.runs), methodVersion);
  const nativeChecks = evaluateMeasurementQuality([...timingReceipts, ...nativeReceipts]);
  const checks = [...evaluation.checks, ...nativeChecks];
  return { methodVersion, measurementPurpose: purpose, pairId, pairPhase, checks,
    ...(integrated ? { integratedConfigurations: timingReceipts.map((receipt) => receipt.methodBinding) }
      : { counterpartConfigurations: nativeReceipts.map((receipt) => receipt.methodBinding) }),
    verdict: checks.some((check) => check.verdict === 'fail') ? 'fail'
      : checks.some((check) => check.verdict === 'inconclusive') ? 'inconclusive' : 'pass' };
}

export async function verifyDevelopmentPairRelation(first, second, outputRoot) {
  const firstDev = await verifyMethodBinding(first.developmentMethodBinding, outputRoot);
  const secondDev = await verifyMethodBinding(second.developmentMethodBinding, outputRoot);
  if (firstDev.configuration.measurementKind !== 'development'
    || secondDev.configuration.measurementKind !== 'development'
    || firstDev.pairPhase !== 'before' || secondDev.pairPhase !== 'after'
    || firstDev.pairId !== secondDev.pairId || firstDev.measurementPurpose !== secondDev.measurementPurpose
    || firstDev.executionId === secondDev.executionId) {
    throw new Error('FA-V2 before/after development method mismatch');
  }
  const measurement = await import('./measure.mjs');
  for (const [receipt, method] of [[first, firstDev], [second, secondDev]]) {
    const environment = await verifyEnvironmentBinding(receipt.developmentEnvironmentBinding, outputRoot);
    if (environment.configSha256 !== measurement.environmentConfigIdentity(method.configuration)) {
      throw new Error('FA-V2 development method/environment full configuration mismatch');
    }
  }
  const comparison = pairStimuliComparison(firstDev.configuration, secondDev.configuration);
  if (comparison === 'mismatch') throw new Error('FA-V2 before/after development stimuli mismatch');
  if (comparison === 'identical') return null;
  const relation = await measurement.authenticateReactEditPair(
    first.developmentEnvironmentBinding, second.developmentEnvironmentBinding, outputRoot);
  if (!relation) throw new Error('FA-V2 RE-A01 source relation missing');
  const captured = second.developmentEnvironmentPairRelation;
  if (!captured || !isDeepStrictEqual({
    ...relation, before: { ...relation.before, path: captured.before?.path },
  }, captured)) {
    throw new Error('FA-V2 RE-A01 receipt source relation mismatch');
  }
  await measurement.verifyReactEditPairRelation(captured, second.developmentEnvironmentBinding, outputRoot);
  return captured;
}

export async function evaluateAcceptedPair(baseline, before, after) {
  const results = [];
  const methods = [];
  for (const cohort of [before, after]) {
    results.push(await evaluateAcceptedEvidence(baseline, cohort.timing, cohort.outputRoot, cohort.native));
    methods.push(await Promise.all(cohort.timing.map((receipt) => verifyMethodReceipt(receipt, cohort.outputRoot))));
  }
  if (results[0].pairPhase !== 'before' || results[1].pairPhase !== 'after'
    || results[0].methodVersion !== results[1].methodVersion
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
    if (before.outputRoot !== after.outputRoot) throw new Error('FA-V2 RE-A01 requires common evidence root');
    for (const purpose of results[0].methodVersion === 'FA-V3' ? ['timing'] : ['timing', 'native']) {
      const firstReceipt = before[purpose].find((receipt) => receipt.profile === first.profile);
      const secondReceipt = after[purpose].find((receipt) => receipt.profile === second.profile);
      const relation = await verifyDevelopmentPairRelation(firstReceipt, secondReceipt, before.outputRoot);
      if (relation) sourceRelations.push(relation);
    }
  }
  const verdict = evaluatePairVerdict(results[0], results[1], results[0].methodVersion);
  return { methodVersion: results[0].methodVersion, pairId: results[0].pairId, verdict, sourceRelations,
    ...(results[0].methodVersion === 'FA-V3' ? { numericAcceptancePhase: 'after' } : {}),
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
  const integrated = receipts[0]?.methodVersion === 'FA-V3';
  if (!historical && receipts.some((receipt) => integrated
    ? receipt.methodVersion !== 'FA-V3' || receipt.measurementPurpose !== 'integrated'
    : receipt.methodVersion !== 'FA-V2' || !['timing', 'native-conformance'].includes(receipt.measurementPurpose))) {
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
