import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluatePerformance, METRICS } from './evaluate.ts';
import { verifyTraceFiles } from './measure.mjs';

export async function evaluateEvidence(baseline, receipts, outputRoot) {
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

async function main() {
  const args = process.argv.slice(2);
  const baselinePath = args[args.indexOf('--baseline') + 1];
  const outputPath = args[args.indexOf('--output') + 1];
  const root = args[args.indexOf('--trace-root') + 1];
  const files = args.filter((arg, index) =>
    !['--baseline', '--output', '--trace-root'].includes(args[index - 1])
    && !['--baseline', '--output', '--trace-root'].includes(arg));
  if (!baselinePath || !outputPath || !root || files.length === 0) {
    throw new TypeError('usage: node src/gate.mjs --baseline baseline.json --output report.json --trace-root traces/ result.json ...');
  }
  const baseline = JSON.parse(await readFile(baselinePath, 'utf8'));
  const receipts = await Promise.all(files.map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
  const result = await evaluateEvidence(baseline, receipts, root);
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
