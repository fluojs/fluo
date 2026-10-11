import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { NodeSubject } from './paired-aa.mjs';
import { AAInputFailure, equal, object, pairedCondition } from './paired-aa.mjs';
import { collectSourcePaired, evaluateSourcePaired, frozenSourcePlan, singleRun, validateProtocol } from './paired-ab.mjs';

/** Node-only paired-node-v1. No CLI overrides for the frozen timing condition. */
export function nodeSubject(input: unknown): NodeSubject {
  const plan = object(input);
  equal(plan.schema, 'paired-node-v1', 'Node schema');
  const platform = object(plan.condition).platform;
  const mode = plan.mode;
  if (platform !== 'nodejs' && platform !== 'fastify' && platform !== 'express') {
    throw new AAInputFailure('Unsupported Node platform');
  }
  if (mode !== 'calibration' && mode !== 'candidate') throw new AAInputFailure('Explicit Node mode required');
  return { platform, mode };
}

export function frozenNodePlan(input: unknown) {
  return frozenSourcePlan(input, nodeSubject(input));
}

export function evaluateNode(plan: unknown, evidence: unknown) {
  // Parse inside the shared evidence boundary so invalid plans fail closed too.
  try {
    const subject = nodeSubject(plan);
    return { ...evaluateSourcePaired(plan, evidence, subject),
      schema: 'paired-node-v1', mode: subject.mode, condition: pairedCondition(subject) };
  } catch (error) {
    if (!(error instanceof AAInputFailure)) throw error;
    return { verdict: 'FAIL_EVIDENCE', evidenceErrors: [error.message], inconclusive: [],
      observations: [], budgetBreaches: [] };
  }
}

export function validateNodeProtocol(input: unknown, planInput: unknown) {
  const subject = nodeSubject(planInput);
  validateProtocol(input, frozenNodePlan(planInput), subject);
}

export async function collectNode(planPath: string, outputPath: string, planOnly = false) {
  const input: unknown = JSON.parse(await readFile(planPath, 'utf8'));
  const subject = nodeSubject(input);
  if (process.env.BENCH_DIAGNOSTIC_DRIFT !== undefined) throw new AAInputFailure('Diagnostic drift is forbidden for Node paired collection');
  return collectSourcePaired(planPath, outputPath, planOnly, subject);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, planPath, outputOrHash, ordinal, childOutput, ...extra] = process.argv.slice(2);
  const operation = mode === '--single-run' && planPath && outputOrHash && ordinal !== undefined && childOutput && extra.length === 0
    ? readFile(planPath, 'utf8').then((bytes) => singleRun(planPath, outputOrHash, ordinal, childOutput, nodeSubject(JSON.parse(bytes))))
    : (mode === '--plan-only' || mode === '--collect') && planPath && ordinal === undefined && extra.length === 0
      && (mode === '--plan-only' ? outputOrHash === undefined : outputOrHash !== undefined)
      ? collectNode(planPath, outputOrHash ?? '', mode === '--plan-only')
      : Promise.reject(new AAInputFailure('Usage: paired-node.mts --plan-only PLAN | --collect PLAN OUTPUT'));
  operation.then((result) => {
    if (result !== undefined) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      if ('verdict' in result && result.verdict !== 'OBSERVED_WITHIN_BUDGET_FOR_DECLARED_SCOPE') process.exitCode = 1;
    }
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
