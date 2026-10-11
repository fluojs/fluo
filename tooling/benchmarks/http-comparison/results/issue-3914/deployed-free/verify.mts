import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { EvidenceJournal, failureEvidence } from '../../../src/evidence';
import { object, sha256 } from '../../../src/profile-report';
import { WORKSPACE_ROOT } from '../../../src/provenance';
import { comparisonHeaders } from '../../../src/shared/comparison-headers';
import { selectSuite } from '../../../src/suites';
import { AVAILABLE_TARGETS, targetRequests, WDIR } from '../../../src/targets';

const execute = promisify(execFile);
const directory = join(WDIR, 'results/issue-3914/deployed-free');
const output = join(WDIR, 'results/issue-3914/deployed-free-correctness-20261011.json');
const evidenceRoot = process.env.FLUO_VERIFICATION_ROOT;
const targets = ['native-workers', 'fluo-workers'].map((name) => {
  const target = AVAILABLE_TARGETS.find((candidate) => candidate.name === name);
  assert.ok(target);
  return target;
});
const scenarios = selectSuite('all');
const configurations = ['default', 'equivalent'] as const;
const additionalRequests = targets.reduce((total, target) => total + configurations.length
  * scenarios.reduce((count, scenario) => count + targetRequests(target, scenario.requests).length * 3, 0), 0);
const plan = { expectedConditions: targets.length * scenarios.length * configurations.length, initialRequests: 20, additionalRequests, maximumRequests: 200 };
assert.equal(plan.expectedConditions, 44);
assert.equal(plan.initialRequests + additionalRequests, plan.maximumRequests);

