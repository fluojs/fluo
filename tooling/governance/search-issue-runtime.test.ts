import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const root = process.cwd();
const scripts = resolve(root, '.agents/skills/search-issue/scripts');
const fixture = JSON.parse(readFileSync(resolve(root,
  'tooling/governance/fixtures/search-issue-native/full-registration.json'), 'utf8'));
const directories: string[] = [];
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const put = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
const envelope = (result: Record<string, unknown>): Record<string, unknown> => ({
  ...result, contract_version: 1, stop_reason: 'done',
  verification: { checked_paths: ['packages/runtime'], evidence_complete: true },
});

const setup = () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'fluo-search-runtime-'));
  directories.push(directory);
  const bin = resolve(directory, 'bin');
  mkdirSync(bin);
  const stub = resolve(bin, 'gh');
  writeFileSync(stub, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.SEARCH_STUB_ROOT;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(root, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const config = JSON.parse(fs.readFileSync(path.join(root, 'gh.json'), 'utf8'));
if (args[0] === 'label') {
  console.log(JSON.stringify(config.labels.map(name => ({name}))));
} else if (args[0] === 'api') {
  if (config.lookup_failure) process.exit(1);
  const file = path.join(root, 'remote.json');
  const remote = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  console.log(JSON.stringify([remote.map(issue => ({...issue, html_url: issue.url}))]));
} else if (args[1] === 'list') {
  if (config.lookup_failure) process.exit(1);
  if (config.search_stale) { console.log('[]'); process.exit(0); }
  const file = path.join(root, 'remote.json');
  console.log(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]');
} else if (args[1] === 'create') {
  const body = args[args.indexOf('--body') + 1];
  fs.writeFileSync(path.join(root, 'remote.json'), JSON.stringify([
    {number: 8001, url: 'https://github.com/fluojs/fluo/issues/8001', body}
  ]));
  if (config.interrupt === 'kill') {
    process.kill(process.ppid, 'SIGKILL');
    process.exit(1);
  }
  if (config.interrupt === 'malformed') { console.log('invalid-receipt'); process.exit(0); }
  if (config.interrupt) process.exit(1);
  console.log('https://github.com/fluojs/fluo/issues/8001');
} else process.exit(2);
`);
  chmodSync(stub, 0o755);
  const domain = json(resolve(root, '.agents/skills/search-issue/references/domain.json'));
  put(resolve(directory, 'gh.json'), { labels: domain.labels });
  const out = resolve(directory, 'run');
  const input = resolve(directory, 'input.json');
  put(input, { run_id: 'runtime-regression', repository: 'fluojs/fluo',
    intake: fixture.intake, authority: fixture.authority });
  const cli = (...args: string[]) => spawnSync(process.execPath,
    [resolve(scripts, 'run.mjs'), ...args, '--root', directory, '--out', out],
    { encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`,
      SEARCH_STUB_ROOT: directory } });
  const ok = (...args: string[]) => {
    const result = cli(...args);
    expect(result.status, result.stderr).toBe(0);
    return result;
  };
  const ledger = () => json(resolve(out, 'ledger.json'));
  const save = (value: unknown) => put(resolve(out, 'ledger.json'), value);
  const calls = () => existsSync(resolve(directory, 'calls.jsonl'))
    ? readFileSync(resolve(directory, 'calls.jsonl'), 'utf8').trim().split('\n')
      .map((line) => {
        const args: unknown = JSON.parse(line);
        if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) {
          throw new TypeError('Invalid stub call record.');
        }
        return args;
      }) : [];
  const ready = () => {
    ok('init', '--input', input);
    for (const [index, result] of fixture.reviewer_results.entries()) {
      ok('start', '--invocation', result.invocation_id, '--task-id', `native-${index}`);
      put(resolve(directory, 'result.json'), envelope(result));
      ok('collect', '--input', resolve(directory, 'result.json'));
    }
    ok('drafts');
    put(resolve(directory, 'triage.json'), fixture.registration_triage);
    ok('triage', '--input', resolve(directory, 'triage.json'));
  };
  return { directory, input, out, cli, ok, ledger, save, calls, ready };
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('#4095 search runtime', () => {
  it.each(['fake_issue_numbers', 'reviewer_results'])('intake: synthetic %s creates no runtime state', (key) => {
    const run = setup();
    put(run.input, { ...json(run.input), [key]: fixture[key] });

    expect(run.cli('init', '--input', run.input).status).not.toBe(0);
    expect(existsSync(run.out)).toBe(false);
    expect(run.calls()).toEqual([]);
  });
  it('ledger: production and fixture validate against one schema', async () => {
    const run = setup();
    run.ready();
    const output = resolve(run.directory, 'fixture');
    mkdirSync(output);
    const result = spawnSync(process.execPath, [resolve(scripts, 'run-scenario.mjs'),
      '--fixture-only', '--scenario', resolve(root,
        'tooling/governance/fixtures/search-issue-native/full-registration.json'),
      '--out', output], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const { assertLedger } = await import(resolve(scripts, 'ledger-contract.mjs'));

    expect(() => assertLedger(run.ledger())).not.toThrow();
    expect(() => assertLedger(json(resolve(output, 'ledger.json')))).not.toThrow();
  });

  it.each(['drafts', 'register', 'publish', 'resume', 'block', 'collect', 'triage'])(
    'ledger: invalid stored state blocks %s before external access', (command) => {
      const run = setup();
      run.ready();
      run.save({ ...run.ledger(), status: 'invented' });

      expect(run.cli(command, '--reason', 'interrupted', '--input', run.input).status).not.toBe(0);
      expect(run.calls()).toEqual([]);
    });

  it('registration: existing local receipt and artifact are reused', () => {
    const run = setup();
    run.ready();
    run.ok('register');
    run.ok('publish');
    const before = run.ledger();

    run.ok('register');
    run.ok('publish');

    expect(run.calls().filter((args) => args[1] === 'create')).toHaveLength(1);
    expect(run.ledger()).toEqual(before);
    expect(run.ledger().registration_results[0]).toMatchObject({
      issue_number: 8001, issue_url: 'https://github.com/fluojs/fluo/issues/8001',
    });
    expect(json(resolve(run.directory,
      '.omo/search-issue/artifacts/runtime-regression.json')).selected_issues).toEqual([8001]);
  });

  it.each([true, 'kill', 'malformed'])('registration: interruption %s recovers receipt without creating again', (interrupt) => {
    const run = setup();
    run.ready();
    const config = resolve(run.directory, 'gh.json');
    put(config, { ...json(config), interrupt, search_stale: true });
    expect(run.cli('register').status).not.toBe(0);
    expect(run.ledger().status).toBe(interrupt === 'kill' ? 'registering' : 'blocked');
    expect(run.ledger().registration_results).toEqual([]);
    put(config, { ...json(config), interrupt: false });
    run.ok('resume');

    run.ok('register');

    expect(run.calls().filter((args) => args[1] === 'create')).toHaveLength(1);
    expect(run.ledger().registration_results[0]).toMatchObject({
      issue_number: 8001, issue_url: 'https://github.com/fluojs/fluo/issues/8001',
    });
  });

  it.each(['failed', 'ambiguous', 'missing-label', 'bad-receipt'])(
    'registration: %s evidence blocks additional creation', (failure) => {
      const run = setup();
      run.ready();
      if (failure === 'failed') {
        const config = resolve(run.directory, 'gh.json');
        put(config, { ...json(config), lookup_failure: true });
      } else if (failure === 'missing-label') {
        put(resolve(run.directory, 'gh.json'), { labels: [] });
      } else {
        run.ok('register');
        const remote = json(resolve(run.directory, 'remote.json'));
        if (failure === 'ambiguous') {
          run.save({ ...run.ledger(), registration_results: [] });
          put(resolve(run.directory, 'remote.json'), [...remote, { ...remote[0], number: 8002,
            url: 'https://github.com/fluojs/fluo/issues/8002' }]);
        } else {
          const ledger = run.ledger();
          ledger.registration_results[0].issue_url = 'https://github.com/other/repo/issues/8001';
          run.save(ledger);
        }
      }
      const created = run.calls().filter((args) => args[1] === 'create').length;

      expect(run.cli('register').status).not.toBe(0);
      expect(run.calls().filter((args) => args[1] === 'create')).toHaveLength(created);
    });

  it('interrupt: resume preserves expected and started invocations', () => {
    const run = setup();
    run.ok('init', '--input', run.input);
    const id = fixture.reviewer_results[0].invocation_id;
    run.ok('start', '--invocation', id, '--task-id', 'native-paused');
    const before = run.ledger().invocations;
    run.ok('block', '--reason', 'user interrupted');

    run.ok('resume');

    expect(run.ledger().invocations).toEqual(before);
    expect(run.ledger().invocations.map((item: { status: string }) => item.status))
      .toEqual(['started', 'expected', 'expected', 'expected']);
    expect(run.cli('drafts').status).not.toBe(0);
    expect(run.calls()).toEqual([]);
  });

  it.each(['duplicate', 'missing', 'security', 'support', 'foreign-package'])(
    'triage: %s decision cannot reach creation', (failure) => {
      const run = setup();
      run.ready();
      const ledger = run.ledger();
      if (failure === 'duplicate') ledger.registration_triage.push(ledger.registration_triage[0]);
      if (failure === 'missing') ledger.registration_triage.pop();
      if (failure === 'security') ledger.registration_triage[0].labels.push('scope:security');
      if (failure === 'support') ledger.registration_triage[0].safety_route = 'support';
      if (failure === 'foreign-package') ledger.registration_triage[0].labels.push('pkg:redis');
      run.save(ledger);

      expect(run.cli('register').status).not.toBe(0);
      expect(run.calls()).toEqual([]);
    });

  it.each([{ explicit_harness_invocation: false, investigation_only: false },
    { explicit_harness_invocation: true, investigation_only: true }])(
    'authority: restricted run completes without GitHub or artifact', (authority) => {
      const run = setup();
      put(run.input, { ...json(run.input), authority });
      run.ready();

      run.ok('register');
      run.ok('publish');

      expect(run.calls()).toEqual([]);
      expect(run.ledger().handoff).toBeNull();
      expect(existsSync(resolve(run.directory, '.omo/search-issue/artifacts'))).toBe(false);
    });

  it.each(['missing-task', 'wrong-package', 'wrong-reviewer', 'wrong-type', 'duplicate', 'malformed'])(
    'collection: %s cannot complete a native invocation', (failure) => {
      const run = setup();
      run.ok('init', '--input', run.input);
      const result = envelope(fixture.reviewer_results[0]);
      if (failure !== 'missing-task') run.ok('start', '--invocation', String(result.invocation_id),
        '--task-id', 'native-result');
      if (failure === 'wrong-package') result.package = 'http';
      if (failure === 'wrong-reviewer') result.reviewer = 'feature-rd';
      if (failure === 'wrong-type') result.result_type = 'rd_brief';
      if (failure === 'malformed') result.contract_version = 2;
      const input = resolve(run.directory, 'result.json');
      put(input, result);
      if (failure === 'duplicate') run.ok('collect', '--input', input);

      expect(run.cli('collect', '--input', input).status).not.toBe(0);
      expect(run.cli('drafts').status).not.toBe(0);
      expect(run.calls()).toEqual([]);
    });
});
