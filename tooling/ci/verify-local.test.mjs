import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { buildVerificationPlan, digest, readVerificationManifest, receiptMatchesPlan, validateReceiptEvidence } from './local-verification.mjs';
import { collectIdentity } from './verify-local.mjs';

const script = new URL('./verify-local.mjs', import.meta.url);

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'fluo-verification-plan-cli-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of [
    'tooling/ci/verify-local.mjs', 'tooling/ci/local-verification.mjs',
    'tooling/ci/verification-runner.mjs', 'tooling/ci/verification-environment.mjs',
    'tooling/ci/local-verification-manifest.json', 'tooling/ci/local-verification-receipt.schema.json',
    'tooling/ci/environment.lock.json', 'tooling/ci/Dockerfile',
    '.agents/workflow-contracts/schema-validator.mjs',
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    cpSync(new URL(`../../${file}`, import.meta.url), join(root, file));
  }
  writeFileSync(join(root, '.gitignore'), '.omo/\n');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  return { root, commit() {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture');
    return git('rev-parse', 'HEAD').trim();
  } };
}

test('prints a machine-readable clean exact-head plan without creating a receipt', (t) => {
  const { root, commit } = fixture(t);
  commit();
  const result = spawnSync(process.execPath, [join(root, 'tooling/ci/verify-local.mjs'), '--plan',
    '--profile', 'extended', '--base-ref', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });

  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim().length > 0, 'plan command must emit JSON');
  const plan = JSON.parse(result.stdout);
  assert.equal(typeof plan.identity.headSha, 'string');
  assert.equal(plan.tasks[0].id, 'build');
  assert.equal(plan.profile, 'extended');
  assert.equal(plan.identity.clean, true);
});

test('the real local CLI produces a complete admissible receipt through the executor boundary', (t) => {
  // Given: only task execution is replaced; planning, source checks, aggregation,
  // receipt production and receipt authentication remain the production code.
  const { root, commit } = fixture(t);
  const actualRunner = new URL('./verification-runner.mjs', import.meta.url).href;
  writeFileSync(join(root, 'tooling/ci/verification-runner.mjs'), `
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest } from './local-verification.mjs';
export { aggregateResults } from ${JSON.stringify(actualRunner)};
const put = (path, bytes) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); };
const environment = lock => ({
  os:'linux', arch:'x64',
  node:Object.fromEntries(Object.entries(lock.node).map(([key,item])=>[key,item.version])),
  bun:Object.fromEntries(Object.entries(lock.bun).map(([key,item])=>[key,item.version])),
  deno:Object.fromEntries(Object.entries(lock.deno).map(([key,item])=>[key,item.version])),
  pnpm:lock.pnpm.version,
  browser:{channel:lock.browser.channel,version:lock.browser.version,launched:true},
  docker:{reachable:true,version:'fixture',cliVersion:lock.docker.version},
  redis:{ping:'PONG',image:lock.redis.image},watch:{linuxVolume:true,event:'change'}
});
export function runHostChecks(plan, output) {
  const logs=plan.hostChecks.map((_,index)=>{
    const path='host-check-'+index+'.log'; put(join(output,path),'host execution boundary');
    return {path,digest:digest('host execution boundary')};
  });
  const result={status:'passed',headSha:plan.source.headSha,treeSha:plan.source.treeSha,
    planDigest:plan.semanticDigest,logs,
    commands:plan.hostChecks.map(command=>({command,exitCode:0,signal:null,spawnError:null}))};
  put(join(output,'host-checks.json'),JSON.stringify(result));
  return result;
}
export function runTask(plan, id, output, artifacts) {
  const task=plan.tasks.find(task=>task.id===id);
  for(const dependency of task.dependencies) {
    if(!existsSync(join(output,dependency+'.json'))) throw new Error('dependency did not execute');
  }
  const logs=task.commands.map((_,index)=>{
    const path=id+'-'+index+'.log'; put(join(output,path),'task execution boundary');
    return {path,commandIndex:index,digest:digest('task execution boundary')};
  });
  const files=task.outputs.map(name=>{
    const path=name==='docs-site'?'docs-site/index.html':name;
    put(join(artifacts,path),'artifact execution boundary');
    const bytes=readFileSync(join(artifacts,path));
    return {path,digest:digest(bytes),size:bytes.length};
  });
  const identity={headSha:plan.source.headSha,treeSha:plan.source.treeSha,statusDigest:digest('')};
  const result={version:2,status:'passed',taskId:id,headSha:plan.source.headSha,treeSha:plan.source.treeSha,
    planDigest:plan.semanticDigest,imageKey:plan.environment.imageKey,imageId:'sha256:'+'1'.repeat(64),
    environment:environment(plan.environment.lock),logs,artifacts:files,
    commands:task.commands.map(command=>({command,exitCode:0,signal:null,spawnError:null,
      identityBefore:identity,identityAfter:identity}))};
  put(join(output,id+'.json'),JSON.stringify(result));
  return result;
}
`);
  const base = commit();

  // When: execute the actual CLI, not a hand-authored passing receipt.
  const execution = spawnSync(process.execPath, [join(root, 'tooling/ci/verify-local.mjs'), '--base-ref', base], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });

  // Then
  assert.equal(execution.status, 0, execution.stdout + execution.stderr);
  const result = JSON.parse(execution.stdout);
  const bytes = readFileSync(result.path);
  const receipt = JSON.parse(bytes);
  const identity = collectIdentity(root, base);
  const plan = buildVerificationPlan({ changedFiles: identity.changedFiles, identity,
    manifest: readVerificationManifest(join(root, 'tooling/ci/local-verification-manifest.json')) });
  assert.equal(receiptMatchesPlan(receipt, identity, plan), true);
  assert.equal(receipt.taskResults.length, 16);
  assert.equal(validateReceiptEvidence(receipt, {
    worktree: root, receiptPath: result.path.slice(root.length + 1), receiptSha256: digest(bytes),
  }).valid, true);
});

test('rejects unknown verifier options', () => {
  const result = spawnSync(process.execPath, [script.pathname, '--unknown'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown option/u);
});