if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ ...plan, execution: 'not-started' }));
} else {
  assert.ok(evidenceRoot, 'FLUO_VERIFICATION_ROOT must name the preserved lead evidence directory');
  assert.equal(existsSync(output), false, 'Never overwrite or automatically repeat an existing collection');
  const account = object(JSON.parse(await readFile(join(evidenceRoot, '3914-cloudflare-account-observation-20261011.json'), 'utf8')));
  const initial = object(JSON.parse(await readFile(join(evidenceRoot, '3914-free-workers-http-20261011.json'), 'utf8')));
  assert.equal(account.workersPlan, 'Free');
  assert.equal(account.displayedPrice, '$0');
  assert.equal(account.accountId, process.env.CLOUDFLARE_ACCOUNT_ID);
  assert.equal(account.workersSubdomain, 'wpfekdml.workers.dev');
  assert.equal(initial.requestsSent, plan.initialRequests);
  assert.equal(initial.failure, null);
  const sourceHead = (await execute('git', ['rev-parse', 'HEAD'], { cwd: WORKSPACE_ROOT })).stdout.trim();
  assert.equal((await execute('git', ['status', '--porcelain'], { cwd: WORKSPACE_ROOT })).stdout.trim(), '', 'Execute only a clean source head');
  const deployments: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];
  const completed: Record<string, unknown>[] = [];
  let requestsSent = plan.initialRequests;
  const journal = new EvidenceJournal(output, () => ({
    kind: 'bounded-deployed-workers-correctness', notPerformanceBaseline: true,
    sourceHead, plan, requestsSent, deployments, requests, completed,
    limitations: [
      'Deployment IDs are not opaque isolate identities or proof of isolate cold start.',
      'This collector does not measure framework-exclusive CPU, RSS, throughput or a performance budget.',
      'Different Cloudflare locations and unobserved provider-originated requests remain outside the controlled request count.',
    ],
  }));
  journal.flush();
  try {
    for (const configuration of configurations) {
      for (const target of targets) {
        for (const scenario of scenarios) {
          const condition = { configuration, target: target.name, scenario: scenario.name, appShape: scenario.appShape };
          journal.current = condition;
          const name = `fluo-3914-${target.product}-20261011`;
          const baseUrl = `https://${name}.wpfekdml.workers.dev`;
          const baseBundle = await readFile(join(directory, `${target.product}-bundle/server.js`));
          const conditionDirectory = join(directory, 'condition-bundles', configuration, target.product, scenario.name);
          await mkdir(conditionDirectory, { recursive: true });
          const bundle = join(conditionDirectory, 'server.js');
          const marker = `\n// finite-correctness condition: ${configuration}/${target.name}/${scenario.name}\n`;
          const deployedBundle = Buffer.concat([baseBundle, Buffer.from(marker)]);
          // Bindings-only updates may reuse an isolate containing the previous app.
          // Distinct code bytes avoid relying on such reuse; this is not cold-start proof.
          await writeFile(bundle, deployedBundle, { flag: 'wx' });
          const args = [
            join(WDIR, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', bundle,
            '--no-bundle', '--config', join(directory, `${target.product}.wrangler.json`),
            '--var', `BENCH_APP_SHAPE:${scenario.appShape}`, '--var', `BENCH_CONFIGURATION:${configuration}`,
          ];
          const deployment: Record<string, unknown> = { ...condition, name, baseUrl, baseBundleSha256: sha256(baseBundle), bundleSha256: sha256(deployedBundle), marker, command: process.execPath, args, startedAt: new Date().toISOString() };
          deployments.push(deployment);
          journal.flush();
          const deployed = await execute(process.execPath, args, {
            cwd: WDIR, timeout: 120_000, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' },
          }).catch((error: unknown) => {
            if (error instanceof Error) Object.assign(deployment, {
              error: failureEvidence(error),
              stdout: 'stdout' in error ? error.stdout : null,
              stderr: 'stderr' in error ? error.stderr : null,
            });
            throw error;
          });
          Object.assign(deployment, { stdout: deployed.stdout, stderr: deployed.stderr, completedAt: new Date().toISOString(), exitCode: 0 });
          const version = deployed.stdout.match(/Current Version ID:\s*([a-f0-9-]{36})/);
          assert.ok(version, 'Deployment must return its actual version ID');
          assert.ok(deployed.stdout.includes(baseUrl), 'Deployment must return the expected owned workers.dev URL');
          deployment.versionId = version[1];
          journal.flush();
          const cases = targetRequests(target, scenario.requests);
          const check = async (request: (typeof cases)[number], wave: string, requestIndex: number) => {
            assert.ok(requestsSent < plan.maximumRequests, 'Request budget exhausted');
            requestsSent += 1;
            const entry: Record<string, unknown> = { ...condition, versionId: version[1], ordinal: requestsSent, wave, requestIndex, url: `${baseUrl}${request.path}`, method: request.method, requestBody: request.body ?? null, startedAt: new Date().toISOString() };
            requests.push(entry);
            journal.flush();
            try {
              const response = await fetch(`${baseUrl}${request.path}`, {
                method: request.method, body: request.body, headers: request.headers,
                redirect: 'error', signal: AbortSignal.timeout(15_000),
              });
              const body = await response.text();
              Object.assign(entry, { status: response.status, body, headers: Object.fromEntries(response.headers.entries()), completedAt: new Date().toISOString() });
              assert.equal(response.status, request.expectedStatus);
              assert.equal(body, request.expectedBody);
              assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
              for (const [header, value] of Object.entries(comparisonHeaders(target.product === 'fluo' ? 'equivalent' : configuration))) {
                assert.equal(response.headers.get(header), value, header);
              }
              entry.valid = true;
            } catch (error) {
              entry.error = failureEvidence(error);
              throw error;
            } finally { journal.flush(); }
          };
          const first = await Promise.allSettled(cases.flatMap((request, index) => [
            check(request, 'concurrent-first-from-this-check', index),
            check(request, 'concurrent-first-from-this-check', index),
          ]));
          assert.ok(first.every((result) => result.status === 'fulfilled'), 'A first-wave request failed; all in-flight results were retained');
          for (const [index, request] of cases.entries()) await check(request, 'subsequent-from-this-check', index);
          completed.push({ ...condition, versionId: version[1], completedRequests: cases.length * 3 });
          journal.current = null;
          journal.flush();
          console.log(`DEPLOYED_CORRECTNESS_PASS ${configuration}/${target.name}/${scenario.name}`);
        }
      }
    }
    assert.equal(requestsSent, plan.maximumRequests);
    assert.equal(completed.length, plan.expectedConditions);
  } catch (error) {
    journal.fail(error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    journal.finish();
    console.log(`DEPLOYED_CORRECTNESS_DONE conditions=${completed.length}/${plan.expectedConditions} requests=${requestsSent}/${plan.maximumRequests}`);
  }
}
